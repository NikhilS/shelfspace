import {
  getPersonalReadingShelf,
  searchUnifiedCatalog,
  trackBook,
  type TrackedShelfStatus,
  type TrackedBookItem,
  type ReadingShelfSummary,
  type UnifiedLibrarySearchMatch,
  type UnifiedExternalSearchMatch,
  type TrackBookInput,
} from './readingTrackerService';

export class ReadingTrackerService {
  static getPersonalReadingShelf = getPersonalReadingShelf;
  static searchUnifiedCatalog = searchUnifiedCatalog;
  static trackBook = trackBook;
}

export {
  getPersonalReadingShelf,
  searchUnifiedCatalog,
  trackBook,
  type TrackedShelfStatus,
  type TrackedBookItem,
  type ReadingShelfSummary,
  type UnifiedLibrarySearchMatch,
  type UnifiedExternalSearchMatch,
  type TrackBookInput,
};
