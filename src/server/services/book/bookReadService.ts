import {getAdminDb} from '../firebaseAdmin';
import {FieldPath} from 'firebase-admin/firestore';
import {TRPCError} from '@trpc/server';
import {LibraryService} from '../library';
import type {
  Book,
  BookDetailsPayload,
  BookDetailsMetadata,
} from '../../../types';
import {BookPartitioner} from './bookPartitioner';

/**
 * Retrieves a single book by ID, optionally merging partitioned heavy metadata.
 */
export async function getBook(
  _userId: string,
  libraryId: string,
  bookId: string,
): Promise<Book> {
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

  let bookSnap: FirebaseFirestore.DocumentSnapshot;
  let detailSnap: FirebaseFirestore.DocumentSnapshot | undefined;

  if (typeof (db as {getAll?: unknown}).getAll === 'function') {
    const [bSnap, dSnap] = await db.getAll(bookRef, detailRef);
    bookSnap = bSnap;
    detailSnap = dSnap;
  } else {
    bookSnap = await bookRef.get();
    try {
      detailSnap = await detailRef.get();
    } catch {
      detailSnap = undefined;
    }
  }

  if (!bookSnap.exists) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Book '${bookId}' not found in library '${libraryId}'`,
    });
  }

  const bookData = (bookSnap.data() || {}) as Partial<Book>;
  const heavyData: BookDetailsPayload =
    detailSnap && detailSnap.exists
      ? ((detailSnap.data() || {}) as BookDetailsPayload)
      : {};

  return BookPartitioner.mergeBookAndDetails(bookSnap.id, bookData, heavyData);
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
  _userId: string,
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
  if (typeof (query as {where?: unknown}).where === 'function') {
    if (options?.filters?.status && _userId) {
      query = query.where(
        new FieldPath('userStatuses', _userId),
        '==',
        options.filters.status,
      );
      appliedNativeWhereFilter = true;
    } else if (options?.filters?.primaryGenre) {
      query = query.where('primaryGenre', '==', options.filters.primaryGenre);
      appliedNativeWhereFilter = true;
    }
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
  const hasAnyFilter = Boolean(
    hasMissingFilter ||
    options?.filters?.primaryGenre ||
    options?.filters?.status,
  );
  const fetchLimit = hasMissingFilter
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

  const [snapshot, aggregatedCount] = await Promise.all([
    query.get(),
    countAggregatePromise,
  ]);

  let rawDocs = snapshot.docs || [];

  // If a native .where() filter returned 0 docs, check targeted legacy status or case-insensitive primaryGenre
  if (appliedNativeWhereFilter && rawDocs.length === 0) {
    try {
      if (options?.filters?.status) {
        const legacyStatusSnap = await booksCollection
          .where('status', '==', options.filters.status)
          .limit(fetchLimit)
          .get();
        if (legacyStatusSnap?.docs && legacyStatusSnap.docs.length > 0) {
          rawDocs = legacyStatusSnap.docs;
        }
      } else if (options?.filters?.primaryGenre) {
        const fallbackSnap = await booksCollection.limit(fetchLimit).get();
        if (fallbackSnap?.docs && fallbackSnap.docs.length > 0) {
          rawDocs = fallbackSnap.docs;
        }
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
    const data = (doc.data() || {}) as Partial<Book>;
    return BookPartitioner.mergeBookAndDetails(doc.id, data);
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
    books = books.filter(
      b =>
        b.status === targetStatus ||
        (_userId && b.userStatuses?.[_userId] === targetStatus),
    );
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
        return (
          !b.synopsis &&
          !(b.bookDetailsMetadata as BookDetailsMetadata | undefined)
            ?.hasSynopsis
        );
      }
      if (missing === 'authorBio') {
        return (
          !b.authorBio &&
          !(b.bookDetailsMetadata as BookDetailsMetadata | undefined)
            ?.hasAuthorBio
        );
      }
      if (missing === 'embedding' || missing === 'embeddings') {
        return (
          !b.embedding?.length &&
          !(b.bookDetailsMetadata as BookDetailsMetadata | undefined)
            ?.hasEmbedding
        );
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
        void Promise.resolve(
          libRef.update({bookCount: authoritativeTotalCount}),
        ).catch(() => {});
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
      details[snap.id] = (snap.data() || {}) as BookDetailsPayload;
    }
  });

  return {details};
}
