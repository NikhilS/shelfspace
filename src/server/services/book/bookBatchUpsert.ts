import {FieldValue} from 'firebase-admin/firestore';
import type {BookBatchUpsertInput} from '../../../schemas/book';
import {
  isFirestoreFieldValueSentinel,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {storedLibraryDocSchema} from '../../../schemas/libraryApi';
import type {ReadingStatusValue} from '../../../types';
import {getAdminDb} from '../firebaseAdmin';
import {LibraryMetadataCache} from '../library/libraryMetadataCache';
import {mergeOnCreateUpdateMaps, metadataRegistry} from '../metadata';
import {BookPartitioner, bookDetailsDocConverter} from './bookPartitioner';
import {
  assertSafeDocId,
  fetchExistingBookDataForSnapshot,
} from './bookWriteIds';
import {
  buildReadingStateUpsertPayload,
  computeReadingStateKey,
  getReadingStatesCollection,
} from './readingStateLedger';

interface NormalizedBatchOperation {
  type: 'create' | 'update' | 'delete' | 'set';
  bookId: string;
  coreData?: Record<string, unknown>;
  heavyData?: Record<string, unknown>;
  readingStatus?: ReadingStatusValue;
  merge?: boolean;
}

type BatchInputOperation = NonNullable<
  BookBatchUpsertInput['operations']
>[number];

async function persistBackgroundOnCreateUpdates(params: {
  db: FirebaseFirestore.Firestore;
  libraryId: string;
  userId: string;
  enrichedMap: Map<string, Record<string, unknown>>;
  opById: Map<string, BatchInputOperation>;
}): Promise<void> {
  const {db, libraryId, userId, enrichedMap, opById} = params;
  const BG_BATCH_LIMIT = 400;
  let bgBatch = db.batch();
  let bgOps = 0;
  const isVirtualLib = libraryId.startsWith('virtual_');
  const readingStatesCol = userId
    ? getReadingStatesCollection(db, userId)
    : undefined;

  for (const [bookId, patch] of enrichedMap.entries()) {
    if (!patch || Object.keys(patch).length === 0) {
      continue;
    }
    const targetOp = opById.get(bookId);
    const baseData = (targetOp?.data || {}) as Record<string, unknown>;
    const {coreUpdates, heavyUpdates} = BookPartitioner.partitionUpdatePayload(
      patch,
      FieldValue.serverTimestamp(),
      {
        existingBook: {
          title:
            typeof baseData.title === 'string' ? baseData.title : undefined,
          author:
            typeof baseData.author === 'string'
              ? baseData.author
              : 'Unknown Author',
          isbn: typeof baseData.isbn === 'string' ? baseData.isbn : undefined,
          series:
            typeof baseData.series === 'string' ? baseData.series : undefined,
        },
      },
    );
    const bRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(bookId);
    const dRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails')
      .doc(bookId);

    const cleanCoreUpdates = Object.fromEntries(
      Object.entries(coreUpdates).filter(([, v]) => v !== undefined),
    );
    if (Object.keys(cleanCoreUpdates).length > 0) {
      const nestedMeta: Record<string, unknown> = {};
      for (const k of Object.keys(cleanCoreUpdates)) {
        if (k.startsWith('bookDetailsMetadata.')) {
          const subKey = k.slice('bookDetailsMetadata.'.length);
          nestedMeta[subKey] = cleanCoreUpdates[k];
          delete cleanCoreUpdates[k];
        }
      }
      if (Object.keys(nestedMeta).length > 0) {
        cleanCoreUpdates.bookDetailsMetadata = nestedMeta;
      }
      bgBatch.set(bRef, cleanCoreUpdates, {merge: true});
      bgOps++;
    }

    if (Object.keys(heavyUpdates).length > 0) {
      const cleanHeavyUpdates = Object.fromEntries(
        Object.entries(heavyUpdates).filter(([, v]) => v !== undefined),
      );
      bgBatch.set(
        dRef,
        bookDetailsDocConverter.toFirestoreWrite(
          bookId,
          {
            ...cleanHeavyUpdates,
            updatedAt: FieldValue.serverTimestamp(),
          },
          'update',
          `/libraries/${libraryId}/bookDetails/${bookId}`,
        ),
        {merge: true},
      );
      bgOps++;
    }

    const opStatus =
      (typeof baseData.readingStatus === 'string'
        ? (baseData.readingStatus as ReadingStatusValue)
        : undefined) ?? (isVirtualLib ? 'want_to_read' : undefined);
    if (userId && readingStatesCol && opStatus && opStatus !== 'unset') {
      const oldStateKey = computeReadingStateKey({
        isbn: typeof baseData.isbn === 'string' ? baseData.isbn : undefined,
        cleanIsbn:
          typeof baseData.cleanIsbn === 'string'
            ? baseData.cleanIsbn
            : undefined,
        bookId,
      });
      const mergedBookData: Record<string, unknown> = {
        ...baseData,
        ...patch,
        ownershipStatus:
          baseData.ownershipStatus || (isVirtualLib ? 'unowned' : 'owned'),
      };
      const {stateKey: newStateKey, payload: statePayload} =
        buildReadingStateUpsertPayload({
          userId,
          bookId,
          libraryId,
          isbn:
            typeof mergedBookData.isbn === 'string'
              ? mergedBookData.isbn
              : undefined,
          cleanIsbn:
            typeof mergedBookData.cleanIsbn === 'string'
              ? mergedBookData.cleanIsbn
              : undefined,
          status: opStatus,
          bookData:
            typeof mergedBookData.title === 'string'
              ? mergedBookData
              : undefined,
        });
      bgBatch.set(readingStatesCol.doc(newStateKey), statePayload, {
        merge: true,
      });
      bgOps++;
      if (oldStateKey !== newStateKey) {
        bgBatch.delete(readingStatesCol.doc(oldStateKey));
        bgOps++;
      }
    }

    if (bgOps >= BG_BATCH_LIMIT) {
      await bgBatch.commit();
      bgBatch = db.batch();
      bgOps = 0;
    }
  }
  if (bgOps > 0) {
    await bgBatch.commit();
  }
}

/**
 * Executes atomic batch mutations (create, update, delete) in chunks of up to 400 operations,
 * safely keeping track of parent library volume counter deltas.
 */
export async function batchUpsert(
  userId: string,
  input: BookBatchUpsertInput,
  options?: {allowAiFallback?: boolean},
): Promise<{
  success: true;
  count: number;
  added: number;
  updated: number;
  deleted: number;
}> {
  const libraryId = assertSafeDocId(input.libraryId, 'libraryId');

  const db = getAdminDb();
  const libraryRef = db.collection('libraries').doc(libraryId);

  const ops: NormalizedBatchOperation[] = [];
  let deferredBackgroundPersistence: (() => void) | undefined;

  if (input.enrichOnCreate && input.operations && input.operations.length > 0) {
    const booksToEnrich: Array<{
      id: string;
      title: string;
      author: string;
      isbn?: string;
      [key: string]: unknown;
    }> = [];
    const opById = new Map<string, BatchInputOperation>();

    input.operations.forEach((op, idx) => {
      if (
        (op.type === 'create' || (op.type === 'set' && !op.merge)) &&
        op.data &&
        typeof op.data.title === 'string'
      ) {
        const tempId =
          op.bookId ||
          op.data.id ||
          db.collection('libraries').doc(libraryId).collection('books').doc()
            .id ||
          `temp_${idx}`;
        op.bookId = tempId;
        opById.set(tempId, op);
        booksToEnrich.push({
          ...op.data,
          id: tempId,
          title: op.data.title,
          author:
            typeof op.data.author === 'string'
              ? op.data.author
              : 'Unknown Author',
        });
      }
    });

    if (booksToEnrich.length > 0) {
      const supportsSplitTiers =
        typeof metadataRegistry.enrichBooksOnCreateFastTier === 'function' &&
        typeof metadataRegistry.enrichBooksOnCreateSlowTier === 'function';

      if (supportsSplitTiers) {
        // Fast coalesced Decision pass (Genre + Series standalone gate) runs in ~200-400ms,
        // so up to 30 interactive creates can commit Genre + Series gate synchronously
        // while external catalog & embedding hydration run asynchronously in the background.
        const FAST_SYNC_BUDGET_MS = booksToEnrich.length <= 30 ? 2500 : 0;
        const fastPromise = metadataRegistry.enrichBooksOnCreateFastTier(
          booksToEnrich,
          {
            allowAiFallback: options?.allowAiFallback,
            priority: FAST_SYNC_BUDGET_MS > 0 ? 'INTERACTIVE' : 'BATCH',
          },
        );

        let fastSyncCompleted = false;
        let resolvedFastState:
          | Awaited<
              ReturnType<typeof metadataRegistry.enrichBooksOnCreateFastTier>
            >
          | undefined;

        if (FAST_SYNC_BUDGET_MS > 0) {
          let timerId: ReturnType<typeof setTimeout> | undefined;
          try {
            const raceResult = await Promise.race([
              fastPromise.then(fastState => ({
                status: 'done' as const,
                fastState,
              })),
              new Promise<{status: 'timeout'}>(resolve => {
                timerId = setTimeout(
                  () => resolve({status: 'timeout'}),
                  FAST_SYNC_BUDGET_MS,
                );
              }),
            ]);
            if (raceResult.status === 'done') {
              fastSyncCompleted = true;
              resolvedFastState = raceResult.fastState;
              for (const [
                tempId,
                patch,
              ] of resolvedFastState.updatesByBookId.entries()) {
                const targetOp = opById.get(tempId);
                if (
                  targetOp &&
                  targetOp.data &&
                  Object.keys(patch).length > 0
                ) {
                  targetOp.data = {
                    ...targetOp.data,
                    ...patch,
                  };
                }
              }
            }
          } catch (err) {
            fastSyncCompleted = true;
            console.warn(
              '[BookWriteService] Fast-tier enrichOnCreate encountered partial error, continuing with base payload:',
              err,
            );
          } finally {
            if (timerId !== undefined) {
              clearTimeout(timerId);
            }
          }
        }

        const backgroundUpdatesPromise: Promise<
          Map<string, Record<string, unknown>>
        > =
          fastSyncCompleted && resolvedFastState
            ? metadataRegistry.enrichBooksOnCreateSlowTier(resolvedFastState, {
                allowAiFallback: options?.allowAiFallback,
                priority: 'BATCH',
              })
            : fastPromise.then(async fastState => {
                const slowDelta =
                  await metadataRegistry.enrichBooksOnCreateSlowTier(
                    fastState,
                    {
                      allowAiFallback: options?.allowAiFallback,
                      priority: 'BATCH',
                    },
                  );
                return fastSyncCompleted
                  ? slowDelta
                  : mergeOnCreateUpdateMaps(
                      fastState.updatesByBookId,
                      slowDelta,
                    );
              });

        // Prevent unhandled rejection before primary Firestore commit completes
        backgroundUpdatesPromise.catch(() => undefined);

        deferredBackgroundPersistence = () => {
          void backgroundUpdatesPromise
            .then(enrichedMap =>
              persistBackgroundOnCreateUpdates({
                db,
                libraryId,
                userId,
                enrichedMap,
                opById,
              }),
            )
            .catch(err => {
              console.warn(
                '[BookWriteService] Background enrichOnCreate failed:',
                err,
              );
            });
        };
      } else {
        const enrichmentPromise = metadataRegistry.enrichBooksOnCreate(
          booksToEnrich,
          {allowAiFallback: options?.allowAiFallback},
        );
        const SYNC_BUDGET_MS = booksToEnrich.length <= 2 ? 2500 : 0;
        let syncCompleted = false;

        if (SYNC_BUDGET_MS > 0) {
          let timerId: ReturnType<typeof setTimeout> | undefined;
          try {
            const raceResult = await Promise.race([
              enrichmentPromise.then(map => ({status: 'done' as const, map})),
              new Promise<{status: 'timeout'}>(resolve => {
                timerId = setTimeout(
                  () => resolve({status: 'timeout'}),
                  SYNC_BUDGET_MS,
                );
              }),
            ]);
            if (raceResult.status === 'done') {
              syncCompleted = true;
              for (const [tempId, patch] of raceResult.map.entries()) {
                const targetOp = opById.get(tempId);
                if (
                  targetOp &&
                  targetOp.data &&
                  Object.keys(patch).length > 0
                ) {
                  targetOp.data = {
                    ...targetOp.data,
                    ...patch,
                  };
                }
              }
            }
          } catch (err) {
            syncCompleted = true;
            console.warn(
              '[BookWriteService] Server-side enrichOnCreate encountered partial error, continuing with base payload:',
              err,
            );
          } finally {
            if (timerId !== undefined) {
              clearTimeout(timerId);
            }
          }
        }

        if (!syncCompleted) {
          enrichmentPromise.catch(() => undefined);
          deferredBackgroundPersistence = () => {
            void enrichmentPromise
              .then(enrichedMap =>
                persistBackgroundOnCreateUpdates({
                  db,
                  libraryId,
                  userId,
                  enrichedMap,
                  opById,
                }),
              )
              .catch(err => {
                console.warn(
                  '[BookWriteService] Background enrichOnCreate failed:',
                  err,
                );
              });
          };
        }
      }
    }
  }

  if (input.operations && input.operations.length > 0) {
    for (const op of input.operations) {
      const rawBookId = op.bookId || op.data?.id;
      const bookId = rawBookId
        ? assertSafeDocId(rawBookId, 'bookId')
        : db.collection('libraries').doc(libraryId).collection('books').doc()
            .id;

      if (op.type === 'delete') {
        ops.push({type: 'delete', bookId});
      } else if (op.type === 'create' || (op.type === 'set' && !op.merge)) {
        const isVirtualLib = libraryId.startsWith('virtual_');
        const rawData = (op.data || {}) as Record<string, unknown>;
        const readingStatus =
          (typeof rawData.readingStatus === 'string'
            ? (rawData.readingStatus as ReadingStatusValue)
            : undefined) ?? (isVirtualLib ? 'want_to_read' : undefined);
        const combinedInput: Record<string, unknown> = {
          ...rawData,
          ownershipStatus:
            rawData.ownershipStatus || (isVirtualLib ? 'unowned' : 'owned'),
          ...(op.heavyData ? {heavyData: op.heavyData} : {}),
        };
        const {cleanCore, cleanHeavy} = BookPartitioner.partitionCreatePayload(
          combinedInput,
          bookId,
          userId,
          FieldValue.serverTimestamp(),
        );
        ops.push({
          type: op.type,
          bookId,
          coreData: cleanCore,
          heavyData:
            Object.keys(cleanHeavy).length > 0 ? cleanHeavy : op.heavyData,
          ...(readingStatus ? {readingStatus} : {}),
          merge: op.merge,
        });
      } else {
        const rawData = (op.data || {}) as Record<string, unknown>;
        const readingStatus =
          typeof rawData.readingStatus === 'string'
            ? (rawData.readingStatus as ReadingStatusValue)
            : undefined;
        const combinedUpdates: Record<string, unknown> = {
          ...rawData,
          ...(op.heavyData ? {heavyData: op.heavyData} : {}),
        };
        const {coreUpdates, heavyUpdates} =
          BookPartitioner.partitionUpdatePayload(
            combinedUpdates,
            FieldValue.serverTimestamp(),
            {callerUserId: userId},
          );
        ops.push({
          type: op.type,
          bookId,
          coreData: coreUpdates,
          heavyData:
            Object.keys(heavyUpdates).length > 0 ? heavyUpdates : op.heavyData,
          ...(readingStatus ? {readingStatus} : {}),
          merge: op.merge,
        });
      }
    }
  } else if (input.books && input.books.length > 0) {
    for (const b of input.books) {
      const rawBookId = b.id || b.bookId;
      const bookId = rawBookId
        ? assertSafeDocId(rawBookId, 'bookId')
        : db.collection('libraries').doc(libraryId).collection('books').doc()
            .id;
      const action = b.action || b.operation || (b.id ? 'upsert' : 'create');
      const readingStatus = b.readingStatus;

      if (action === 'delete') {
        ops.push({type: 'delete', bookId});
      } else if (action === 'update') {
        const raw: Record<string, unknown> = {...b};
        delete raw.action;
        delete raw.operation;
        delete raw.id;
        delete raw.bookId;
        const {coreUpdates, heavyUpdates} =
          BookPartitioner.partitionUpdatePayload(
            raw,
            FieldValue.serverTimestamp(),
            {callerUserId: userId},
          );
        ops.push({
          type: 'update',
          bookId,
          coreData: coreUpdates,
          heavyData:
            Object.keys(heavyUpdates).length > 0 ? heavyUpdates : undefined,
          ...(readingStatus ? {readingStatus} : {}),
        });
      } else {
        const {cleanCore, cleanHeavy} = BookPartitioner.partitionCreatePayload(
          b,
          bookId,
          userId,
          FieldValue.serverTimestamp(),
        );

        ops.push({
          type: action === 'upsert' ? 'set' : 'create',
          bookId,
          coreData: cleanCore,
          heavyData:
            Object.keys(cleanHeavy).length > 0 ? cleanHeavy : undefined,
          ...(readingStatus ? {readingStatus} : {}),
          merge: action === 'upsert',
        });
      }
    }
  }

  let addedCount = 0;
  let updatedCount = 0;
  let deletedCount = 0;

  const BATCH_LIMIT = 400;
  let currentBatch = db.batch();
  let currentBatchOps = 0;

  const deleteOps = ops.filter(op => op.type === 'delete');
  const reviewsByDeletedBookId = new Map<
    string,
    FirebaseFirestore.QuerySnapshot
  >();
  if (deleteOps.length > 0) {
    await Promise.all(
      deleteOps.map(async op => {
        try {
          const bookRef = db
            .collection('libraries')
            .doc(libraryId)
            .collection('books')
            .doc(op.bookId);
          if (typeof bookRef?.collection === 'function') {
            const reviewsSnap = await bookRef.collection('reviews').get();
            reviewsByDeletedBookId.set(op.bookId, reviewsSnap);
          }
        } catch {
          // Non-fatal if reviews subcollection is empty or mocked
        }
      }),
    );
  }

  const statusUpdateOpsNeedingBookData = userId
    ? ops.filter(
        op =>
          op.readingStatus &&
          op.type !== 'delete' &&
          typeof op.coreData?.title !== 'string',
      )
    : [];
  const existingBookDataByBookId = new Map<string, Record<string, unknown>>();
  if (statusUpdateOpsNeedingBookData.length > 0) {
    await Promise.all(
      statusUpdateOpsNeedingBookData.map(async op => {
        const existingData = await fetchExistingBookDataForSnapshot(
          db,
          libraryId,
          op.bookId,
          userId,
        );
        if (existingData) {
          existingBookDataByBookId.set(op.bookId, existingData);
        }
      }),
    );
  }

  for (const op of ops) {
    const bookRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(op.bookId);
    const detailRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails')
      .doc(op.bookId);

    if (op.type === 'delete') {
      currentBatch.delete(bookRef);
      currentBatch.delete(detailRef);
      currentBatchOps += 2;
      deletedCount++;

      const reviewsSnap = reviewsByDeletedBookId.get(op.bookId);
      if (reviewsSnap) {
        const reviewRefs: FirebaseFirestore.DocumentReference[] = [];
        reviewsSnap.forEach(reviewDoc => {
          reviewRefs.push(reviewDoc.ref);
        });
        for (const revRef of reviewRefs) {
          if (currentBatchOps >= BATCH_LIMIT) {
            await currentBatch.commit();
            currentBatch = db.batch();
            currentBatchOps = 0;
          }
          currentBatch.delete(revRef);
          currentBatchOps++;
        }
      }
    } else if (op.type === 'create' || (op.type === 'set' && !op.merge)) {
      const cleanCore = Object.fromEntries(
        Object.entries(op.coreData || {}).filter(
          ([, v]) => v !== undefined && v !== null && v !== '',
        ),
      );
      cleanCore.id = op.bookId;
      cleanCore.addedBy = cleanCore.addedBy || userId || null;
      cleanCore.addedAt = cleanCore.addedAt || FieldValue.serverTimestamp();
      cleanCore.updatedAt = FieldValue.serverTimestamp();

      currentBatch.set(bookRef, cleanCore);
      currentBatchOps++;
      addedCount++;

      if (op.heavyData && Object.keys(op.heavyData).length > 0) {
        const cleanHeavy = Object.fromEntries(
          Object.entries(op.heavyData).filter(
            ([, v]) => v !== undefined && v !== null,
          ),
        );
        currentBatch.set(
          detailRef,
          bookDetailsDocConverter.toFirestoreWrite(
            op.bookId,
            {
              ...cleanHeavy,
              updatedAt: FieldValue.serverTimestamp(),
            },
            'create',
            `/libraries/${libraryId}/bookDetails/${op.bookId}`,
          ),
        );
        currentBatchOps++;
      }
    } else {
      const cleanUpdates = Object.fromEntries(
        Object.entries(op.coreData || {}).filter(([, v]) => v !== undefined),
      );
      cleanUpdates.updatedAt = FieldValue.serverTimestamp();

      if (op.merge) {
        const nestedMeta: Record<string, unknown> =
          cleanUpdates.bookDetailsMetadata &&
          typeof cleanUpdates.bookDetailsMetadata === 'object'
            ? {...(cleanUpdates.bookDetailsMetadata as Record<string, unknown>)}
            : {};
        for (const k of Object.keys(cleanUpdates)) {
          if (k.startsWith('bookDetailsMetadata.')) {
            const subKey = k.slice('bookDetailsMetadata.'.length);
            nestedMeta[subKey] = cleanUpdates[k];
            delete cleanUpdates[k];
          }
        }
        if (Object.keys(nestedMeta).length > 0) {
          cleanUpdates.bookDetailsMetadata = nestedMeta;
        }
        currentBatch.set(bookRef, cleanUpdates, {merge: true});
      } else {
        currentBatch.update(bookRef, cleanUpdates);
      }
      currentBatchOps++;
      updatedCount++;

      if (op.heavyData && Object.keys(op.heavyData).length > 0) {
        const cleanHeavy = Object.fromEntries(
          Object.entries(op.heavyData).filter(([, v]) => v !== undefined),
        );
        currentBatch.set(
          detailRef,
          bookDetailsDocConverter.toFirestoreWrite(
            op.bookId,
            {
              ...cleanHeavy,
              updatedAt: FieldValue.serverTimestamp(),
            },
            'update',
            `/libraries/${libraryId}/bookDetails/${op.bookId}`,
          ),
          {merge: true},
        );
        currentBatchOps++;
      }
    }

    if (userId && op.readingStatus && op.type !== 'delete') {
      const readingStatesCol = getReadingStatesCollection(db, userId);
      if (readingStatesCol) {
        const existingData = existingBookDataByBookId.get(op.bookId) || {};
        const cleanOpCore: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.coreData || {})) {
          if (k.includes('.') || isFirestoreFieldValueSentinel(v)) {
            continue;
          }
          cleanOpCore[k] = v;
        }
        const baseData: Record<string, unknown> = {
          ...existingData,
          ...cleanOpCore,
        };
        const mergedBookData: Record<string, unknown> = {
          ...baseData,
          ...(op.heavyData || {}),
        };
        const {stateKey, payload} = buildReadingStateUpsertPayload({
          userId,
          bookId: op.bookId,
          libraryId,
          isbn: typeof baseData.isbn === 'string' ? baseData.isbn : undefined,
          cleanIsbn:
            typeof baseData.cleanIsbn === 'string'
              ? baseData.cleanIsbn
              : undefined,
          status: op.readingStatus,
          bookData:
            typeof mergedBookData.title === 'string'
              ? mergedBookData
              : undefined,
        });
        currentBatch.set(readingStatesCol.doc(stateKey), payload, {
          merge: true,
        });
        currentBatchOps++;
      }
    }

    if (currentBatchOps >= BATCH_LIMIT) {
      await currentBatch.commit();
      currentBatch = db.batch();
      currentBatchOps = 0;
    }
  }

  const netCountDelta = addedCount - deletedCount;
  if (netCountDelta !== 0 || ops.length > 0) {
    const libUpdatePayload: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (netCountDelta !== 0) {
      libUpdatePayload.bookCount = FieldValue.increment(netCountDelta);
    }
    validateFirestoreWritePayload(
      storedLibraryDocSchema.partial(),
      libUpdatePayload,
      {
        entity: 'StoredLibraryDoc',
        documentPath: `/libraries/${libraryId}`,
        operation: 'update',
      },
    );
    currentBatch.update(libraryRef, libUpdatePayload);
    currentBatchOps++;
  }

  if (currentBatchOps > 0) {
    await currentBatch.commit();
  }

  if (deferredBackgroundPersistence) {
    deferredBackgroundPersistence();
  }

  if (netCountDelta !== 0) {
    LibraryMetadataCache.adjustBookCount(libraryId, netCountDelta);
  } else if (ops.length > 0) {
    LibraryMetadataCache.invalidate(libraryId);
  }
  if (deleteOps.length > 0) {
    LibraryMetadataCache.recordDeletedBooks(
      libraryId,
      deleteOps.map(op => op.bookId),
    );
  }

  return {
    success: true,
    count: ops.length,
    added: addedCount,
    updated: updatedCount,
    deleted: deletedCount,
  };
}
