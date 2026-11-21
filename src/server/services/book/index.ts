import {
  getBook,
  listBooks,
  getBookDetailsChunk,
  syncChanges,
  type ReadingStateSyncOverlay,
  type SyncBookChangesOptions,
  type SyncBookChangesResult,
} from './bookReadService';
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
  computeBookMissingFlags,
  computePrimaryGenreLower,
  HEAVY_FIELDS,
  normalizeFirestoreTimestamp,
  sanitizeTemporalMetadata,
} from './bookPartitioner';
import {
  bookTombstoneConverter,
  clearBookTombstoneInBatch,
  queryDeletedBookIdsSince,
  stageBookTombstoneInBatch,
} from './bookTombstoneLedger';
import {
  computeReadingStateKey,
  parseBookOrStateIdentifier,
  resolveReadingStateKeyType,
  readingStateConverter,
  getReadingStatesCollection,
  buildBookSnapshotFromData,
  buildReadingStateUpsertPayload,
  normalizeReadingStateDoc,
  fetchUserReadingStateForBook,
  fetchUserReadingStatesMap,
  fetchUserReadingStatesProjection,
  loadUserReadingStatesMap,
  resolveReadingStateFromMap,
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
  static syncChanges = syncChanges;
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
  syncChanges,
  listReviews,
  addReview,
  reviewDocConverter,
  getBookDetailsChunk,
  type ReadingStateSyncOverlay,
  type SyncBookChangesOptions,
  type SyncBookChangesResult,
  BookPartitioner,
  bookDocConverter,
  bookDetailsDocConverter,
  computeBookMissingFlags,
  computePrimaryGenreLower,
  HEAVY_FIELDS,
  normalizeFirestoreTimestamp,
  sanitizeTemporalMetadata,
  bookTombstoneConverter,
  clearBookTombstoneInBatch,
  queryDeletedBookIdsSince,
  stageBookTombstoneInBatch,
  computeReadingStateKey,
  parseBookOrStateIdentifier,
  resolveReadingStateKeyType,
  readingStateConverter,
  getReadingStatesCollection,
  buildBookSnapshotFromData,
  buildReadingStateUpsertPayload,
  normalizeReadingStateDoc,
  fetchUserReadingStateForBook,
  fetchUserReadingStatesMap,
  fetchUserReadingStatesProjection,
  loadUserReadingStatesMap,
  resolveReadingStateFromMap,
  overlayReadingStateOnBook,
};
