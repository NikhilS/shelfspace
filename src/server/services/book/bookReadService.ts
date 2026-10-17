import {getAdminDb} from '../firebaseAdmin';
import {TRPCError} from '@trpc/server';
import {LibraryService} from '../library';
import type {
  Book,
  BookDetailsPayload,
  BookDetailsMetadata,
  BookTemporalMetadata,
} from '../../../types';

/**
 * Retrieves a single book by ID, optionally merging partitioned heavy metadata.
 */
export async function getBook(
  _userId: string,
  libraryId: string,
  bookId: string,
): Promise<Book> {
  const db = getAdminDb();
  const bookSnap = await db
    .collection('libraries')
    .doc(libraryId)
    .collection('books')
    .doc(bookId)
    .get();

  if (!bookSnap.exists) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Book '${bookId}' not found in library '${libraryId}'`,
    });
  }

  const bookData = (bookSnap.data() || {}) as Partial<Book>;
  let heavyData: BookDetailsPayload = {};

  try {
    const detailSnap = await db
      .collection('libraries')
      .doc(libraryId)
      .collection('bookDetails')
      .doc(bookId)
      .get();
    if (detailSnap.exists) {
      heavyData = (detailSnap.data() || {}) as BookDetailsPayload;
    }
  } catch {
    // Non-critical if bookDetails subcollection doesn't exist
  }

  return {
    title: bookData.title || 'Untitled Book',
    author: bookData.author || 'Unknown Author',
    addedBy: bookData.addedBy ?? null,
    addedAt: bookData.addedAt || new Date().toISOString(),
    ...bookData,
    id: bookSnap.id,
    ...(heavyData.synopsis ? {synopsis: heavyData.synopsis} : {}),
    ...(heavyData.authorBio ? {authorBio: heavyData.authorBio} : {}),
    ...(heavyData.embedding ? {embedding: heavyData.embedding} : {}),
    ...(heavyData.clusterCoordinates
      ? {clusterCoordinates: heavyData.clusterCoordinates}
      : {}),
  };
}

/**
 * Lists books in a library, applying optional filters and pagination.
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
  let query: FirebaseFirestore.Query = db
    .collection('libraries')
    .doc(libraryId)
    .collection('books');

  try {
    query = query.orderBy('addedAt', 'desc');
  } catch {
    // In tests or if index not configured
  }

  const limitCount = options?.limit ?? 1000;
  query = query.limit(limitCount);

  const snapshot = await query.get();
  let books: Book[] = snapshot.docs.map(doc => {
    const data = (doc.data() || {}) as Partial<Book>;
    const bookData: Book = {
      title: data.title || 'Untitled Book',
      author: data.author || 'Unknown Author',
      addedBy: data.addedBy ?? null,
      addedAt: data.addedAt || new Date().toISOString(),
      ...data,
      id: doc.id,
      primaryGenre: data.primaryGenre || undefined,
      subgenres: Array.isArray(data.subgenres) ? data.subgenres : [],
      isCustomPrimary: Boolean(data.isCustomPrimary),
    };

    if (
      bookData.temporalMetadata &&
      typeof bookData.temporalMetadata === 'object'
    ) {
      const temporal: BookTemporalMetadata = {
        ...bookData.temporalMetadata,
      };
      if (temporal.startYear !== undefined && temporal.endYear === undefined) {
        temporal.endYear = temporal.startYear;
      }
      const start = temporal.startYear;
      const end = temporal.endYear;
      if (
        (start !== undefined && (start < -10000 || start > 2100)) ||
        (end !== undefined && (end < -10000 || end > 2100))
      ) {
        delete bookData.temporalMetadata;
      } else {
        bookData.temporalMetadata = temporal;
      }
    }

    return bookData;
  });

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
      if (missing === 'coverImage') return !b.coverUrl;
      return true;
    });
  }

  return {
    books,
    nextCursor:
      snapshot.docs.length >= limitCount
        ? snapshot.docs[snapshot.docs.length - 1]?.id
        : undefined,
  };
}

/**
 * Batches book details retrieval for constellation and graph views.
 */
export async function getBookDetailsChunk(
  userId: string,
  userEmail: string | undefined,
  libraryId: string,
  bookIds: string[],
): Promise<{details: Record<string, BookDetailsPayload>}> {
  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    libraryId,
    'viewer',
  );

  const db = getAdminDb();
  const detailsCollection = db
    .collection('libraries')
    .doc(libraryId)
    .collection('bookDetails');

  const snaps = await Promise.all(
    bookIds.map(id => detailsCollection.doc(id).get()),
  );

  const details: Record<string, BookDetailsPayload> = {};
  snaps.forEach(snap => {
    if (snap.exists) {
      details[snap.id] = (snap.data() || {}) as BookDetailsPayload;
    }
  });

  return {details};
}
