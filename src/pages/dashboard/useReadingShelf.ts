import {useState, useMemo, useCallback} from 'react';
import {useAuth} from '../../stores/authStore';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {toast} from 'sonner';
import {
  applyOptimisticReadingStatusPatch,
  buildBookSnapshotHint,
  commitBookUpsertDelta,
  commitReadingStatusDelta,
} from '../../lib/readingStatusCache';
import type {
  Book,
  TrackedBookItem,
  TrackedShelfStatus,
  ReadingShelfSummary,
  UnreadLibraryBookItem,
  TrackBookInput,
} from '../../types';

export type ShelfFilterTab = 'all' | TrackedShelfStatus;

const EMPTY_SUMMARY: ReadingShelfSummary = {
  items: [],
  counts: {
    all: 0,
    want_to_read: 0,
    reading: 0,
    finished: 0,
    abandoned: 0,
  },
};

export function useReadingShelf(options?: {enabled?: boolean}) {
  const {user} = useAuth();
  const [activeShelf, setActiveShelf] = useState<ShelfFilterTab>('all');
  const isEnabled = options?.enabled ?? true;

  let utils: ReturnType<typeof trpc.useUtils> | undefined;
  try {
    if (typeof trpc !== 'undefined' && typeof trpc.useUtils === 'function') {
      utils = trpc.useUtils();
    }
  } catch {
    utils = undefined;
  }

  let shelfQuery:
    | {
        data?: unknown;
        isLoading?: boolean;
        error?: unknown;
        refetch?: () => Promise<unknown>;
      }
    | undefined;
  try {
    if (trpc?.readingTracker?.getShelf?.useQuery) {
      shelfQuery = trpc.readingTracker.getShelf.useQuery(
        {shelf: 'all'},
        {
          enabled: Boolean(user) && isEnabled,
          staleTime: 1000 * 60 * 5,
        },
      );
    }
  } catch {
    shelfQuery = undefined;
  }

  let unreadQuery:
    | {
        data?: UnreadLibraryBookItem[] | {books?: UnreadLibraryBookItem[]};
        isLoading?: boolean;
        refetch?: () => Promise<unknown>;
      }
    | undefined;
  try {
    if (trpc?.readingTracker?.getUnreadLibraryBooks?.useQuery) {
      unreadQuery = trpc.readingTracker.getUnreadLibraryBooks.useQuery(
        undefined,
        {
          enabled: Boolean(user) && isEnabled,
          staleTime: 1000 * 60 * 5,
        },
      );
    }
  } catch {
    unreadQuery = undefined;
  }

  const summary: ReadingShelfSummary = useMemo(() => {
    const data = shelfQuery?.data as ReadingShelfSummary | undefined;
    if (!data || !Array.isArray(data.items)) {
      return EMPTY_SUMMARY;
    }
    return data;
  }, [shelfQuery?.data]);

  const unreadLibraryBooks = useMemo<UnreadLibraryBookItem[]>(() => {
    const raw = unreadQuery?.data;
    if (Array.isArray(raw)) {
      return raw;
    }
    if (raw && typeof raw === 'object' && Array.isArray(raw.books)) {
      return raw.books;
    }
    return [];
  }, [unreadQuery?.data]);

  const filteredItems = useMemo<TrackedBookItem[]>(() => {
    if (activeShelf === 'all') {
      return summary.items;
    }
    return summary.items.filter(item => item.readingStatus === activeShelf);
  }, [summary.items, activeShelf]);

  const updateItemStatus = useCallback(
    async (
      libraryId: string,
      bookId: string,
      nextStatus: TrackedShelfStatus | 'unset',
    ) => {
      if (!user) {
        return;
      }
      const existingItem =
        summary.items.find(
          item => item.id === bookId && item.libraryId === libraryId,
        ) ??
        unreadLibraryBooks.find(
          item => item.id === bookId && item.libraryId === libraryId,
        );
      const snapshotHint = buildBookSnapshotHint(existingItem, {
        libraryId,
        bookId,
        libraryName: existingItem?.libraryName,
      });

      const rollback = applyOptimisticReadingStatusPatch(utils, {
        libraryId,
        bookId,
        status: nextStatus,
        bookHint: existingItem,
      });
      try {
        if (trpcVanilla?.book?.updateStatus?.mutate) {
          const response = await trpcVanilla.book.updateStatus.mutate({
            libraryId,
            bookId,
            status: nextStatus,
            ...(snapshotHint ? {bookSnapshot: snapshotHint} : {}),
          });
          commitReadingStatusDelta(utils, {
            libraryId,
            bookId,
            status: response?.status ?? nextStatus,
            reviewedAt: response?.reviewedAt,
            rating: response?.rating,
            startedAt: response?.startedAt,
            finishedAt: response?.finishedAt,
            bookSnapshot: response?.bookSnapshot,
            bookHint: existingItem,
          });
        } else if (trpcVanilla?.readingTracker?.trackBook?.mutate) {
          const response = await trpcVanilla.readingTracker.trackBook.mutate({
            source: 'library',
            libraryId,
            bookId,
            status: nextStatus,
          });
          commitReadingStatusDelta(utils, {
            libraryId,
            bookId,
            status: response?.status ?? nextStatus,
            rating: response?.rating,
            bookHint: existingItem,
          });
        }
        toast.success(
          nextStatus === 'unset'
            ? 'Removed from reading list'
            : 'Reading status updated',
        );
      } catch (err) {
        rollback();
        console.error('Failed to update reading status:', err);
        toast.error('Failed to update reading status');
      }
    },
    [user, summary.items, unreadLibraryBooks, utils],
  );

  const trackBookItem = useCallback(
    async (input: TrackBookInput) => {
      if (!user) {
        return undefined;
      }
      const rollback =
        input.source === 'library' && input.libraryId && input.bookId
          ? applyOptimisticReadingStatusPatch(utils, {
              libraryId: input.libraryId,
              bookId: input.bookId,
              status: input.status,
            })
          : () => {};
      try {
        const result = await trpcVanilla.readingTracker.trackBook.mutate(input);
        const resolvedLibraryId =
          input.source === 'library'
            ? input.libraryId
            : (result as {libraryId?: string} | undefined)?.libraryId;
        const resolvedBookId =
          input.source === 'library'
            ? input.bookId
            : (result as {bookId?: string} | undefined)?.bookId;

        if (resolvedLibraryId && resolvedBookId) {
          const returnedBook = (
            result as {
              book?: Partial<Book> & {
                id: string;
                title: string;
                author: string;
                libraryName?: string;
              };
            }
          )?.book;
          if (returnedBook?.id && returnedBook.title) {
            commitBookUpsertDelta(utils, {
              libraryId: resolvedLibraryId,
              book: {
                ...returnedBook,
                readingStatus: result?.status ?? input.status,
              },
              libraryName: returnedBook.libraryName,
            });
          } else {
            commitReadingStatusDelta(utils, {
              libraryId: resolvedLibraryId,
              bookId: resolvedBookId,
              status: result?.status ?? input.status,
              rating: result?.rating,
            });
          }
        }
        return result;
      } catch (err) {
        rollback();
        throw err;
      }
    },
    [user, utils],
  );

  return {
    items: filteredItems,
    allItems: summary.items,
    unreadLibraryBooks,
    counts: summary.counts,
    activeShelf,
    setActiveShelf,
    isLoading: Boolean(shelfQuery?.isLoading),
    error: shelfQuery?.error,
    refetch: shelfQuery?.refetch,
    updateItemStatus,
    trackBookItem,
  };
}
