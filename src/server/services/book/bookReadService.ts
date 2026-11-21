import * as firestoreAdmin from 'firebase-admin/firestore';
import {getAdminDb} from '../firebaseAdmin';
import {TRPCError} from '@trpc/server';
import {LibraryService, LibraryMetadataCache} from '../library';
import type {
  Book,
  BookDetailsPayload,
  ReadingStatusValue,
  StoredBookDetailsDoc,
} from '../../../types';
import {
  BookPartitioner,
  bookDocConverter,
  bookDetailsDocConverter,
  computePrimaryGenreLower,
} from './bookPartitioner';
import {extractRescuedLegacyBookDetails} from './bookLegacyNormalizers';
import {
  computeReadingStateKey,
  fetchUserReadingStateForBook,
  fetchUserReadingStatesProjection,
  getReadingStatesCollection,
  normalizeReadingStateDoc,
  overlayReadingStateOnBook,
  parseBookOrStateIdentifier,
  resolveReadingStateFromMap,
} from './readingStateLedger';
import {queryDeletedBookIdsSince} from './bookTombstoneLedger';
import {validateFirestoreWritePayload} from '../../../schemas/common';
import {storedLibraryDocSchema} from '../../../schemas/libraryApi';

/**
 * Retrieves a single book by ID, merging partitioned heavy metadata
 * and overlaying the caller's personal reading state from `/users/{userId}/readingStates/{stateKey}`.
 */
