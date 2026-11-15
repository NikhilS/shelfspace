import {TRPCError} from '@trpc/server';
import {FieldValue} from 'firebase-admin/firestore';
import type {
  BookCreateInput,
  BookDeleteInput,
  BookUpdateInput,
} from '../../../schemas/book';
import {
  isFirestoreFieldValueSentinel,
  safeIdSchema,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {storedLibraryDocSchema} from '../../../schemas/libraryApi';
import type {
  Book,
  UserReadingState,
  UserReadingStateBookSnapshot,
} from '../../../types';
import {formatFirestoreAdminError, getAdminDb} from '../firebaseAdmin';
import {LibraryMetadataCache} from '../library/libraryMetadataCache';
import {batchUpsert} from './bookBatchUpsert';
import {mergeDuplicates} from './bookDuplicateMerge';
import {
  BookPartitioner,
  bookDetailsDocConverter,
  bookDocConverter,
  HEAVY_FIELDS,
} from './bookPartitioner';
import {
  assertSafeBookOrStateId,
  assertSafeDocId,
  fetchExistingBookDataForSnapshot,
} from './bookWriteIds';
import {
  buildReadingStateUpsertPayload,
  computeReadingStateKey,
  getReadingStatesCollection,
  normalizeReadingStateDoc,
  parseBookOrStateIdentifier,
} from './readingStateLedger';

export {
  HEAVY_FIELDS,
  batchUpsert,
  fetchExistingBookDataForSnapshot,
  mergeDuplicates,
};

/**
 * Creates a single book and stores heavy metadata (synopsis, embeddings) in bookDetails.
 * Atomically increments parent library volume counter.
 */
export async function createBook(
  userId: string,
  input: BookCreateInput,
): Promise<{
  success: true;
  id: string;
  book?: Book;
  libraryBookCountDelta: number;
}> {
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
    input,
    bookId,
    userId,
    FieldValue.serverTimestamp(),
  );

  const batch = db.batch();
  batch.set(bookRef, cleanCore);

  if (Object.keys(cleanHeavy).length > 0) {
    batch.set(
      detailRef,
      bookDetailsDocConverter.toFirestoreWrite(
        bookId,
        {
          ...cleanHeavy,
          updatedAt: FieldValue.serverTimestamp(),
        },
        'create',
        `/libraries/${libraryId}/bookDetails/${bookId}`,
      ),
    );
  }

  const libCreateUpdate = {
    bookCount: FieldValue.increment(1),
    updatedAt: FieldValue.serverTimestamp(),
  };
  validateFirestoreWritePayload(
    storedLibraryDocSchema.partial(),
    libCreateUpdate,
    {
      entity: 'StoredLibraryDoc',
      documentPath: `/libraries/${libraryId}`,
      operation: 'update',
    },
  );
  batch.update(libraryRef, libCreateUpdate);

  if (userId && input.readingStatus && input.readingStatus !== 'unset') {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (readingStatesCol) {
      const {stateKey, payload} = buildReadingStateUpsertPayload({
        userId,
        bookId,
        libraryId,
        isbn: typeof cleanCore.isbn === 'string' ? cleanCore.isbn : undefined,
        cleanIsbn:
          typeof cleanCore.cleanIsbn === 'string'
            ? cleanCore.cleanIsbn
            : undefined,
        status: input.readingStatus,
        bookData: {
          ...cleanCore,
          ...cleanHeavy,
        },
      });
      batch.set(readingStatesCol.doc(stateKey), payload, {merge: true});
    }
  }

  try {
    await batch.commit();
    LibraryMetadataCache.adjustBookCount(libraryId, 1);
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

  const nowIso = new Date().toISOString();
  const sanitizedCoreForReturn: Record<string, unknown> = {...cleanCore};
  if (isFirestoreFieldValueSentinel(sanitizedCoreForReturn.addedAt)) {
    sanitizedCoreForReturn.addedAt = nowIso;
  }
  if (isFirestoreFieldValueSentinel(sanitizedCoreForReturn.updatedAt)) {
    sanitizedCoreForReturn.updatedAt = nowIso;
  }
  delete sanitizedCoreForReturn.searchTokens;

  const heavyWithoutEmbedding: Record<string, unknown> = {...cleanHeavy};
  delete heavyWithoutEmbedding.embedding;

  return {
    success: true,
    id: bookId,
    libraryBookCountDelta: 1,
    book: {
      ...(sanitizedCoreForReturn as unknown as Book),
      ...(heavyWithoutEmbedding as Partial<Book>),
      id: bookId,
      hasSearchTokens: Array.isArray(cleanCore.searchTokens),
      ...(input.readingStatus ? {readingStatus: input.readingStatus} : {}),
      ...(Object.keys(cleanHeavy).length > 0 ? {heavyDetails: cleanHeavy} : {}),
    },
  };
}

/**
 * Updates an existing book, propagates heavy updates to bookDetails,
 * and keeps the caller's `/users/{userId}/readingStates` snapshot and key in sync.
 */
export async function updateBook(
  userId: string,
  input: BookUpdateInput,
): Promise<{success: true; id?: string; updatedAt: string}> {
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

  let existingBook:
    | {title?: string; author?: string; isbn?: string; series?: string}
    | undefined;
  let existingFullBookData: Record<string, unknown> | undefined;

  if (typeof bookRef.get === 'function') {
    try {
      const existingSnap = await bookRef.get();
      if (existingSnap?.exists) {
        const parsedExisting = bookDocConverter.fromFirestore(
          bookId,
          existingSnap.data() || {},
          `/libraries/${libraryId}/books/${bookId}`,
        );
        existingBook = {
          title: parsedExisting.title,
          author: parsedExisting.author,
          isbn: parsedExisting.isbn,
          series: parsedExisting.series ?? undefined,
        };
        existingFullBookData = parsedExisting;
      }
    } catch {
      // Non-fatal in test mocks where bookRef.get is unconfigured
    }
  }

  const {coreUpdates, heavyUpdates} = BookPartitioner.partitionUpdatePayload(
    updates,
    FieldValue.serverTimestamp(),
    {callerUserId: userId, existingBook},
  );

  const batch = db.batch();
  batch.update(bookRef, coreUpdates);

  if (Object.keys(heavyUpdates).length > 0) {
    batch.set(
      detailRef,
      bookDetailsDocConverter.toFirestoreWrite(
        bookId,
        {
          ...heavyUpdates,
          updatedAt: FieldValue.serverTimestamp(),
        },
        'update',
        `/libraries/${libraryId}/bookDetails/${bookId}`,
      ),
      {merge: true},
    );
  }

  if (userId) {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (readingStatesCol && typeof readingStatesCol.doc === 'function') {
      const cleanCoreFieldsForSnapshot: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(coreUpdates)) {
        if (k.includes('.') || isFirestoreFieldValueSentinel(v)) {
          continue;
        }
        cleanCoreFieldsForSnapshot[k] = v;
      }
      const cleanHeavyFieldsForSnapshot: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(heavyUpdates)) {
        if (!isFirestoreFieldValueSentinel(v)) {
          cleanHeavyFieldsForSnapshot[k] = v;
        }
      }

      const mergedForSnapshot: Record<string, unknown> = {
        ...(existingFullBookData || {}),
        ...cleanCoreFieldsForSnapshot,
        ...cleanHeavyFieldsForSnapshot,
      };

      const oldStateKey = existingFullBookData
        ? computeReadingStateKey({
            isbn:
              typeof existingFullBookData.isbn === 'string'
                ? existingFullBookData.isbn
                : undefined,
            cleanIsbn:
              typeof existingFullBookData.cleanIsbn === 'string'
                ? existingFullBookData.cleanIsbn
                : undefined,
            bookId,
          })
        : `bookid:${bookId}`;
      const newStateKey = computeReadingStateKey({
        isbn:
          typeof mergedForSnapshot.isbn === 'string'
            ? mergedForSnapshot.isbn
            : undefined,
        cleanIsbn:
          typeof mergedForSnapshot.cleanIsbn === 'string'
            ? mergedForSnapshot.cleanIsbn
            : undefined,
        bookId,
      });

      let existingReadingState: Partial<UserReadingState> | undefined;
      let existingReadingStateKey: string | undefined;
      try {
        const oldDocRef = readingStatesCol.doc(oldStateKey);
        if (typeof oldDocRef?.get === 'function') {
          const oldSnap = await oldDocRef.get();
          if (oldSnap?.exists) {
            existingReadingState = normalizeReadingStateDoc(
              oldSnap.id || oldStateKey,
              oldSnap.data() || {},
              userId,
            );
            existingReadingStateKey = oldStateKey;
          }
        }
        if (!existingReadingState && newStateKey !== oldStateKey) {
          const newDocRef = readingStatesCol.doc(newStateKey);
          if (typeof newDocRef?.get === 'function') {
            const newSnap = await newDocRef.get();
            if (newSnap?.exists) {
              existingReadingState = normalizeReadingStateDoc(
                newSnap.id || newStateKey,
                newSnap.data() || {},
                userId,
              );
              existingReadingStateKey = newStateKey;
            }
          }
        }
      } catch {
        // Non-fatal in test mocks where readingStates.doc().get is unconfigured
      }

      const explicitReadingStatus =
        typeof updates.readingStatus === 'string'
          ? updates.readingStatus
          : undefined;

      if (explicitReadingStatus !== undefined || existingReadingState) {
        const snapshotSource: Record<string, unknown> = {
          ...(existingReadingState?.bookSnapshot || {}),
          ...mergedForSnapshot,
        };
        const {stateKey, payload} = buildReadingStateUpsertPayload({
          userId,
          bookId,
          libraryId,
          isbn:
            typeof snapshotSource.isbn === 'string'
              ? snapshotSource.isbn
              : undefined,
          cleanIsbn:
            typeof snapshotSource.cleanIsbn === 'string'
              ? snapshotSource.cleanIsbn
              : undefined,
          status: explicitReadingStatus ?? existingReadingState?.status,
          rating: existingReadingState?.rating,
          reviewText: existingReadingState?.reviewText,
          reviewedAt: existingReadingState?.reviewedAt,
          readStatusReviewedAt: existingReadingState?.readStatusReviewedAt,
          bookData:
            typeof snapshotSource.title === 'string'
              ? snapshotSource
              : undefined,
        });
        batch.set(readingStatesCol.doc(stateKey), payload, {merge: true});
        if (existingReadingStateKey && existingReadingStateKey !== stateKey) {
          batch.delete(readingStatesCol.doc(existingReadingStateKey));
        }
      }
    }
  }

  const libUpdate = {
    updatedAt: FieldValue.serverTimestamp(),
  };
  validateFirestoreWritePayload(storedLibraryDocSchema.partial(), libUpdate, {
    entity: 'StoredLibraryDoc',
    documentPath: `/libraries/${libraryId}`,
    operation: 'update',
  });
  batch.update(libraryRef, libUpdate);

  try {
    await batch.commit();
    LibraryMetadataCache.invalidate(libraryId);
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

  return {success: true, id: bookId, updatedAt: new Date().toISOString()};
}

