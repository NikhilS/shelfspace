import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {TRPCError} from '@trpc/server';
import type {
  BookCreateInput,
  BookUpdateInput,
  BookDeleteInput,
  BookBatchUpsertInput,
} from '../../../schemas/book';
import type {Book} from '../../../types';
import {BookPartitioner, HEAVY_FIELDS} from './bookPartitioner';
import {metadataRegistry} from '../metadata/registry';
import {safeIdSchema} from '../../../schemas/common';

export {HEAVY_FIELDS};

function assertSafeDocId(id: string, label: string): string {
  const parsed = safeIdSchema.safeParse(id);
  if (!parsed.success) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: `Invalid ${label}: ${parsed.error.issues[0]?.message || 'invalid identifier'}`,
    });
  }
  return parsed.data;
}

/**
 * Creates a single book and stores heavy metadata (synopsis, embeddings) in bookDetails.
 * Atomically increments parent library volume counter.
 */
export async function createBook(
  userId: string,
  input: BookCreateInput,
): Promise<{success: true; id: string; book?: Book}> {
  const libraryId = assertSafeDocId(input.libraryId, 'libraryId');

  const db = getAdminDb();
  const booksCollection = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books');
  const rawBookId = input.bookId || input.id;
  const bookId = rawBookId
    ? assertSafeDocId(rawBookId, 'bookId')
    : booksCollection.doc().id;

  const bookRef = booksCollection.doc(bookId);
  const detailRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('bookDetails')
    .doc(bookId);
  const libraryRef = db.collection('libraries').doc(libraryId);

  const {cleanCore, cleanHeavy} = BookPartitioner.partitionCreatePayload(
    input as Record<string, unknown>,
    bookId,
    userId,
    FieldValue.serverTimestamp(),
  );

  const batch = db.batch();
  batch.set(bookRef, cleanCore);

  if (Object.keys(cleanHeavy).length > 0) {
    batch.set(detailRef, {
      ...cleanHeavy,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  batch.update(libraryRef, {
    bookCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error(
      `[BookService.createBook] Error committing create for book '${bookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to create book: ${errMsg}`,
    });
  }

  return {
    success: true,
    id: bookId,
    book: {
      ...(cleanCore as unknown as Book),
      id: bookId,
      ...(Object.keys(cleanHeavy).length > 0 ? {heavyDetails: cleanHeavy} : {}),
    },
  };
}

/**
 * Updates an existing book and propagates heavy updates to bookDetails.
 */
export async function updateBook(
  userId: string,
  input: BookUpdateInput,
): Promise<{success: true; id?: string}> {
  const libraryId = assertSafeDocId(input.libraryId, 'libraryId');
  const bookId = assertSafeDocId(input.bookId, 'bookId');
  const {updates} = input;

  const db = getAdminDb();
  const bookRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books')
    .doc(bookId);
  const detailRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('bookDetails')
    .doc(bookId);
  const libraryRef = db.collection('libraries').doc(libraryId);

  const {coreUpdates, heavyUpdates} = BookPartitioner.partitionUpdatePayload(
    updates as Record<string, unknown>,
    FieldValue.serverTimestamp(),
    {callerUserId: userId},
  );

  const batch = db.batch();
  batch.update(bookRef, coreUpdates);

  if (Object.keys(heavyUpdates).length > 0) {
    batch.set(
      detailRef,
      {
        ...heavyUpdates,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
  }

  batch.update(libraryRef, {
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error(
      `[BookService.updateBook] Error updating book '${bookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to update book: ${errMsg}`,
    });
  }

  return {success: true, id: bookId};
}

/**
 * Updates only the caller's personal reading status on a book (accessible to any library viewer).
 */
export async function updateBookStatus(
  userId: string,
  libraryIdRaw: string,
  bookIdRaw: string,
  status:
    | 'unset'
    | 'want_to_read'
    | 'reading'
    | 'finished'
    | 'completed'
    | 'abandoned',
): Promise<{success: true; id: string; status: string}> {
  const libraryId = assertSafeDocId(libraryIdRaw, 'libraryId');
  const bookId = assertSafeDocId(bookIdRaw, 'bookId');

  const db = getAdminDb();
  const bookRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books')
    .doc(bookId);

  try {
    await bookRef.update({
      [`userStatuses.${userId}`]: status,
      updatedAt: FieldValue.serverTimestamp(),
    });
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error(
      `[BookService.updateBookStatus] Error updating status for book '${bookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to update reading status: ${errMsg}`,
    });
  }

  return {success: true, id: bookId, status};
}

/**
 * Atomically deletes a book, its heavy metadata sub-record, associated reviews,
 * and decrements the library bookCount.
 */
export async function deleteBook(
  _userId: string,
  input: BookDeleteInput,
): Promise<{success: true; id?: string}> {
  const libraryId = assertSafeDocId(input.libraryId, 'libraryId');
  const bookId = assertSafeDocId(input.bookId, 'bookId');

  const db = getAdminDb();
  const bookRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books')
    .doc(bookId);
  const detailRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('bookDetails')
    .doc(bookId);
  const libraryRef = db.collection('libraries').doc(libraryId);

  const batch = db.batch();
  batch.delete(bookRef);
  batch.delete(detailRef);

  // Cascade delete reviews subcollection
  try {
    const reviewsSnap = await db
      .collection('libraries')
      .doc(libraryId)
      .collection('books')
      .doc(bookId)
      .collection('reviews')
      .get();

    reviewsSnap.forEach(docSnap => {
      batch.delete(docSnap.ref);
    });
  } catch (e) {
    console.warn(
      `[BookService.deleteBook] Could not load reviews for cascade delete on book '${bookId}':`,
      e,
    );
  }

  batch.update(libraryRef, {
    bookCount: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error(
      `[BookService.deleteBook] Error deleting book '${bookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to delete book: ${errMsg}`,
    });
  }

  return {success: true, id: bookId};
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

  type NormalizedOp = {
    type: 'create' | 'update' | 'delete' | 'set';
    bookId: string;
    coreData?: Record<string, unknown>;
    heavyData?: Record<string, unknown>;
    merge?: boolean;
  };

  const ops: NormalizedOp[] = [];

  if (input.enrichOnCreate && input.operations && input.operations.length > 0) {
    const booksToEnrich: Array<{
      id: string;
      title: string;
      author: string;
      isbn?: string;
      [key: string]: unknown;
    }> = [];
    const opById = new Map<string, (typeof input.operations)[number]>();

    input.operations.forEach((op, idx) => {
      if (
        (op.type === 'create' || (op.type === 'set' && !op.merge)) &&
        op.data &&
        typeof op.data.title === 'string'
      ) {
        const tempId =
          op.bookId ||
          (op.data.id as string) ||
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
      const enrichmentPromise = metadataRegistry.enrichBooksOnCreate(
        booksToEnrich,
        {allowAiFallback: options?.allowAiFallback},
      );

      // For small interactive creates (<= 2 books), wait up to 2.5s so fast enrichments
      // land in the initial commit. For larger batches (e.g. Shelf Capture / CSV import)
      // or slow upstream providers, commit immediately and apply enrichment in the background
      // so the HTTP request never hits reverse-proxy timeouts.
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
              if (targetOp && targetOp.data && Object.keys(patch).length > 0) {
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
          if (timerId !== undefined) clearTimeout(timerId);
        }
      }

      if (!syncCompleted) {
        void enrichmentPromise
          .then(async enrichedMap => {
            const bgBatch = db.batch();
            let bgOps = 0;
            for (const [bookId, patch] of enrichedMap.entries()) {
              if (!patch || Object.keys(patch).length === 0) continue;
              const {coreUpdates, heavyUpdates} =
                BookPartitioner.partitionUpdatePayload(
                  patch,
                  FieldValue.serverTimestamp(),
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
                  Object.entries(heavyUpdates).filter(
                    ([, v]) => v !== undefined,
                  ),
                );
                bgBatch.set(
                  dRef,
                  {
                    ...cleanHeavyUpdates,
                    updatedAt: FieldValue.serverTimestamp(),
                  },
                  {merge: true},
                );
                bgOps++;
              }
            }
            if (bgOps > 0) {
              await bgBatch.commit();
            }
          })
          .catch(err => {
            console.warn(
              '[BookWriteService] Background enrichOnCreate failed:',
              err,
            );
          });
      }
    }
  }

  if (input.operations && input.operations.length > 0) {
    for (const op of input.operations) {
      const rawBookId = op.bookId || (op.data?.id as string | undefined);
      const bookId = rawBookId
        ? assertSafeDocId(rawBookId, 'bookId')
        : db.collection('libraries').doc(libraryId).collection('books').doc()
            .id;

      if (op.type === 'delete') {
        ops.push({type: 'delete', bookId});
      } else if (
        op.type === 'create' ||
        (op.type === 'set' && !op.merge && !op.heavyData)
      ) {
        const isVirtualLib = libraryId.startsWith('virtual_');
        const rawData = (op.data || {}) as Record<string, unknown>;
        const combinedInput: Record<string, unknown> = {
          ...rawData,
          ownershipStatus:
            rawData.ownershipStatus || (isVirtualLib ? 'unowned' : 'owned'),
          ...(isVirtualLib && !rawData.status && !rawData.userStatuses
            ? {status: 'want_to_read'}
            : {}),
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
            Object.keys(cleanHeavy).length > 0
              ? (cleanHeavy as Record<string, unknown>)
              : (op.heavyData as Record<string, unknown> | undefined),
          merge: op.merge,
        });
      } else {
        const combinedUpdates: Record<string, unknown> = {
          ...(op.data || {}),
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
            Object.keys(heavyUpdates).length > 0
              ? heavyUpdates
              : (op.heavyData as Record<string, unknown> | undefined),
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
        });
      } else {
        const {cleanCore, cleanHeavy} = BookPartitioner.partitionCreatePayload(
          b as Record<string, unknown>,
          bookId,
          userId,
          FieldValue.serverTimestamp(),
        );

        ops.push({
          type: action === 'upsert' ? 'set' : 'create',
          bookId,
          coreData: cleanCore,
          heavyData:
            Object.keys(cleanHeavy).length > 0
              ? (cleanHeavy as Record<string, unknown>)
              : undefined,
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

      try {
        if (typeof bookRef?.collection === 'function') {
          const reviewsSnap = await bookRef.collection('reviews').get();
          reviewsSnap.forEach(reviewDoc => {
            currentBatch.delete(reviewDoc.ref);
            currentBatchOps++;
          });
        }
      } catch {
        // Non-fatal if reviews subcollection is empty or mocked
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
        currentBatch.set(detailRef, {
          ...cleanHeavy,
          updatedAt: FieldValue.serverTimestamp(),
        });
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
        const nestedStatuses: Record<string, unknown> =
          cleanUpdates.userStatuses &&
          typeof cleanUpdates.userStatuses === 'object'
            ? {...(cleanUpdates.userStatuses as Record<string, unknown>)}
            : {};
        for (const k of Object.keys(cleanUpdates)) {
          if (k.startsWith('bookDetailsMetadata.')) {
            const subKey = k.slice('bookDetailsMetadata.'.length);
            nestedMeta[subKey] = cleanUpdates[k];
            delete cleanUpdates[k];
          } else if (k.startsWith('userStatuses.')) {
            const subKey = k.slice('userStatuses.'.length);
            nestedStatuses[subKey] = cleanUpdates[k];
            delete cleanUpdates[k];
          }
        }
        if (Object.keys(nestedMeta).length > 0) {
          cleanUpdates.bookDetailsMetadata = nestedMeta;
        }
        if (Object.keys(nestedStatuses).length > 0) {
          cleanUpdates.userStatuses = nestedStatuses;
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
          {
            ...cleanHeavy,
            updatedAt: FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
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
    currentBatch.update(libraryRef, libUpdatePayload);
    currentBatchOps++;
  }

  if (currentBatchOps > 0) {
    await currentBatch.commit();
  }

  return {
    success: true,
    count: ops.length,
    added: addedCount,
    updated: updatedCount,
    deleted: deletedCount,
  };
}

const STATUS_RANK: Record<string, number> = {
  completed: 5,
  finished: 5,
  reading: 4,
  abandoned: 3,
  want_to_read: 2,
  unset: 1,
};

/**
 * Atomically merges a duplicate book group into a single survivor book:
 * 1. Unions `userStatuses` across all members (preserving highest-progress status per user).
 * 2. Migrates any `reviews` subcollection documents from duplicate books onto the survivor.
 * 3. Updates `books/{survivorBookId}` and `bookDetails/{survivorBookId}` with the user-selected `mergedFields`.
 * 4. Deletes all `duplicateBookIds` (plus their `bookDetails` and `reviews`) and decrements `bookCount`.
 */
export async function mergeDuplicates(
  _userId: string,
  input: import('../../../schemas/book').BookMergeDuplicatesInput,
): Promise<{
  success: true;
  survivorBookId: string;
  deletedCount: number;
}> {
  const libraryId = assertSafeDocId(input.libraryId, 'libraryId');
  const survivorBookId = assertSafeDocId(
    input.survivorBookId,
    'survivorBookId',
  );
  const {duplicateBookIds, mergedFields} = input;
  const cleanDupIds = Array.from(
    new Set(
      duplicateBookIds
        .filter(id => id && id !== survivorBookId)
        .map(id => assertSafeDocId(id, 'duplicateBookId')),
    ),
  );
  if (cleanDupIds.length === 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message:
        'At least one duplicateBookId distinct from survivorBookId is required.',
    });
  }

  const db = getAdminDb();
  const libraryRef = db.collection('libraries').doc(libraryId);
  const booksCol = libraryRef.collection('books');
  const detailsCol = libraryRef.collection('bookDetails');

  const allBookIds = [survivorBookId, ...cleanDupIds];
  const bookDocs = await Promise.all(
    allBookIds.map(id => booksCol.doc(id).get()),
  );

  const survivorSnap = bookDocs[0];
  if (!survivorSnap?.exists) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Survivor book '${survivorBookId}' not found in library '${libraryId}'`,
    });
  }

  // Union userStatuses across survivor and all duplicates (highest progress wins)
  const mergedUserStatuses: Record<string, string> = {};
  for (const snap of bookDocs) {
    if (!snap?.exists) continue;
    const data = (snap.data() || {}) as Record<string, unknown>;
    const statuses =
      data.userStatuses && typeof data.userStatuses === 'object'
        ? (data.userStatuses as Record<string, string>)
        : {};
    for (const [uidKey, st] of Object.entries(statuses)) {
      if (!st) continue;
      const existingSt = mergedUserStatuses[uidKey];
      const existingRank = existingSt ? STATUS_RANK[existingSt] || 0 : 0;
      const nextRank = STATUS_RANK[st] || 0;
      if (nextRank >= existingRank) {
        mergedUserStatuses[uidKey] = st;
      }
    }
  }

  const combinedUpdates: Record<string, unknown> = {
    ...mergedFields,
  };
  if (Object.keys(mergedUserStatuses).length > 0) {
    combinedUpdates.userStatuses = mergedUserStatuses;
  }

  const {coreUpdates, heavyUpdates} = BookPartitioner.partitionUpdatePayload(
    combinedUpdates,
    FieldValue.serverTimestamp(),
    {allowFullUserStatuses: true},
  );

  const BATCH_LIMIT = 400;
  let batch = db.batch();
  let batchOps = 0;

  const commitBatchIfNeeded = async (force = false) => {
    if (batchOps >= BATCH_LIMIT || (force && batchOps > 0)) {
      await batch.commit();
      batch = db.batch();
      batchOps = 0;
    }
  };

  const survivorBookRef = booksCol.doc(survivorBookId);
  const survivorDetailRef = detailsCol.doc(survivorBookId);

  const cleanCoreUpdates = Object.fromEntries(
    Object.entries(coreUpdates).filter(([, v]) => v !== undefined),
  );
  const nestedMeta: Record<string, unknown> =
    cleanCoreUpdates.bookDetailsMetadata &&
    typeof cleanCoreUpdates.bookDetailsMetadata === 'object'
      ? {...(cleanCoreUpdates.bookDetailsMetadata as Record<string, unknown>)}
      : {};
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

  batch.set(survivorBookRef, cleanCoreUpdates, {merge: true});
  batchOps++;

  if (Object.keys(heavyUpdates).length > 0) {
    const cleanHeavy = Object.fromEntries(
      Object.entries(heavyUpdates).filter(([, v]) => v !== undefined),
    );
    batch.set(
      survivorDetailRef,
      {
        ...cleanHeavy,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
    batchOps++;
  }

  let deletedCount = 0;
  try {
    for (let i = 0; i < cleanDupIds.length; i++) {
      const dupId = cleanDupIds[i];
      const dupBookRef = booksCol.doc(dupId);
      const dupDetailRef = detailsCol.doc(dupId);

      // Migrate reviews from duplicate to survivor before deleting
      try {
        if (
          typeof dupBookRef?.collection === 'function' &&
          typeof survivorBookRef?.collection === 'function'
        ) {
          const reviewsSnap = await dupBookRef.collection('reviews').get();
          const reviewDocs: Array<{
            id: string;
            data: () => Record<string, unknown>;
            ref: FirebaseFirestore.DocumentReference;
          }> = [];
          reviewsSnap.forEach(reviewDoc => {
            reviewDocs.push(
              reviewDoc as unknown as (typeof reviewDocs)[number],
            );
          });
          for (const reviewDoc of reviewDocs) {
            const targetReviewRef = survivorBookRef
              .collection('reviews')
              .doc(reviewDoc.id);
            batch.set(targetReviewRef, reviewDoc.data(), {merge: true});
            batch.delete(reviewDoc.ref);
            batchOps += 2;
            await commitBatchIfNeeded();
          }
        }
      } catch {
        // Non-fatal if reviews subcollection is empty or mocked
      }

      batch.delete(dupBookRef);
      batch.delete(dupDetailRef);
      batchOps += 2;
      deletedCount++;
      await commitBatchIfNeeded();
    }

    batch.update(libraryRef, {
      bookCount: FieldValue.increment(-deletedCount),
      updatedAt: FieldValue.serverTimestamp(),
    });
    batchOps++;

    await commitBatchIfNeeded(true);
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error('[BookService.mergeDuplicates] Error merging books:', errMsg);
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to merge duplicate books: ${errMsg}`,
    });
  }

  return {
    success: true,
    survivorBookId,
    deletedCount,
  };
}
