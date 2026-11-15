import type {Book, BookDetails} from './index';

export type TrackedShelfStatus =
  'want_to_read' | 'reading' | 'finished' | 'abandoned';

export interface TrackedBookItem extends Book {
  libraryId: string;
  libraryName: string;
  isVirtual: boolean;
  ownershipStatus: 'owned' | 'unowned';
  readingStatus: TrackedShelfStatus;
  userRating?: number;
}

export interface ReadingShelfSummary {
  items: TrackedBookItem[];
  counts: {
    all: number;
    want_to_read: number;
    reading: number;
    finished: number;
    abandoned: number;
  };
}

export interface UnreadLibraryBookItem extends Book {
  libraryId: string;
  libraryName: string;
  readingStatus: 'unset' | 'want_to_read';
}

export interface UnifiedLibrarySearchMatch {
  bookId: string;
  libraryId: string;
  libraryName: string;
  isVirtual: boolean;
  ownershipStatus: 'owned' | 'unowned';
  title: string;
  author: string;
  series?: string;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  primaryGenre?: string;
  synopsis?: string;
  readingStatus: TrackedShelfStatus | 'unset';
  userRating?: number;
}

export interface UnifiedExternalSearchMatch extends BookDetails {
  existingMatch?: {
    bookId: string;
    libraryId: string;
    libraryName: string;
    isVirtual: boolean;
    ownershipStatus: 'owned' | 'unowned';
    readingStatus: TrackedShelfStatus | 'unset';
  };
}

export interface TrackBookInput {
  source: 'library' | 'external';
  status: TrackedShelfStatus | 'unset';
  libraryId?: string;
  bookId?: string;
  targetLibraryId?: string;
  bookData?: {
    title: string;
    author?: string;
    isbn?: string;
    coverUrl?: string;
    publishedDate?: string;
    primaryGenre?: string;
    subgenres?: string[];
    synopsis?: string;
    authorBio?: string;
    series?: string;
    format?: 'physical' | 'digital';
  };
  rating?: number;
  reviewText?: string;
}
