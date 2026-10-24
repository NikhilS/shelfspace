import {
  getPersonalReadingShelf,
  getUnreadLibraryBooks,
  searchUnifiedCatalog,
  trackBook,
  type TrackedShelfStatus,
  type TrackedBookItem,
  type UnreadLibraryBookItem,
  type ReadingShelfSummary,
  type UnifiedLibrarySearchMatch,
  type UnifiedExternalSearchMatch,
  type TrackBookInput,
} from './readingTrackerService';

export class ReadingTrackerService {
  static getPersonalReadingShelf = getPersonalReadingShelf;
  static getUnreadLibraryBooks = getUnreadLibraryBooks;
  static searchUnifiedCatalog = searchUnifiedCatalog;
  static trackBook = trackBook;
}

export {
  getPersonalReadingShelf,
  getUnreadLibraryBooks,
  searchUnifiedCatalog,
  trackBook,
  type TrackedShelfStatus,
  type TrackedBookItem,
  type UnreadLibraryBookItem,
  type ReadingShelfSummary,
  type UnifiedLibrarySearchMatch,
  type UnifiedExternalSearchMatch,
  type TrackBookInput,
};
