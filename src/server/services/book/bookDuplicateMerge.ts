import {TRPCError} from '@trpc/server';
import {FieldValue} from 'firebase-admin/firestore';
import {
  storedReviewDocSchema,
  type BookMergeDuplicatesInput,
} from '../../../schemas/book';
import {
  isFirestoreFieldValueSentinel,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {storedLibraryDocSchema} from '../../../schemas/libraryApi';
import type {UserReadingState} from '../../../types';
import {formatFirestoreAdminError, getAdminDb} from '../firebaseAdmin';
import {LibraryMetadataCache} from '../library/libraryMetadataCache';
import {
  BookPartitioner,
  bookDetailsDocConverter,
  bookDocConverter,
} from './bookPartitioner';
import {reviewDocConverter} from './bookReviewService';
import {stageBookTombstoneInBatch} from './bookTombstoneLedger';
import {assertSafeDocId} from './bookWriteIds';
import {
  buildReadingStateUpsertPayload,
  computeReadingStateKey,
  getReadingStatesCollection,
  normalizeReadingStateDoc,
} from './readingStateLedger';

/**
 * Atomically merges a duplicate book group into a single survivor book:
 * 1. Migrates any `reviews` subcollection documents from duplicate books onto the survivor.
 * 2. Updates `books/{survivorBookId}` and `bookDetails/{survivorBookId}` with the user-selected `mergedFields`.
 * 3. Migrates/updates the caller's `/users/{userId}/readingStates` entry onto `book:<libraryId>:<survivorBookId>`.
 * 4. Deletes all `duplicateBookIds` (plus their `bookDetails` and `reviews`), stages durable tombstones, and decrements `bookCount`.
 */
export async function mergeDuplicates(
  userId: string,
  input: BookMergeDuplicatesInput,
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
  const bookRefs = allBookIds.map(id => booksCol.doc(id));
  const bookDocs = await db.getAll(...bookRefs);

  const survivorSnap = bookDocs[0];
  if (!survivorSnap?.exists) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Survivor book '${survivorBookId}' not found in library '${libraryId}'`,
    });
  }

  const survivorData = bookDocConverter.fromFirestore(
    survivorBookId,
    survivorSnap.data() || {},
    `/libraries/${libraryId}/books/${survivorBookId}`,
  );

  const combinedUpdates: Record<string, unknown> = {
    ...mergedFields,
  };

  const {coreUpdates, heavyUpdates} = BookPartitioner.partitionUpdatePayload(
    combinedUpdates,
    FieldValue.serverTimestamp(),
    {
      existingBook: survivorData,
    },
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
      bookDetailsDocConverter.toFirestoreWrite(
        survivorBookId,
        {
          ...cleanHeavy,
          updatedAt: FieldValue.serverTimestamp(),
        },
        'update',
        `/libraries/${libraryId}/bookDetails/${survivorBookId}`,
      ),
      {merge: true},
    );
    batchOps++;
  }

  if (userId) {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (readingStatesCol) {
      const candidateStateKeys = new Set<string>();
      candidateStateKeys.add(
        computeReadingStateKey({
          libraryId,
          isbn: survivorData.isbn,
          cleanIsbn: survivorData.cleanIsbn,
          bookId: survivorBookId,
        }),
      );
      if (survivorData.cleanIsbn) {
        candidateStateKeys.add(`ext:${survivorData.cleanIsbn}`);
      }

      for (let i = 0; i < cleanDupIds.length; i++) {
        const dupId = cleanDupIds[i];
        const dupSnap = bookDocs[i + 1];
        candidateStateKeys.add(`book:${libraryId}:${dupId}`);
        if (dupSnap?.exists) {
          const dupRaw = (dupSnap.data() || {}) as Record<string, unknown>;
          if (typeof dupRaw.cleanIsbn === 'string' && dupRaw.cleanIsbn) {
            candidateStateKeys.add(`ext:${dupRaw.cleanIsbn}`);
          }
        }
      }

      const foundStates: Array<{
        key: string;
        state: Partial<UserReadingState>;
      }> = [];
      for (const key of candidateStateKeys) {
        const stateSnap = await readingStatesCol.doc(key).get();
        if (stateSnap.exists) {
          const parsed = normalizeReadingStateDoc(
            stateSnap.id || key,
            stateSnap.data() || {},
            userId,
          );
          foundStates.push({key, state: parsed});
        }
      }

      if (foundStates.length > 0) {
        const cleanSurvivorCoreForSnapshot: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(cleanCoreUpdates)) {
          if (k === 'bookDetailsMetadata' || isFirestoreFieldValueSentinel(v)) {
            continue;
          }
          cleanSurvivorCoreForSnapshot[k] = v;
        }

        const primaryState =
          foundStates.find(s => s.state.status && s.state.status !== 'unset')
            ?.state || foundStates[0].state;
        const ratedState =
          foundStates.find(s => typeof s.state.rating === 'number')?.state ||
          primaryState;

        const mergedSurvivorSnapshotSource: Record<string, unknown> = {
          ...(primaryState.bookSnapshot || {}),
          ...(survivorData as unknown as Record<string, unknown>),
          ...cleanSurvivorCoreForSnapshot,
        };

        const {stateKey: targetStateKey, payload: statePayload} =
          buildReadingStateUpsertPayload({
            userId,
            bookId: survivorBookId,
            libraryId,
            isbn:
              typeof mergedSurvivorSnapshotSource.isbn === 'string'
                ? mergedSurvivorSnapshotSource.isbn
                : undefined,
            cleanIsbn:
              typeof mergedSurvivorSnapshotSource.cleanIsbn === 'string'
                ? mergedSurvivorSnapshotSource.cleanIsbn
                : undefined,
            status: primaryState.status,
            rating: ratedState.rating,
            reviewText: ratedState.reviewText,
            reviewedAt: ratedState.reviewedAt,
            readStatusReviewedAt: primaryState.readStatusReviewedAt,
            bookData:
              typeof mergedSurvivorSnapshotSource.title === 'string'
                ? mergedSurvivorSnapshotSource
                : undefined,
          });

        batch.set(readingStatesCol.doc(targetStateKey), statePayload, {
          merge: true,
        });
        batchOps++;

        for (const {key} of foundStates) {
          if (key !== targetStateKey) {
            batch.delete(readingStatesCol.doc(key));
            batchOps++;
          }
        }
      }
    }
  }

  const dupReviewSnaps = await Promise.all(
    cleanDupIds.map(dupId => booksCol.doc(dupId).collection('reviews').get()),
  );

  let deletedCount = 0;
  try {
    for (let i = 0; i < cleanDupIds.length; i++) {
      const dupId = cleanDupIds[i];
      const dupBookRef = booksCol.doc(dupId);
      const dupDetailRef = detailsCol.doc(dupId);

      const reviewsSnap = dupReviewSnaps[i];
      if (reviewsSnap) {
        const reviewDocs: Array<{
          id: string;
          data: () => Record<string, unknown> | undefined;
          ref: FirebaseFirestore.DocumentReference;
        }> = [];
        reviewsSnap.forEach(reviewDoc => {
          reviewDocs.push(reviewDoc);
        });
        for (const reviewDoc of reviewDocs) {
          const targetReviewRef = survivorBookRef
            .collection('reviews')
            .doc(reviewDoc.id);
          const validatedReview = reviewDocConverter.fromFirestore(
            reviewDoc.id,
            reviewDoc.data() || {},
          );
          validateFirestoreWritePayload(
            storedReviewDocSchema,
            validatedReview,
            {
              entity: 'StoredReviewDoc',
              documentPath: `/libraries/${libraryId}/books/${survivorBookId}/reviews/${reviewDoc.id}`,
              operation: 'upsert',
            },
          );
          batch.set(targetReviewRef, validatedReview, {merge: true});
          batch.delete(reviewDoc.ref);
          batchOps += 2;
          await commitBatchIfNeeded();
        }
      }

      batch.delete(dupBookRef);
      batch.delete(dupDetailRef);
      stageBookTombstoneInBatch(batch, libraryRef, libraryId, dupId, {
        deletedBy: userId || undefined,
      });
      batchOps += 3;
      deletedCount++;
      await commitBatchIfNeeded();
    }

    const libMergeUpdate = {
      bookCount: FieldValue.increment(-deletedCount),
      updatedAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(
      storedLibraryDocSchema.partial(),
      libMergeUpdate,
      {
        entity: 'StoredLibraryDoc',
        documentPath: `/libraries/${libraryId}`,
        operation: 'update',
      },
    );
    batch.update(libraryRef, libMergeUpdate);
    batchOps++;

    await commitBatchIfNeeded(true);
    if (deletedCount > 0) {
      LibraryMetadataCache.adjustBookCount(libraryId, -deletedCount);
      LibraryMetadataCache.recordDeletedBooks(libraryId, cleanDupIds);
    } else {
      LibraryMetadataCache.invalidate(libraryId);
    }
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
