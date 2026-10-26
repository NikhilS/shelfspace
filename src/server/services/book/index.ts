import {getBook, listBooks, getBookDetailsChunk} from './bookReadService';
import {
  createBook,
  updateBook,
  updateBookStatus,
  recordReadSwipeReview,
  deleteBook,
  batchUpsert,
  mergeDuplicates,
} from './bookWriteService';
import {listReviews, addReview, reviewDocConverter} from './bookReviewService';
import {
  BookPartitioner,
  bookDocConverter,
  bookDetailsDocConverter,
  HEAVY_FIELDS,
  normalizeFirestoreTimestamp,
  sanitizeTemporalMetadata,
} from './bookPartitioner';
import {
  computeReadingStateKey,
  readingStateConverter,
  getReadingStatesCollection,
  buildBookSnapshotFromData,
  buildReadingStateUpsertPayload,
  normalizeReadingStateDoc,
  fetchUserReadingStateForBook,
  fetchUserReadingStatesMap,
  overlayReadingStateOnBook,
} from './readingStateLedger';

export class BookService {
  static createBook = createBook;
  static updateBook = updateBook;
  static updateBookStatus = updateBookStatus;
  static recordReadSwipeReview = recordReadSwipeReview;
  static deleteBook = deleteBook;
  static batchUpsert = batchUpsert;
  static mergeDuplicates = mergeDuplicates;
  static getBook = getBook;
  static listBooks = listBooks;
  static listReviews = listReviews;
  static addReview = addReview;
  static getBookDetailsChunk = getBookDetailsChunk;
}

export {
  createBook,
  updateBook,
  updateBookStatus,
  recordReadSwipeReview,
  deleteBook,
  batchUpsert,
  mergeDuplicates,
  getBook,
  listBooks,
  listReviews,
  addReview,
  reviewDocConverter,
  getBookDetailsChunk,
  BookPartitioner,
  bookDocConverter,
  bookDetailsDocConverter,
  HEAVY_FIELDS,
  normalizeFirestoreTimestamp,
  sanitizeTemporalMetadata,
  computeReadingStateKey,
  readingStateConverter,
  getReadingStatesCollection,
  buildBookSnapshotFromData,
  buildReadingStateUpsertPayload,
  normalizeReadingStateDoc,
  fetchUserReadingStateForBook,
  fetchUserReadingStatesMap,
  overlayReadingStateOnBook,
};
