import type {UserReadingStateBookSnapshot} from '../../schemas/readingState';
import type {
  Book,
  Library,
  ReadingStatusValue,
  TrackedShelfStatus,
} from '../../types';

export type CanonicalReadingStatus = TrackedShelfStatus | 'unset';

export interface TrpcCacheSlot<Input, Data> {
  getData?(input?: Input): Data | undefined;
  setData?(
    input: Input,
    updater: Data | ((old: Data | undefined) => Data | undefined),
  ): void;
  invalidate?(input?: Input): Promise<unknown> | unknown;
}

export interface ReadingStatusCacheUtils {
  book?: {
    get?: TrpcCacheSlot<{libraryId: string; bookId: string}, unknown>;
    list?: TrpcCacheSlot<{libraryId: string}, unknown>;
    listReviews?: TrpcCacheSlot<{libraryId: string; bookId: string}, unknown>;
  };
  readingTracker?: {
    getShelf?: TrpcCacheSlot<
      {shelf?: TrackedShelfStatus | 'all'} | undefined,
      unknown
    >;
    getUnreadLibraryBooks?: TrpcCacheSlot<undefined, unknown>;
    getRecommendations?: TrpcCacheSlot<undefined, unknown>;
  };
  library?: {
    get?: TrpcCacheSlot<{libraryId: string}, unknown>;
    list?: TrpcCacheSlot<
      {scopes?: Array<'owned' | 'shared' | 'all'>} | undefined,
      unknown
    >;
  };
}

export interface OptimisticReadingStatusParams {
  libraryId: string;
  bookId: string;
  status: ReadingStatusValue | string | null | undefined;
  reviewedAtIso?: string | null;
  bookHint?: Partial<Book> & {libraryName?: string};
}

export interface OptimisticBookEditParams {
  libraryId: string;
  bookId: string;
  patch: Partial<Book>;
  bookHint?: Partial<Book> & {libraryName?: string};
}

export interface CommitReadingStatusDeltaParams {
  libraryId: string;
  bookId: string;
  status: ReadingStatusValue | string | null | undefined;
  reviewedAt?: string | null;
  rating?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  bookSnapshot?: Partial<UserReadingStateBookSnapshot>;
  bookHint?: Partial<Book> & {libraryName?: string};
}

export interface CommitBookUpsertDeltaParams {
  libraryId: string;
  book: Partial<Book> & {id: string; title: string; author: string};
  libraryName?: string;
  bookCountDelta?: number;
}

export interface CommitBookDeleteDeltaParams {
  libraryId: string;
  bookId: string;
  bookCountDelta?: number;
  alreadyRemovedOptimistically?: boolean;
}

export interface CommitBookReviewDeltaParams {
  libraryId: string;
  bookId: string;
  review: {
    id: string;
    userId: string;
    userName: string;
    rating: number;
    text: string;
    createdAt: string;
  };
}

export type LibraryCacheUpdater = (
  old: Library | undefined,
) => Library | undefined;
