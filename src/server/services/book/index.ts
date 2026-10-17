import {getBook, listBooks, getBookDetailsChunk} from './bookReadService';
import {
  createBook,
  updateBook,
  deleteBook,
  batchUpsert,
} from './bookWriteService';
import {listReviews, addReview} from './bookReviewService';

export class BookService {
  static createBook = createBook;
  static updateBook = updateBook;
  static deleteBook = deleteBook;
  static batchUpsert = batchUpsert;
  static getBook = getBook;
  static listBooks = listBooks;
  static listReviews = listReviews;
  static addReview = addReview;
  static getBookDetailsChunk = getBookDetailsChunk;
}

export {
  createBook,
  updateBook,
  deleteBook,
  batchUpsert,
  getBook,
  listBooks,
  listReviews,
  addReview,
  getBookDetailsChunk,
};
