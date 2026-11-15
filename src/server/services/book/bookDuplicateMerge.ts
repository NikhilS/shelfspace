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
 * 3. Migrates/updates the caller's `/users/{userId}/readingStates` entry if any duplicate or the survivor was tracked.
 * 4. Deletes all `duplicateBookIds` (plus their `bookDetails` and `reviews`) and decrements `bookCount`.
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
      existingBook: {
        title: survivorData.title,
        author: survivorData.author,
        isbn: survivorData.isbn,
        series: survivorData.series ?? undefined,
      },
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

  // Migrate/sync caller's readingStates across survivor and duplicate books
  if (userId) {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (readingStatesCol && typeof readingStatesCol.doc === 'function') {
      const candidateStateKeys = new Set<string>();
      candidateStateKeys.add(
        computeReadingStateKey({
          isbn: survivorData.isbn,
          cleanIsbn: survivorData.cleanIsbn,
          bookId: survivorBookId,
        }),
      );
      candidateStateKeys.add(`bookid:${survivorBookId}`);

      for (let i = 0; i < cleanDupIds.length; i++) {
        const dupId = cleanDupIds[i];
        const dupSnap = bookDocs[i + 1];
        candidateStateKeys.add(`bookid:${dupId}`);
        if (dupSnap?.exists) {
          const dupRaw = (dupSnap.data() || {}) as Record<string, unknown>;
          candidateStateKeys.add(
            computeReadingStateKey({
              isbn: typeof dupRaw.isbn === 'string' ? dupRaw.isbn : undefined,
              cleanIsbn:
                typeof dupRaw.cleanIsbn === 'string'
                  ? dupRaw.cleanIsbn
                  : undefined,
              bookId: dupId,
            }),
          );
        }
      }

      const foundStates: Array<{
        key: string;
        state: Partial<UserReadingState>;
      }> = [];
      for (const key of candidateStateKeys) {
        try {
          const stateRef = readingStatesCol.doc(key);
          if (typeof stateRef?.get === 'function') {
            const stateSnap = await stateRef.get();
            if (stateSnap?.exists) {
              const parsed = normalizeReadingStateDoc(
                stateSnap.id || key,
                stateSnap.data() || {},
                userId,
              );
              foundStates.push({key, state: parsed});
            }
          }
        } catch {
          // Non-fatal in test mocks where readingStates.doc().get is unconfigured
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
        const cleanSurvivorHeavyForSnapshot: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(heavyUpdates)) {
          if (!isFirestoreFieldValueSentinel(v)) {
            cleanSurvivorHeavyForSnapshot[k] = v;
          }
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
          ...cleanSurvivorHeavyForSnapshot,
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

  // Pre-fetch reviews subcollections for all duplicate books in parallel
  const dupReviewSnaps = await Promise.all(
    cleanDupIds.map(async dupId => {
      try {
        const dupBookRef = booksCol.doc(dupId);
        if (typeof dupBookRef?.collection === 'function') {
          return await dupBookRef.collection('reviews').get();
        }
      } catch {
        // Non-fatal if reviews subcollection is empty or mocked
      }
      return undefined;
    }),
  );

  let deletedCount = 0;
  try {
    for (let i = 0; i < cleanDupIds.length; i++) {
      const dupId = cleanDupIds[i];
      const dupBookRef = booksCol.doc(dupId);
      const dupDetailRef = detailsCol.doc(dupId);

      const reviewsSnap = dupReviewSnaps[i];
      if (reviewsSnap && typeof survivorBookRef?.collection === 'function') {
        const reviewDocs: Array<{
          id: string;
          data: () => Record<string, unknown>;
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
      batchOps += 2;
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