export async function getBook(
  userId: string,
  libraryId: string,
  bookIdRaw: string,
  options?: {cleanIsbn?: string},
): Promise<Book> {
  const db = getAdminDb();
  const {cleanBookId, isbnFromId} = parseBookOrStateIdentifier(bookIdRaw);
  const libraryRef = db.collection('libraries').doc(libraryId);
  const booksCol = libraryRef.collection('books');
  const detailsCol = libraryRef.collection('bookDetails');

  let bookSnap: FirebaseFirestore.DocumentSnapshot | undefined;
  let detailSnap: FirebaseFirestore.DocumentSnapshot | undefined;
  let prefetchedStateSnap: FirebaseFirestore.DocumentSnapshot | undefined;
  let predictedStateKey: string | undefined;

  const isExtPrefixed = bookIdRaw.startsWith('ext:');

  if (!isExtPrefixed) {
    const bookRef = booksCol.doc(cleanBookId);
    const detailRef = detailsCol.doc(cleanBookId);
    const readingStatesCol = userId
      ? getReadingStatesCollection(db, userId)
      : undefined;

    if (readingStatesCol) {
      predictedStateKey = computeReadingStateKey({
        libraryId,
        cleanIsbn: options?.cleanIsbn,
        bookId: cleanBookId,
      });
      const predictedStateRef = readingStatesCol.doc(predictedStateKey);
      const [bSnap, dSnap, sSnap] = await db.getAll(
        bookRef,
        detailRef,
        predictedStateRef,
      );
      bookSnap = bSnap;
      detailSnap = dSnap;
      prefetchedStateSnap = sSnap;
    } else {
      const [bSnap, dSnap] = await db.getAll(bookRef, detailRef);
      bookSnap = bSnap;
      detailSnap = dSnap;
    }
  }

  if ((!bookSnap || !bookSnap.exists) && isbnFromId) {
    const isbnQuerySnap = await booksCol
      .where('cleanIsbn', '==', isbnFromId)
      .limit(1)
      .get();
    const matchedDoc = isbnQuerySnap.docs[0];
    if (matchedDoc?.exists) {
      bookSnap = matchedDoc;
      detailSnap = await detailsCol.doc(matchedDoc.id).get();
    }
  }

  if (!bookSnap || !bookSnap.exists) {
    if (userId) {
      const readingStatesCol = getReadingStatesCollection(db, userId);
      if (readingStatesCol) {
        const candidateKeys: string[] = [];
        if (!isExtPrefixed) {
          candidateKeys.push(
            computeReadingStateKey({
              libraryId,
              cleanIsbn: isbnFromId,
              bookId: cleanBookId,
            }),
          );
        }
        if (isbnFromId) {
          const extKey = `ext:${isbnFromId}`;
          if (!candidateKeys.includes(extKey)) {
            candidateKeys.push(extKey);
          }
        }

        for (const candidateKey of candidateKeys) {
          const stateSnap =
            predictedStateKey === candidateKey && prefetchedStateSnap
              ? prefetchedStateSnap
              : await readingStatesCol.doc(candidateKey).get();
          if (stateSnap.exists) {
            const state = normalizeReadingStateDoc(
              stateSnap.id || candidateKey,
              stateSnap.data() || {},
              userId,
            );
            const snap = state.bookSnapshot;
            if (snap) {
              const fallbackBook: Book = {
                id: state.bookId || snap.bookId || cleanBookId,
                title: snap.title || 'Untitled Book',
                author: snap.author || 'Unknown Author',
                ...(snap.isbn || state.cleanIsbn
                  ? {isbn: snap.isbn || state.cleanIsbn}
                  : {}),
                ...(snap.cleanIsbn || state.cleanIsbn
                  ? {cleanIsbn: snap.cleanIsbn || state.cleanIsbn}
                  : {}),
                ...(snap.coverUrl ? {coverUrl: snap.coverUrl} : {}),
                ...(snap.publishedDate
                  ? {publishedDate: snap.publishedDate}
                  : {}),
                ...(snap.primaryGenre ? {primaryGenre: snap.primaryGenre} : {}),
                subgenres: [],
                isCustomPrimary: false,
                ...(snap.series ? {series: snap.series} : {}),
                format: snap.format || 'physical',
                ...(snap.ownershipStatus
                  ? {ownershipStatus: snap.ownershipStatus}
                  : {}),
                addedBy: userId,
                addedAt: state.updatedAt || new Date().toISOString(),
                ...(state.updatedAt ? {updatedAt: state.updatedAt} : {}),
              };
              return overlayReadingStateOnBook(fallbackBook, state);
            }
          }
        }
      }
    }

    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Book '${bookIdRaw}' not found in library '${libraryId}'`,
    });
  }

  const rawBookData = (bookSnap.data() || {}) as Record<string, unknown>;
  const bookData = bookDocConverter.fromFirestore(
    bookSnap.id,
    rawBookData,
    `/libraries/${libraryId}/books/${bookSnap.id}`,
  );
  const rescuedHeavy = extractRescuedLegacyBookDetails(rawBookData);
  const persistedHeavy: StoredBookDetailsDoc =
    detailSnap && detailSnap.exists
      ? bookDetailsDocConverter.fromFirestore(
          bookSnap.id,
          detailSnap.data() || {},
          `/libraries/${libraryId}/bookDetails/${bookSnap.id}`,
        )
      : {};
  const heavyData: StoredBookDetailsDoc = {
    ...rescuedHeavy,
    ...persistedHeavy,
  };

  const merged = BookPartitioner.mergeBookAndDetails(
    bookSnap.id,
    bookData,
    heavyData,
  );
  const actualStateKey = computeReadingStateKey({
    libraryId,
    isbn: merged.isbn,
    cleanIsbn: merged.cleanIsbn,
    bookId: merged.id,
  });
  if (
    predictedStateKey === actualStateKey &&
    prefetchedStateSnap !== undefined &&
    prefetchedStateSnap.exists
  ) {
    const prefetchedState = normalizeReadingStateDoc(
      prefetchedStateSnap.id || actualStateKey,
      prefetchedStateSnap.data() || {},
      userId,
    );
    return overlayReadingStateOnBook(merged, prefetchedState);
  }
  const state = await fetchUserReadingStateForBook(db, userId, {
    id: merged.id,
    libraryId,
    isbn: merged.isbn,
    cleanIsbn: merged.cleanIsbn,
  });
  return overlayReadingStateOnBook(merged, state);
}

export interface ReadingStateSyncOverlay {
  bookId?: string;
  libraryId?: string;
  cleanIsbn?: string;
  status?: ReadingStatusValue;
  rating?: number;
  readStatusReviewedAt?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface SyncBookChangesOptions {
  sinceUpdatedAtMs: number;
  knownCount?: number;
  prefetchedLibraryData?: Record<string, unknown>;
}

export interface SyncBookChangesResult {
  upsertedBooks: Book[];
  deletedBookIds: string[];
  activeBookIds?: string[];
  readingStates: Record<string, ReadingStateSyncOverlay>;
  syncCursorMs: number;
  totalCount?: number;
}

/**
 * Incrementally synchronizes warm client library caches by fetching only book documents
 * modified after `sinceUpdatedAtMs`, overlaying the caller's personal reading states,
 * and reconciling hard-deleted book IDs via durable Firestore tombstones across all replicas.
 */
export async function syncChanges(
  userId: string,
  libraryId: string,
  options: SyncBookChangesOptions,
): Promise<SyncBookChangesResult> {
  const db = getAdminDb();
  const syncCursorMs = Date.now();
  const rawSinceMs = Number.isFinite(options.sinceUpdatedAtMs)
    ? Math.floor(options.sinceUpdatedAtMs)
    : 0;
  const effectiveSinceMs = Math.max(0, rawSinceMs - 2000);
  const libraryRef = db.collection('libraries').doc(libraryId);
  const booksCol = libraryRef.collection('books');

  const timestampCtor = (
    firestoreAdmin as {Timestamp?: {fromMillis?: (ms: number) => unknown}}
  ).Timestamp;
  const cutoffValue =
    typeof timestampCtor?.fromMillis === 'function'
      ? timestampCtor.fromMillis(effectiveSinceMs)
      : new Date(effectiveSinceMs).toISOString();

  const [changedSnap, readingStatesMap, firestoreTombstoneIds] =
    await Promise.all([
      booksCol.where('updatedAt', '>', cutoffValue).limit(500).get(),
      fetchUserReadingStatesProjection(db, userId),
      queryDeletedBookIdsSince(libraryRef, libraryId, effectiveSinceMs),
    ]);

  const changedDocs = changedSnap.docs;

  const upsertedBooks: Book[] = changedDocs.map(doc => {
    const raw = (doc.data() || {}) as Record<string, unknown>;
    const data = bookDocConverter.fromFirestore(
      doc.id,
      raw,
      `/libraries/${libraryId}/books/${doc.id}`,
    );
    const merged = BookPartitioner.mergeBookAndDetails(doc.id, data);
    const state = resolveReadingStateFromMap(readingStatesMap, {
      libraryId,
      bookId: merged.id,
      isbn: merged.isbn,
      cleanIsbn: merged.cleanIsbn,
    });
    return overlayReadingStateOnBook(merged, state);
  });

  const readingStates: Record<string, ReadingStateSyncOverlay> = {};
  for (const [stateKey, state] of readingStatesMap.entries()) {
    readingStates[stateKey] = {
      ...(state.bookId ? {bookId: state.bookId} : {}),
      ...(state.libraryId ? {libraryId: state.libraryId} : {}),
      ...(state.cleanIsbn ? {cleanIsbn: state.cleanIsbn} : {}),
      ...(state.status ? {status: state.status} : {}),
      ...(typeof state.rating === 'number' ? {rating: state.rating} : {}),
      ...(state.readStatusReviewedAt !== undefined
        ? {readStatusReviewedAt: state.readStatusReviewedAt}
        : {}),
      ...(state.startedAt !== undefined ? {startedAt: state.startedAt} : {}),
      ...(state.finishedAt !== undefined ? {finishedAt: state.finishedAt} : {}),
    };
  }

  const l1Tombstones = LibraryMetadataCache.getDeletedBookIdsSince(
    libraryId,
    effectiveSinceMs,
  );
  const deletedBookIds = Array.from(
    new Set([...firestoreTombstoneIds, ...l1Tombstones]),
  );

  const prefetchedCount =
    typeof options.prefetchedLibraryData?.bookCount === 'number'
      ? options.prefetchedLibraryData.bookCount
      : undefined;

  let activeBookIds: string[] | undefined;
  if (
    typeof options.knownCount === 'number' &&
    typeof prefetchedCount === 'number' &&
    options.knownCount + upsertedBooks.length - deletedBookIds.length !==
      prefetchedCount
  ) {
    const idSnap = await booksCol.select().get();
    activeBookIds = idSnap.docs.map(d => d.id);
  }

  return {
    upsertedBooks,
    deletedBookIds,
    ...(activeBookIds ? {activeBookIds} : {}),
    readingStates,
    syncCursorMs,
    ...(typeof prefetchedCount === 'number'
      ? {totalCount: activeBookIds ? activeBookIds.length : prefetchedCount}
      : {}),
  };
}

/**
 * Lists books in a library, applying optional filters and cursor pagination.
 */
export interface ListBooksOptions {
  filters?: {
    missingMetadata?: string;
    primaryGenre?: string;
    status?: string;
  };
  limit?: number;
  cursor?: string;
  prefetchedLibraryData?: Record<string, unknown>;
}

function matchesMissingMetadataPredicate(book: Book, missing: string): boolean {
  if (missing === 'geo') {
    return !book.geoMetadata;
  }
  if (missing === 'temporal') {
    return !book.temporalMetadata;
  }
  if (missing === 'genre') {
    return !book.primaryGenre;
  }
  if (missing === 'synopsis') {
    return !book.synopsis && !book.bookDetailsMetadata?.hasSynopsis;
  }
  if (missing === 'authorBio') {
    return !book.authorBio && !book.bookDetailsMetadata?.hasAuthorBio;
  }
  if (missing === 'embedding') {
    return !book.embedding?.length && !book.bookDetailsMetadata?.hasEmbedding;
  }
  if (missing === 'coverImage') {
    return !book.coverUrl;
  }
  if (missing === 'series') {
    return !book.series;
  }
  return true;
}

/**
 * Lists books in a library, applying native indexed filters (`primaryGenreLower`, `missingFlags`),
 * lookahead cursor pagination, and self-healing parent library bookCount reconciliation.
 */
export async function listBooks(
  userId: string,
  libraryId: string,
  options?: ListBooksOptions,
): Promise<{books: Book[]; nextCursor?: string; totalCount?: number}> {
  const db = getAdminDb();
  const booksCollection = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books');
  let query: FirebaseFirestore.Query = booksCollection;

  const targetGenreLower = computePrimaryGenreLower(
    options?.filters?.primaryGenre,
  );
  const canonicalMissingFlag = options?.filters?.missingMetadata;
  const hasStatusFilter = Boolean(options?.filters?.status);
  const hasAnyFilter = Boolean(
    canonicalMissingFlag || targetGenreLower || hasStatusFilter,
  );

  let appliedNativeGenreFilter = false;
  let appliedNativeMissingFilter = false;

  if (targetGenreLower) {
    query = query.where('primaryGenreLower', '==', targetGenreLower);
    appliedNativeGenreFilter = true;
  }
  if (canonicalMissingFlag) {
    query = query.where('missingFlags', 'array-contains', canonicalMissingFlag);
    appliedNativeMissingFilter = true;
  }

  const appliedAnyNativeWhere =
    appliedNativeGenreFilter || appliedNativeMissingFilter;

  if (!appliedAnyNativeWhere) {
    query = query.orderBy('addedAt', 'desc');
  }

  if (options?.cursor && !appliedAnyNativeWhere) {
    const cursorSnap = await booksCollection.doc(options.cursor).get();
    if (cursorSnap.exists) {
      query = query.startAfter(cursorSnap);
    }
  }

  const limitCount = options?.limit ?? 1000;
  const fetchLimit = hasStatusFilter
    ? Math.min(2000, limitCount * 3)
    : limitCount + 1;
  if (!appliedAnyNativeWhere) {
    query = query.limit(fetchLimit);
  }

  const countAggregatePromise =
    !hasAnyFilter && !options?.cursor
      ? booksCollection
          .count()
          .get()
          .then(res => res.data().count)
      : Promise.resolve(undefined);

  const [snapshot, aggregatedCount, readingStatesMap] = await Promise.all([
    query.get(),
    countAggregatePromise,
    fetchUserReadingStatesProjection(db, userId),
  ]);

  let rawDocs = snapshot.docs;

  if (
    !hasAnyFilter &&
    !options?.cursor &&
    rawDocs.length < fetchLimit &&
    typeof aggregatedCount === 'number' &&
    aggregatedCount > rawDocs.length &&
    aggregatedCount <= limitCount
  ) {
    const fallbackSnap = await booksCollection.get();
    if (fallbackSnap.docs.length > rawDocs.length) {
      rawDocs = fallbackSnap.docs;
    }
  }

  let books: Book[] = rawDocs.map(doc => {
    const raw = (doc.data() || {}) as Record<string, unknown>;
    const data = bookDocConverter.fromFirestore(
      doc.id,
      raw,
      `/libraries/${libraryId}/books/${doc.id}`,
    );
    const merged = BookPartitioner.mergeBookAndDetails(doc.id, data);
    const state = resolveReadingStateFromMap(readingStatesMap, {
      libraryId,
      bookId: merged.id,
      isbn: merged.isbn,
      cleanIsbn: merged.cleanIsbn,
    });
    return overlayReadingStateOnBook(merged, state);
  });

  if (appliedAnyNativeWhere) {
    books.sort((a, b) =>
      String(b.addedAt || '').localeCompare(String(a.addedAt || '')),
    );
    if (options?.cursor) {
      const cursorIdx = books.findIndex(b => b.id === options.cursor);
      if (cursorIdx >= 0) {
        books = books.slice(cursorIdx + 1);
      }
    }
  }

  if (targetGenreLower) {
    books = books.filter(
      b => (b.primaryGenre || '').trim().toLowerCase() === targetGenreLower,
    );
  }

  if (options?.filters?.status) {
    const targetStatus = options.filters.status;
    books = books.filter(b => b.readingStatus === targetStatus);
  }

  if (canonicalMissingFlag) {
    books = books.filter(b =>
      matchesMissingMetadataPredicate(b, canonicalMissingFlag),
    );
  }

  const hasMore = books.length > limitCount;
  const slicedBooks = books.slice(0, limitCount);
  const nextCursor = hasMore
    ? slicedBooks[slicedBooks.length - 1]?.id || rawDocs[rawDocs.length - 1]?.id
    : undefined;

  const authoritativeTotalCount =
    !hasAnyFilter && !options?.cursor
      ? typeof aggregatedCount === 'number'
        ? aggregatedCount
        : !hasMore
          ? slicedBooks.length
          : undefined
      : undefined;

  if (
    typeof authoritativeTotalCount === 'number' &&
    options?.prefetchedLibraryData &&
    !libraryId.startsWith('virtual_') &&
    options.prefetchedLibraryData.bookCount !== authoritativeTotalCount
  ) {
    const libRef = db.collection('libraries').doc(libraryId);
    const healPayload = {bookCount: authoritativeTotalCount};
    validateFirestoreWritePayload(
      storedLibraryDocSchema.partial(),
      healPayload,
      {
        entity: 'StoredLibraryDoc',
        documentPath: `/libraries/${libraryId}`,
        operation: 'update',
      },
    );
    void libRef.update(healPayload).catch(() => {});
  }

  return {
    books: slicedBooks,
    nextCursor,
    ...(typeof authoritativeTotalCount === 'number'
      ? {totalCount: authoritativeTotalCount}
      : {}),
  };
}

/**
 * Batches book details retrieval for constellation and graph views using db.getAll().
 */
export async function getBookDetailsChunk(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  bookIds: string[],
  options?: {skipAccessCheck?: boolean},
): Promise<{details: Record<string, BookDetailsPayload>}> {
  if (!options?.skipAccessCheck) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      libraryId,
      'viewer',
    );
  }

  if (bookIds.length === 0) {
    return {details: {}};
  }

  const db = getAdminDb();
  const detailsCollection = db
    .collection('libraries')
    .doc(libraryId)
    .collection('bookDetails');

  const docRefs = bookIds.map(id => detailsCollection.doc(id));
  const snaps = await db.getAll(...docRefs);

  const details: Record<string, BookDetailsPayload> = {};
  snaps.forEach(snap => {
    if (snap.exists) {
      details[snap.id] = bookDetailsDocConverter.fromFirestore(
        snap.id,
        snap.data() || {},
        `/libraries/${libraryId}/bookDetails/${snap.id}`,
      );
    }
  });

  return {details};
}
