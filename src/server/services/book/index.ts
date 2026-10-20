import {getBook, listBooks, getBookDetailsChunk} from './bookReadService';
import {
  createBook,
  updateBook,
  updateBookStatus,
  deleteBook,
  batchUpsert,
  mergeDuplicates,
} from './bookWriteService';
import {listReviews, addReview} from './bookReviewService';
import {
  BookPartitioner,
  HEAVY_FIELDS,
  normalizeFirestoreTimestamp,
  sanitizeTemporalMetadata,
} from './bookPartitioner';

export class BookService {
  static createBook = createBook;
  static updateBook = updateBook;
  static updateBookStatus = updateBookStatus;
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
  deleteBook,
  batchUpsert,
  mergeDuplicates,
  getBook,
  listBooks,
  listReviews,
  addReview,
  getBookDetailsChunk,
  BookPartitioner,
  HEAVY_FIELDS,
  normalizeFirestoreTimestamp,
  sanitizeTemporalMetadata,
};
