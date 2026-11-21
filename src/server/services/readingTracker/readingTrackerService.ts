import {getAdminDb} from '../firebaseAdmin';
import {LibraryService} from '../library';
import {getVirtualLibraryId} from '../library/libraryShareService';
import {BookService, bookDocConverter} from '../book';
import {
  normalizeIsbnForDedupe,
  computeBookDedupeKey,
} from '../../../lib/duplicateDetection';
import type {Book} from '../../../types';
import type {
  ReadingShelfSummary,
  TrackBookInput,
  TrackedBookItem,
  TrackedShelfStatus,
  UnifiedExternalSearchMatch,
  UnifiedLibrarySearchMatch,
  UnreadLibraryBookItem,
} from '../../../types/readingTracker';
import {
  getPersonalReadingShelf,
  getUnreadLibraryBooks,
} from './readingShelfHydrator';
import {searchUnifiedCatalog} from './unifiedCatalogSearch';

export {
  getPersonalReadingShelf,
  getUnreadLibraryBooks,
  searchUnifiedCatalog,
  type TrackedShelfStatus,
  type TrackedBookItem,
  type UnreadLibraryBookItem,
  type ReadingShelfSummary,
  type UnifiedLibrarySearchMatch,
  type UnifiedExternalSearchMatch,
  type TrackBookInput,
};

/**
 * Adds or updates a book on the user's personal reading tracker, supporting both
 * in-place tracking on accessible libraries and virtual ('unowned') book tracking,
 * plus optional rating & review submission.
 */
export async function trackBook(
  userId: string,
  userEmail: string | undefined,
  userName: string | undefined,
  input: TrackBookInput,
): Promise<{
  success: true;
  libraryId: string;
  bookId: string;
  status: TrackedShelfStatus | 'unset';
  ownershipStatus: 'owned' | 'unowned';
  isVirtual: boolean;
  rating?: number;
  book?: Book;
}> {
  const db = getAdminDb();
  const hasValidRating = typeof input.rating === 'number' && input.rating >= 1;
  const trimmedReviewText = input.reviewText?.trim() || '';
  const hasReview = hasValidRating && trimmedReviewText.length > 0;

  if (input.source === 'library' && input.libraryId && input.bookId) {
    await LibraryService.verifyLibraryAccess(
      userId,
      userEmail,
      input.libraryId,
      'viewer',
    );

    if (hasReview && input.rating !== undefined) {
      await BookService.addReview(
        userId,
        userEmail,
        userName,
        input.libraryId,
        input.bookId,
        {
          rating: input.rating,
          text: trimmedReviewText,
        },
        {skipAccessCheck: true, status: input.status},
      );
    } else {
      await BookService.updateBookStatus(
        userId,
        input.libraryId,
        input.bookId,
        input.status,
        hasValidRating ? {rating: input.rating} : undefined,
      );
    }

    const isVirtual = input.libraryId === getVirtualLibraryId(userId);
    return {
      success: true,
      libraryId: input.libraryId,
      bookId: input.bookId,
      status: input.status,
      ownershipStatus: isVirtual ? 'unowned' : 'owned',
      isVirtual,
      ...(hasValidRating && typeof input.rating === 'number'
        ? {rating: input.rating}
        : {}),
    };
  }

  const virtualLibraryId = getVirtualLibraryId(userId);
  const destinationLibraryId = input.targetLibraryId || virtualLibraryId;
  const isVirtual = destinationLibraryId === virtualLibraryId;
  const ownershipStatus: 'owned' | 'unowned' = isVirtual ? 'unowned' : 'owned';

  await LibraryService.verifyLibraryAccess(
    userId,
    userEmail,
    destinationLibraryId,
    isVirtual ? 'owner' : 'editor',
  );

  const bookData = input.bookData || {
    title: 'Untitled Book',
    author: 'Unknown Author',
  };

  let existingBookId: string | undefined;
  const booksRef = db
    .collection('libraries')
    .doc(destinationLibraryId)
    .collection('books');
  const targetIsbn = normalizeIsbnForDedupe(bookData.isbn);
  const targetDedupeKey = computeBookDedupeKey(
    bookData.title,
    bookData.author || 'Unknown Author',
  );

  const indexQueries: Array<Promise<FirebaseFirestore.QuerySnapshot>> = [];
  if (targetIsbn) {
    indexQueries.push(
      booksRef.where('cleanIsbn', '==', targetIsbn).limit(1).get(),
    );
  }
  if (targetDedupeKey) {
    indexQueries.push(
      booksRef.where('dedupeKey', '==', targetDedupeKey).limit(1).get(),
    );
  }

  if (indexQueries.length > 0) {
    const indexSnaps = await Promise.all(indexQueries);
    for (const snap of indexSnaps) {
      const matchedDoc = snap?.docs?.[0];
      if (matchedDoc?.id) {
        const parsedBook = bookDocConverter.fromFirestore(
          matchedDoc.id,
          typeof matchedDoc.data === 'function' ? matchedDoc.data() || {} : {},
          `/libraries/${destinationLibraryId}/books/${matchedDoc.id}`,
        );
        existingBookId = parsedBook.id;
        break;
      }
    }
  }

  let resolvedBookId: string;

  let createdBook: Book | undefined;

  if (existingBookId) {
    resolvedBookId = existingBookId;
    if (hasReview && input.rating !== undefined) {
      await BookService.addReview(
        userId,
        userEmail,
        userName,
        destinationLibraryId,
        resolvedBookId,
        {
          rating: input.rating,
          text: trimmedReviewText,
        },
        {skipAccessCheck: true, status: input.status},
      );
    } else {
      await BookService.updateBookStatus(
        userId,
        destinationLibraryId,
        resolvedBookId,
        input.status,
        hasValidRating ? {rating: input.rating} : undefined,
      );
    }
  } else {
    const created = await BookService.createBook(userId, {
      libraryId: destinationLibraryId,
      title: bookData.title.trim() || 'Untitled Book',
      author: (bookData.author || 'Unknown Author').trim(),
      isbn: bookData.isbn,
      coverUrl: bookData.coverUrl,
      publishedDate: bookData.publishedDate,
      primaryGenre: bookData.primaryGenre,
      subgenres: bookData.subgenres,
      synopsis: bookData.synopsis,
      authorBio: bookData.authorBio,
      series: bookData.series,
      format: bookData.format || 'physical',
      ownershipStatus,
      readingStatus: input.status,
    });
    resolvedBookId = created.id;
    createdBook = created.book
      ? {
          ...created.book,
          ...(hasValidRating && typeof input.rating === 'number'
            ? {userRating: input.rating}
            : {}),
        }
      : undefined;

    if (hasReview && input.rating !== undefined) {
      await BookService.addReview(
        userId,
        userEmail,
        userName,
        destinationLibraryId,
        resolvedBookId,
        {
          rating: input.rating,
          text: trimmedReviewText,
        },
        {skipAccessCheck: true, status: input.status},
      );
    } else if (hasValidRating && input.rating !== undefined) {
      await BookService.updateBookStatus(
        userId,
        destinationLibraryId,
        resolvedBookId,
        input.status,
        {rating: input.rating, skipAccessCheck: true},
      );
    }
  }

  return {
    success: true,
    libraryId: destinationLibraryId,
    bookId: resolvedBookId,
    status: input.status,
    ownershipStatus,
    isVirtual,
    ...(hasValidRating && typeof input.rating === 'number'
      ? {rating: input.rating}
      : {}),
    ...(createdBook ? {book: createdBook} : {}),
  };
}