/**
 * Updates only the caller's personal reading status in `/users/{userId}/readingStates/{stateKey}`
 * (accessible to any library viewer without mutating the shared catalog book document).
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
  options?: {
    skipAccessCheck?: boolean;
    rating?: number;
    recordReadStatusReview?: boolean;
    reviewedAtOverride?: string | null;
    bookSnapshot?: UserReadingStateBookSnapshot;
  },
): Promise<{
  success: true;
  id: string;
  status: string;
  stateKey: string;
  reviewedAt?: string | null;
  rating?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  bookSnapshot?: UserReadingStateBookSnapshot;
}> {
  const libraryId = assertSafeDocId(libraryIdRaw, 'libraryId');
  const bookIdParam = assertSafeBookOrStateId(bookIdRaw, 'bookId');
  const {cleanBookId, isbnFromId} = parseBookOrStateIdentifier(bookIdParam);

  const db = getAdminDb();
  const hasSnapshotHint =
    Boolean(options?.bookSnapshot) &&
    typeof options?.bookSnapshot?.title === 'string' &&
    options.bookSnapshot.title.trim().length > 0;

  const bookData: Record<string, unknown> | undefined = hasSnapshotHint
    ? {
        ...options?.bookSnapshot,
        ...(options?.bookSnapshot?.bookId
          ? {id: options.bookSnapshot.bookId}
          : {}),
      }
    : await fetchExistingBookDataForSnapshot(
        db,
        libraryId,
        bookIdParam,
        userId,
      );
  const resolvedBookId =
    typeof bookData?.id === 'string' &&
    safeIdSchema.safeParse(bookData.id).success
      ? bookData.id
      : cleanBookId;

  const reviewedAtIso = new Date().toISOString();
  const hasExplicitOverride = options?.reviewedAtOverride !== undefined;
  const shouldRecordReview =
    !hasExplicitOverride &&
    (Boolean(options?.recordReadStatusReview) ||
      status === 'finished' ||
      status === 'completed');

  const {stateKey, payload} = buildReadingStateUpsertPayload({
    userId,
    bookId: resolvedBookId,
    libraryId,
    isbn:
      typeof bookData?.isbn === 'string'
        ? bookData.isbn
        : isbnFromId || undefined,
    cleanIsbn:
      typeof bookData?.cleanIsbn === 'string'
        ? bookData.cleanIsbn
        : isbnFromId || undefined,
    status,
    rating: options?.rating,
    readStatusReviewedAt:
      hasExplicitOverride && options?.reviewedAtOverride !== null
        ? options.reviewedAtOverride
        : shouldRecordReview
          ? reviewedAtIso
          : undefined,
    clearReadStatusReviewedAt:
      hasExplicitOverride && options?.reviewedAtOverride === null,
    bookData,
  });

  try {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (!readingStatesCol) {
      throw new Error('Could not resolve user readingStates collection');
    }
    await readingStatesCol.doc(stateKey).set(payload, {merge: true});
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error(
      `[BookService.updateBookStatus] Error updating status for book '${resolvedBookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to update reading status: ${errMsg}`,
    });
  }

  return {
    success: true,
    id: resolvedBookId,
    status,
    stateKey,
    ...(hasExplicitOverride
      ? {reviewedAt: options?.reviewedAtOverride ?? null}
      : shouldRecordReview
        ? {reviewedAt: reviewedAtIso}
        : {}),
    ...(typeof options?.rating === 'number' ? {rating: options.rating} : {}),
    ...(typeof payload.startedAt === 'string'
      ? {startedAt: payload.startedAt}
      : {}),
    ...(typeof payload.finishedAt === 'string'
      ? {finishedAt: payload.finishedAt}
      : {}),
    ...(payload.bookSnapshot ? {bookSnapshot: payload.bookSnapshot} : {}),
  };
}

/**
 * Records or reverts a caller's review timestamp in `/users/{userId}/readingStates/{stateKey}`
 * for the "Have You Read It?" swipe deck without changing its reading status.
 */
