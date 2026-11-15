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
} from './bookPartitioner';
import {
  computeReadingStateKey,
  fetchUserReadingStateForBook,
  fetchUserReadingStatesMap,
  getReadingStatesCollection,
  normalizeReadingStateDoc,
  overlayReadingStateOnBook,
  parseBookOrStateIdentifier,
} from './readingStateLedger';
import {validateFirestoreWritePayload} from '../../../schemas/common';
import {storedLibraryDocSchema} from '../../../schemas/libraryApi';

/**
 * Retrieves a single book by ID, optionally merging partitioned heavy metadata
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
  const booksCol = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books');
  const detailsCol = db
    .collection('libraries')
    .doc(libraryId)
    .collection('bookDetails');

  let bookSnap: FirebaseFirestore.DocumentSnapshot | undefined;
  let detailSnap: FirebaseFirestore.DocumentSnapshot | undefined;
  let prefetchedStateSnap: FirebaseFirestore.DocumentSnapshot | undefined;
  let predictedStateKey: string | undefined;

  if (!bookIdRaw.startsWith('isbn:')) {
    const bookRef = booksCol.doc(cleanBookId);
    const detailRef = detailsCol.doc(cleanBookId);
    const readingStatesCol = userId
      ? getReadingStatesCollection(db, userId)
      : undefined;

    if (typeof (db as {getAll?: unknown}).getAll === 'function') {
      if (readingStatesCol && typeof readingStatesCol.doc === 'function') {
        predictedStateKey = computeReadingStateKey({
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
    } else {
      bookSnap = await bookRef.get();
      try {
        detailSnap = await detailRef.get();
      } catch {
        detailSnap = undefined;
      }
    }
  }

  // If bookIdRaw was `isbn:<cleanIsbn>` (or not found by direct doc ID when ISBN is known),
  // resolve the matching book document by `cleanIsbn` in the target library.
  if (
    (!bookSnap || !bookSnap.exists) &&
    isbnFromId &&
    typeof (booksCol as {where?: unknown}).where === 'function'
  ) {
    try {
      const isbnQuerySnap = await booksCol
        .where('cleanIsbn', '==', isbnFromId)
        .limit(1)
        .get();
      const matchedDoc = isbnQuerySnap?.docs?.[0];
      if (matchedDoc?.exists) {
        bookSnap = matchedDoc;
        try {
          detailSnap = await detailsCol.doc(matchedDoc.id).get();
        } catch {
          detailSnap = undefined;
        }
      }
    } catch {
      // Non-fatal if query is unconfigured in mocks
    }
  }

  if (!bookSnap || !bookSnap.exists) {
    // Fallback to the caller's readingStates snapshot when navigating from the Personal Reading Room
    if (userId) {
      const readingStatesCol = getReadingStatesCollection(db, userId);
      if (readingStatesCol && typeof readingStatesCol.doc === 'function') {
        const candidateKey = computeReadingStateKey({
          cleanIsbn: isbnFromId,
          bookId: cleanBookId,
        });
        try {
          const stateSnap =
            predictedStateKey === candidateKey && prefetchedStateSnap
              ? prefetchedStateSnap
              : await readingStatesCol.doc(candidateKey).get();
          if (stateSnap?.exists) {
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
                subgenres: Array.isArray(snap.subgenres) ? snap.subgenres : [],
                isCustomPrimary: false,
                ...(snap.series ? {series: snap.series} : {}),
                format: snap.format || 'physical',
                ...(snap.ownershipStatus
                  ? {ownershipStatus: snap.ownershipStatus}
                  : {}),
                ...(snap.synopsis ? {synopsis: snap.synopsis} : {}),
                ...(snap.authorBio ? {authorBio: snap.authorBio} : {}),
                ...(snap.geoMetadata ? {geoMetadata: snap.geoMetadata} : {}),
                ...(snap.temporalMetadata
                  ? {temporalMetadata: snap.temporalMetadata}
                  : {}),
                ...(snap.clusterCoordinates
                  ? {clusterCoordinates: snap.clusterCoordinates}
                  : {}),
                addedBy: userId,
                addedAt: state.updatedAt || new Date().toISOString(),
                ...(state.updatedAt ? {updatedAt: state.updatedAt} : {}),
              };
              return overlayReadingStateOnBook(fallbackBook, state);
            }
          }
        } catch {
          // Proceed to NOT_FOUND below
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
  const heavyData: StoredBookDetailsDoc =
    detailSnap && detailSnap.exists
      ? bookDetailsDocConverter.fromFirestore(
          bookSnap.id,
          detailSnap.data() || {},
          `/libraries/${libraryId}/bookDetails/${bookSnap.id}`,
        )
      : {};

  const merged = BookPartitioner.mergeBookAndDetails(
    bookSnap.id,
    bookData,
    heavyData,
  );
  const actualStateKey = computeReadingStateKey({
    isbn: merged.isbn,
    cleanIsbn: merged.cleanIsbn,
    bookId: merged.id,
  });
  if (
    predictedStateKey === actualStateKey &&
    prefetchedStateSnap !== undefined
  ) {
    const prefetchedState = prefetchedStateSnap.exists
      ? normalizeReadingStateDoc(
          prefetchedStateSnap.id || actualStateKey,
          prefetchedStateSnap.data() || {},
          userId,
        )
      : undefined;
    return overlayReadingStateOnBook(merged, prefetchedState);
  }
  const state = await fetchUserReadingStateForBook(db, userId, merged);
  return overlayReadingStateOnBook(merged, state);
}

export interface ReadingStateSyncEntry {
  stateKey: string;
  bookId?: string;
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
  readingStates: ReadingStateSyncEntry[];
  syncCursorMs: number;
  totalCount?: number;
}

/**
 * Incrementally synchronizes warm client library caches by fetching only book documents
 * modified after `sinceUpdatedAtMs`, overlaying the caller's personal reading states,
 * and reconciling hard-deleted book IDs via L1 tombstones or zero-field ID projection.
 */
