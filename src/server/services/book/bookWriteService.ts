import {getAdminDb, formatFirestoreAdminError} from '../firebaseAdmin';
import {FieldValue} from 'firebase-admin/firestore';
import {TRPCError} from '@trpc/server';
import type {
  BookCreateInput,
  BookUpdateInput,
  BookDeleteInput,
  BookBatchUpsertInput,
} from '../../../schemas/book';
import {storedReviewDocSchema} from '../../../schemas/book';
import {storedLibraryDocSchema} from '../../../schemas/libraryApi';
import type {Book, ReadingStatusValue} from '../../../types';
import {
  BookPartitioner,
  bookDocConverter,
  bookDetailsDocConverter,
  HEAVY_FIELDS,
} from './bookPartitioner';
import {reviewDocConverter} from './bookReviewService';
import {
  buildReadingStateUpsertPayload,
  getReadingStatesCollection,
} from './readingStateLedger';
import {metadataRegistry} from '../metadata/registry';
import {
  safeIdSchema,
  validateFirestoreWritePayload,
} from '../../../schemas/common';

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
      ...(input.readingStatus ? {readingStatus: input.readingStatus} : {}),
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

  let existingBook:
    | {title?: string; author?: string; isbn?: string; series?: string}
    | undefined;
  const touchesIndexFields =
    typeof updates.title === 'string' ||
    typeof updates.author === 'string' ||
    typeof updates.series === 'string' ||
    typeof updates.isbn === 'string';
  const hasBothTitleAndAuthor =
    typeof updates.title === 'string' && typeof updates.author === 'string';

  if (
    touchesIndexFields &&
    !hasBothTitleAndAuthor &&
    typeof bookRef.get === 'function'
  ) {
    try {
      const existingSnap = await bookRef.get();
      if (existingSnap?.exists) {
        const parsedExisting = bookDocConverter.fromFirestore(
          bookId,
          (existingSnap.data() || {}) as Record<string, unknown>,
          `/libraries/${libraryId}/books/${bookId}`,
        );
        existingBook = {
          title: parsedExisting.title,
          author: parsedExisting.author,
          isbn: parsedExisting.isbn,
          series: parsedExisting.series ?? undefined,
        };
      }
    } catch {
      // Non-fatal in test mocks where bookRef.get is unconfigured
    }
  }

  const {coreUpdates, heavyUpdates} = BookPartitioner.partitionUpdatePayload(
    updates as Record<string, unknown>,
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

export async function fetchExistingBookDataForSnapshot(
  db: FirebaseFirestore.Firestore,
  libraryId: string,
  bookId: string,
): Promise<Record<string, unknown> | undefined> {
  const bookRef = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books')
    .doc(bookId);

  if (typeof bookRef?.get !== 'function') {
    return undefined;
  }

  let bookData: Record<string, unknown> | undefined;
  try {
    const snap = await bookRef.get();
    if (snap?.exists) {
      const raw = (snap.data() || {}) as Record<string, unknown>;
      try {
        bookData = bookDocConverter.fromFirestore(
          bookId,
          raw,
          `/libraries/${libraryId}/books/${bookId}`,
        ) as unknown as Record<string, unknown>;
      } catch (convErr) {
        console.warn(
          `[BookWriteService] Converter fallback while building readingState snapshot for /libraries/${libraryId}/books/${bookId}:`,
          convErr,
        );
        bookData = {...raw, id: bookId};
      }
    }
  } catch {
    // Non-fatal in test mocks where bookRef.get is unconfigured
    return undefined;
  }

  if (!bookData) {
    return undefined;
  }

  const meta = bookData.bookDetailsMetadata as
    | {
        hasSynopsis?: boolean;
        hasAuthorBio?: boolean;
        hasClusterCoordinates?: boolean;
      }
    | undefined;
  if (
    meta &&
    (meta.hasSynopsis || meta.hasAuthorBio || meta.hasClusterCoordinates)
  ) {
    try {
      const detailRef = db
        .collection('libraries')
        .doc(libraryId)
        .collection('bookDetails')
        .doc(bookId);
      if (typeof detailRef?.get === 'function') {
        const detailSnap = await detailRef.get();
        if (detailSnap?.exists) {
          const detailRaw = (detailSnap.data() || {}) as Record<
            string,
            unknown
          >;
          try {
            const parsedDetail = bookDetailsDocConverter.fromFirestore(
              bookId,
              detailRaw,
              `/libraries/${libraryId}/bookDetails/${bookId}`,
            );
            bookData = {...bookData, ...parsedDetail};
          } catch {
            bookData = {...bookData, ...detailRaw};
          }
        }
      }
    } catch {
      // Non-fatal if bookDetails cannot be fetched
    }
  }

  return bookData;
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
  },
): Promise<{
  success: true;
  id: string;
  status: string;
  stateKey: string;
  reviewedAt?: string | null;
}> {
  const libraryId = assertSafeDocId(libraryIdRaw, 'libraryId');
  const bookId = assertSafeDocId(bookIdRaw, 'bookId');

  const db = getAdminDb();
  const bookData = await fetchExistingBookDataForSnapshot(
    db,
    libraryId,
    bookId,
  );

  const reviewedAtIso = new Date().toISOString();
  const hasExplicitOverride = options?.reviewedAtOverride !== undefined;
  const shouldRecordReview =
    !hasExplicitOverride &&
    (Boolean(options?.recordReadStatusReview) ||
      status === 'finished' ||
      status === 'completed');

  const {stateKey, payload} = buildReadingStateUpsertPayload({
    userId,
    bookId,
    libraryId,
    isbn: typeof bookData?.isbn === 'string' ? bookData.isbn : undefined,
    cleanIsbn:
      typeof bookData?.cleanIsbn === 'string' ? bookData.cleanIsbn : undefined,
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
      `[BookService.updateBookStatus] Error updating status for book '${bookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to update reading status: ${errMsg}`,
    });
  }

  return {
    success: true,
    id: bookId,
    status,
    stateKey,
    ...(hasExplicitOverride
      ? {reviewedAt: options?.reviewedAtOverride ?? null}
      : shouldRecordReview
        ? {reviewedAt: reviewedAtIso}
        : {}),
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
): Promise<{
  success: true;
  id: string;
  stateKey: string;
  reviewedAt: string | null;
}> {
  const libraryId = assertSafeDocId(libraryIdRaw, 'libraryId');
  const bookId = assertSafeDocId(bookIdRaw, 'bookId');

  const db = getAdminDb();
  const bookData = await fetchExistingBookDataForSnapshot(
    db,
    libraryId,
    bookId,
  );

  const resolvedReviewedAt =
    reviewedAtOverride === null
      ? null
      : typeof reviewedAtOverride === 'string' &&
          reviewedAtOverride.trim().length > 0
        ? reviewedAtOverride.trim()
        : new Date().toISOString();

  const {stateKey, payload} = buildReadingStateUpsertPayload({
    userId,
    bookId,
    libraryId,
    isbn: typeof bookData?.isbn === 'string' ? bookData.isbn : undefined,
    cleanIsbn:
      typeof bookData?.cleanIsbn === 'string' ? bookData.cleanIsbn : undefined,
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
      `[BookService.recordReadSwipeReview] Error recording review timestamp for book '${bookId}':`,
      errMsg,
    );
    throw new TRPCError({
      code: 'INTERNAL_SERVER_ERROR',
      message: `Failed to record review timestamp: ${errMsg}`,
    });
  }

  return {success: true, id: bookId, stateKey, reviewedAt: resolvedReviewedAt};
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

  interface NormalizedOp {
    type: 'create' | 'update' | 'delete' | 'set';
    bookId: string;
    coreData?: Record<string, unknown>;
    heavyData?: Record<string, unknown>;
    readingStatus?: ReadingStatusValue;
    merge?: boolean;
  }

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
          if (timerId !== undefined) {
            clearTimeout(timerId);
          }
        }
      }

      if (!syncCompleted) {
        void enrichmentPromise
          .then(async enrichedMap => {
            const BG_BATCH_LIMIT = 400;
            let bgBatch = db.batch();
            let bgOps = 0;
            for (const [bookId, patch] of enrichedMap.entries()) {
              if (!patch || Object.keys(patch).length === 0) {
                continue;
              }
              const baseData = (opById.get(bookId)?.data || {}) as Record<
                string,
                unknown
              >;
              const {coreUpdates, heavyUpdates} =
                BookPartitioner.partitionUpdatePayload(
                  patch,
                  FieldValue.serverTimestamp(),
                  {
                    existingBook: {
                      title:
                        typeof baseData.title === 'string'
                          ? baseData.title
                          : undefined,
                      author:
                        typeof baseData.author === 'string'
                          ? baseData.author
                          : 'Unknown Author',
                      isbn:
                        typeof baseData.isbn === 'string'
                          ? baseData.isbn
                          : undefined,
                      series:
                        typeof baseData.series === 'string'
                          ? baseData.series
                          : undefined,
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

              if (bgOps >= BG_BATCH_LIMIT) {
                await bgBatch.commit();
                bgBatch = db.batch();
                bgOps = 0;
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
            Object.keys(cleanHeavy).length > 0
              ? (cleanHeavy as Record<string, unknown>)
              : (op.heavyData as Record<string, unknown> | undefined),
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
            Object.keys(heavyUpdates).length > 0
              ? heavyUpdates
              : (op.heavyData as Record<string, unknown> | undefined),
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

  // Pre-fetch reviews subcollections in parallel for all delete operations
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

  // Pre-fetch existing book documents for partial update ops that mutate readingStatus
  // so bookSnapshot and canonical isbn:<cleanIsbn> stateKey are never omitted.
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
          {
            ...cleanHeavy,
            updatedAt: FieldValue.serverTimestamp(),
          },
          {merge: true},
        );
        currentBatchOps++;
      }
    }

    if (userId && op.readingStatus && op.type !== 'delete') {
      const readingStatesCol = getReadingStatesCollection(db, userId);
      if (readingStatesCol) {
        const existingData = existingBookDataByBookId.get(op.bookId) || {};
        const baseData: Record<string, unknown> = {
          ...existingData,
          ...(op.coreData || {}),
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

  return {
    success: true,
    count: ops.length,
    added: addedCount,
    updated: updatedCount,
    deleted: deletedCount,
  };
}

/**
 * Atomically merges a duplicate book group into a single survivor book:
 * 1. Migrates any `reviews` subcollection documents from duplicate books onto the survivor.
 * 2. Updates `books/{survivorBookId}` and `bookDetails/{survivorBookId}` with the user-selected `mergedFields`.
 * 3. Deletes all `duplicateBookIds` (plus their `bookDetails` and `reviews`) and decrements `bookCount`.
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
    (survivorSnap.data() || {}) as Record<string, unknown>,
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
      {
        ...cleanHeavy,
        updatedAt: FieldValue.serverTimestamp(),
      },
      {merge: true},
    );
    batchOps++;
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

      // Migrate pre-fetched reviews from duplicate to survivor before deleting
      const reviewsSnap = dupReviewSnaps[i];
      if (reviewsSnap && typeof survivorBookRef?.collection === 'function') {
        const reviewDocs: Array<{
          id: string;
          data: () => Record<string, unknown>;
          ref: FirebaseFirestore.DocumentReference;
        }> = [];
        reviewsSnap.forEach(reviewDoc => {
          reviewDocs.push(reviewDoc as unknown as (typeof reviewDocs)[number]);
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