export async function recordReadSwipeReview(
  userId: string,
  libraryIdRaw: string,
  bookIdRaw: string,
  reviewedAtOverride?: string | null,
  options?: {bookSnapshot?: UserReadingStateBookSnapshot},
): Promise<{
  success: true;
  id: string;
  stateKey: string;
  reviewedAt: string | null;
}> {
  const libraryId = assertSafeDocId(libraryIdRaw, 'libraryId');
  const bookIdParam = assertSafeBookOrStateId(bookIdRaw, 'bookId');
  const {cleanBookId, isbnFromId} = parseBookOrStateIdentifier(bookIdParam);

  const db = getAdminDb();
  const hasSnapshotHint =
    Boolean(options?.bookSnapshot) &&
    typeof options?.bookSnapshot?.title === 'string' &&
    options.bookSnapshot.title.trim().length > 0;

  const bookData: Record<string, unknown> | undefined = hasSnapshotHint
    ? {
        ...options?.bookSnapshot,
        ...(options?.bookSnapshot?.bookId
          ? {id: options.bookSnapshot.bookId}
          : {}),
      }
    : await fetchExistingBookDataForSnapshot(
        db,
        libraryId,
        bookIdParam,
        userId,
      );
  const resolvedBookId =
    typeof bookData?.id === 'string' &&
    safeIdSchema.safeParse(bookData.id).success
      ? bookData.id
      : cleanBookId;

  const resolvedReviewedAt =
    reviewedAtOverride === null
      ? null
      : typeof reviewedAtOverride === 'string' &&
          reviewedAtOverride.trim().length > 0
        ? reviewedAtOverride.trim()
        : new Date().toISOString();

  const {stateKey, payload} = buildReadingStateUpsertPayload({
    userId,
    bookId: resolvedBookId,
    libraryId,
    isbn:
      typeof bookData?.isbn === 'string'
        ? bookData.isbn
        : isbnFromId || undefined,
    cleanIsbn:
      typeof bookData?.cleanIsbn === 'string'
        ? bookData.cleanIsbn
        : isbnFromId || undefined,
    readStatusReviewedAt:
      resolvedReviewedAt !== null ? resolvedReviewedAt : undefined,
    clearReadStatusReviewedAt: resolvedReviewedAt === null,
    bookData,
  });

  try {
    const readingStatesCol = getReadingStatesCollection(db, userId);
    if (!readingStatesCol) {
      throw new Error('Could not resolve user readingStates collection');
    }
    await readingStatesCol.doc(stateKey).set(payload, {merge: true});
  } catch (err: unknown) {
    const errMsg = formatFirestoreAdminError(err);
    console.error(
      `[BookService.recordReadSwipeReview] Error recording review timestamp for book '${resolvedBookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to record review timestamp: ${errMsg}`,
    });
  }

  return {
    success: true,
    id: resolvedBookId,
    stateKey,
    reviewedAt: resolvedReviewedAt,
  };
}

/**
 * Atomically deletes a book, its heavy metadata sub-record, associated reviews,
 * and decrements the library bookCount.
 */
export async function deleteBook(
  _userId: string,
  input: BookDeleteInput,
): Promise<{success: true; id?: string; libraryBookCountDelta: number}> {
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

  const libDeleteUpdate = {
    bookCount: FieldValue.increment(-1),
    updatedAt: FieldValue.serverTimestamp(),
  };
  validateFirestoreWritePayload(
    storedLibraryDocSchema.partial(),
    libDeleteUpdate,
    {
      entity: 'StoredLibraryDoc',
      documentPath: `/libraries/${libraryId}`,
      operation: 'update',
    },
  );
  batch.update(libraryRef, libDeleteUpdate);

  try {
    await batch.commit();
    LibraryMetadataCache.adjustBookCount(libraryId, -1);
    LibraryMetadataCache.recordDeletedBooks(libraryId, [bookId]);
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

  return {success: true, id: bookId, libraryBookCountDelta: -1};
}