export async function syncChanges(
  userId: string,
  libraryId: string,
  options: SyncBookChangesOptions,
): Promise<SyncBookChangesResult> {
  const db = getAdminDb();
  const syncCursorMs = Date.now();
  const effectiveSinceMs = Math.max(0, options.sinceUpdatedAtMs - 2000);
  const booksCol = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books');

  const timestampCtor = (
    firestoreAdmin as {Timestamp?: {fromMillis?: (ms: number) => unknown}}
  ).Timestamp;
  const cutoffValue =
    typeof timestampCtor?.fromMillis === 'function'
      ? timestampCtor.fromMillis(effectiveSinceMs)
      : new Date(effectiveSinceMs).toISOString();

  const fetchChangedDocs = async (): Promise<
    FirebaseFirestore.QueryDocumentSnapshot[]
  > => {
    if (typeof (booksCol as {where?: unknown}).where !== 'function') {
      return [];
    }
    try {
      let deltaQuery: FirebaseFirestore.Query = booksCol.where(
        'updatedAt',
        '>',
        cutoffValue,
      );
      if (typeof (deltaQuery as {limit?: unknown}).limit === 'function') {
        deltaQuery = deltaQuery.limit(500);
      }
      const snap = await deltaQuery.get();
      return snap.docs || [];
    } catch {
      return [];
    }
  };

  const [changedDocs, readingStatesMap] = await Promise.all([
    fetchChangedDocs(),
    fetchUserReadingStatesMap(db, userId),
  ]);

  const upsertedBooks: Book[] = changedDocs.map(doc => {
    const raw = (doc.data() || {}) as Record<string, unknown>;
    const data = bookDocConverter.fromFirestore(
      doc.id,
      raw,
      `/libraries/${libraryId}/books/${doc.id}`,
    );
    const merged = BookPartitioner.mergeBookAndDetails(doc.id, data);
    const stateKey = computeReadingStateKey({
      isbn: merged.isbn,
      cleanIsbn: merged.cleanIsbn,
      bookId: merged.id,
    });
    return overlayReadingStateOnBook(merged, readingStatesMap.get(stateKey));
  });

  const readingStates: ReadingStateSyncEntry[] = [];
  for (const [stateKey, state] of readingStatesMap.entries()) {
    readingStates.push({
      stateKey,
      ...(state.bookId ? {bookId: state.bookId} : {}),
      ...(state.cleanIsbn ? {cleanIsbn: state.cleanIsbn} : {}),
      ...(state.status ? {status: state.status} : {}),
      ...(typeof state.rating === 'number' ? {rating: state.rating} : {}),
      ...(state.readStatusReviewedAt !== undefined
        ? {readStatusReviewedAt: state.readStatusReviewedAt}
        : {}),
      ...(state.startedAt !== undefined ? {startedAt: state.startedAt} : {}),
      ...(state.finishedAt !== undefined ? {finishedAt: state.finishedAt} : {}),
    });
  }

  const deletedBookIds = LibraryMetadataCache.getDeletedBookIdsSince(
    libraryId,
    effectiveSinceMs,
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
    try {
      const selectable = booksCol as unknown as {
        select?: () => {get: () => Promise<FirebaseFirestore.QuerySnapshot>};
      };
      if (typeof selectable?.select === 'function') {
        const idSnap = await selectable.select().get();
        activeBookIds = (idSnap.docs || []).map(d => d.id);
      }
    } catch {
      activeBookIds = undefined;
    }
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

/**
 * Lists books in a library, applying optional filters, lookahead cursor pagination,
 * and self-healing parent library bookCount reconciliation when out of sync.
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

  let appliedNativeWhereFilter = false;
  if (
    typeof (query as {where?: unknown}).where === 'function' &&
    options?.filters?.primaryGenre
  ) {
    query = query.where('primaryGenre', '==', options.filters.primaryGenre);
    appliedNativeWhereFilter = true;
  }

  if (!appliedNativeWhereFilter) {
    try {
      query = query.orderBy('addedAt', 'desc');
    } catch {
      // In tests or if index not configured
    }

    if (options?.cursor && typeof query.startAfter === 'function') {
      try {
        const cursorSnap = await booksCollection.doc(options.cursor).get();
        if (cursorSnap?.exists) {
          query = query.startAfter(cursorSnap);
        }
      } catch {
        // Fallback if cursor doc cannot be loaded in test mocks
      }
    }
  }

  const limitCount = options?.limit ?? 1000;
  const hasMissingFilter = Boolean(options?.filters?.missingMetadata);
  const hasStatusFilter = Boolean(options?.filters?.status);
  const hasAnyFilter = Boolean(
    hasMissingFilter || options?.filters?.primaryGenre || hasStatusFilter,
  );
  const fetchLimit =
    hasMissingFilter || hasStatusFilter
      ? Math.min(2000, limitCount * 3)
      : limitCount + 1;
  if (!appliedNativeWhereFilter) {
    query = query.limit(fetchLimit);
  }

  const countAggregatePromise =
    !hasAnyFilter &&
    !options?.cursor &&
    typeof (
      booksCollection as unknown as {
        count?: () => {get: () => Promise<{data: () => {count?: number}}>};
      }
    ).count === 'function'
      ? (
          booksCollection as unknown as {
            count: () => {get: () => Promise<{data: () => {count?: number}}>};
          }
        )
          .count()
          .get()
          .then(res => res?.data?.()?.count)
          .catch(() => undefined)
      : Promise.resolve(undefined);

  const [snapshot, aggregatedCount, readingStatesMap] = await Promise.all([
    query.get(),
    countAggregatePromise,
    fetchUserReadingStatesMap(db, userId),
  ]);

  let rawDocs = snapshot.docs || [];

  // If a native .where() filter on primaryGenre returned 0 docs, fall back for case-insensitive matching
  if (
    appliedNativeWhereFilter &&
    rawDocs.length === 0 &&
    options?.filters?.primaryGenre
  ) {
    try {
      const fallbackSnap = await booksCollection.limit(fetchLimit).get();
      if (fallbackSnap?.docs && fallbackSnap.docs.length > 0) {
        rawDocs = fallbackSnap.docs;
      }
    } catch {
      // Keep empty result if fallback fails
    }
  }

  // If an unfiltered single-page query returned fewer documents than the collection's
  // true count (e.g. legacy imported documents missing `addedAt` excluded by orderBy),
  // fall back to an unordered collection read and sort in memory so zero books are lost.
  if (
    !hasAnyFilter &&
    !options?.cursor &&
    rawDocs.length < fetchLimit &&
    typeof aggregatedCount === 'number' &&
    aggregatedCount > rawDocs.length &&
    aggregatedCount <= limitCount
  ) {
    try {
      const fallbackSnap = await booksCollection.get();
      if (fallbackSnap?.docs && fallbackSnap.docs.length > rawDocs.length) {
        rawDocs = fallbackSnap.docs;
      }
    } catch {
      // Keep ordered snapshot if fallback fails
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
    const stateKey = computeReadingStateKey({
      isbn: merged.isbn,
      cleanIsbn: merged.cleanIsbn,
      bookId: merged.id,
    });
    return overlayReadingStateOnBook(merged, readingStatesMap.get(stateKey));
  });

  if (appliedNativeWhereFilter) {
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

  if (options?.filters?.primaryGenre) {
    const targetGenre = options.filters.primaryGenre.toLowerCase();
    books = books.filter(
      b => (b.primaryGenre || '').toLowerCase() === targetGenre,
    );
  }

  if (options?.filters?.status) {
    const targetStatus = options.filters.status;
    books = books.filter(b => b.readingStatus === targetStatus);
  }

  if (options?.filters?.missingMetadata) {
    const missing = options.filters.missingMetadata;
    books = books.filter(b => {
      if (missing === 'geo') {
        return !b.geoMetadata;
      }
      if (missing === 'temporal') {
        return !b.temporalMetadata;
      }
      if (missing === 'genre' || missing === 'primaryGenre') {
        return !b.primaryGenre;
      }
      if (missing === 'synopsis') {
        return !b.synopsis && !b.bookDetailsMetadata?.hasSynopsis;
      }
      if (missing === 'authorBio') {
        return !b.authorBio && !b.bookDetailsMetadata?.hasAuthorBio;
      }
      if (missing === 'embedding' || missing === 'embeddings') {
        return !b.embedding?.length && !b.bookDetailsMetadata?.hasEmbedding;
      }
      if (missing === 'coverImage') {
        return !b.coverUrl;
      }
      if (missing === 'series') {
        return !b.series;
      }
      return true;
    });
  }

  const hasMore = hasMissingFilter
    ? books.length > limitCount || rawDocs.length >= fetchLimit
    : books.length > limitCount;
  const slicedBooks = books.slice(0, limitCount);
  const nextCursor = hasMore
    ? appliedNativeWhereFilter
      ? slicedBooks[slicedBooks.length - 1]?.id
      : hasMissingFilter
        ? books.length > limitCount
          ? slicedBooks[slicedBooks.length - 1]?.id
          : rawDocs[rawDocs.length - 1]?.id ||
            slicedBooks[slicedBooks.length - 1]?.id
        : slicedBooks[slicedBooks.length - 1]?.id ||
          rawDocs[rawDocs.length - 1]?.id
    : undefined;

  const authoritativeTotalCount =
    !hasAnyFilter && !options?.cursor
      ? typeof aggregatedCount === 'number'
        ? aggregatedCount
        : !hasMore
          ? slicedBooks.length
          : undefined
      : undefined;

  // Self-heal parent library.bookCount asynchronously when an unfiltered read detects drift
  if (
    typeof authoritativeTotalCount === 'number' &&
    options?.prefetchedLibraryData &&
    !libraryId.startsWith('virtual_') &&
    options.prefetchedLibraryData.bookCount !== authoritativeTotalCount
  ) {
    try {
      const libRef = db.collection('libraries').doc(libraryId) as {
        update?: (data: Record<string, unknown>) => Promise<unknown>;
      };
      if (typeof libRef?.update === 'function') {
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
        void Promise.resolve(libRef.update(healPayload)).catch(() => {});
      }
    } catch {
      // Non-fatal background reconciliation
    }
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
  const snaps =
    typeof (db as {getAll?: unknown}).getAll === 'function'
      ? await db.getAll(...docRefs)
      : await Promise.all(docRefs.map(ref => ref.get()));

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
