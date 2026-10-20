import {getAdminDb} from '../firebaseAdmin';
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
export async function listBooks(
  _userId: string,
  libraryId: string,
  options?: {
    filters?: {
      missingMetadata?: string;
      primaryGenre?: string;
      status?: string;
    };
    limit?: number;
    cursor?: string;
  },
): Promise<{books: Book[]; nextCursor?: string}> {
  const db = getAdminDb();
  const booksCollection = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books');
  let query: FirebaseFirestore.Query = booksCollection;

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

  const limitCount = options?.limit ?? 1000;
  const hasMissingFilter = Boolean(options?.filters?.missingMetadata);
  const fetchLimit = hasMissingFilter
    ? Math.min(2000, limitCount * 3)
    : limitCount;
  query = query.limit(fetchLimit);

  const snapshot = await query.get();
  let books: Book[] = snapshot.docs.map(doc => {
    const data = (doc.data() || {}) as Partial<Book>;
    return BookPartitioner.mergeBookAndDetails(doc.id, data);
  });

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
      if (missing === 'geo') return !b.geoMetadata;
      if (missing === 'temporal') return !b.temporalMetadata;
      if (missing === 'genre' || missing === 'primaryGenre')
        return !b.primaryGenre;
      if (missing === 'synopsis')
        return (
          !b.synopsis &&
          !(b.bookDetailsMetadata as BookDetailsMetadata | undefined)
            ?.hasSynopsis
        );
      if (missing === 'authorBio')
        return (
          !b.authorBio &&
          !(b.bookDetailsMetadata as BookDetailsMetadata | undefined)
            ?.hasAuthorBio
        );
      if (missing === 'embedding' || missing === 'embeddings')
        return (
          !b.embedding?.length &&
          !(b.bookDetailsMetadata as BookDetailsMetadata | undefined)
            ?.hasEmbedding
        );
      if (missing === 'coverImage') return !b.coverUrl;
      if (missing === 'series') return !b.series;
      return true;
    });
  }

  const hasMore =
    books.length > limitCount || snapshot.docs.length >= fetchLimit;
  const slicedBooks = books.slice(0, limitCount);
  const nextCursor = hasMore
    ? slicedBooks[slicedBooks.length - 1]?.id ||
      snapshot.docs[snapshot.docs.length - 1]?.id
    : undefined;

  return {
    books: slicedBooks,
    nextCursor,
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
