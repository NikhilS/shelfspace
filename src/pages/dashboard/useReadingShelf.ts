import {useState, useMemo, useCallback} from 'react';
import {useAuth} from '../../stores/authStore';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {toast} from 'sonner';
import type {
  TrackedBookItem,
  TrackedShelfStatus,
  ReadingShelfSummary,
  UnreadLibraryBookItem,
  TrackBookInput,
} from '../../server/services/readingTracker';

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
          staleTime: 1000 * 60 * 2,
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
          staleTime: 1000 * 60 * 2,
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

  const invalidateAll = useCallback(async () => {
    try {
      await utils?.readingTracker?.getShelf?.invalidate?.();
      await utils?.readingTracker?.getUnreadLibraryBooks?.invalidate?.();
      await utils?.library?.list?.invalidate?.();
    } catch {
      void shelfQuery?.refetch?.();
      void unreadQuery?.refetch?.();
    }
  }, [utils, shelfQuery, unreadQuery]);

  const updateItemStatus = useCallback(
    async (
      libraryId: string,
      bookId: string,
      nextStatus: TrackedShelfStatus | 'unset',
    ) => {
      if (!user) {
        return;
      }
      try {
        if (trpcVanilla?.book?.updateStatus?.mutate) {
          await trpcVanilla.book.updateStatus.mutate({
            libraryId,
            bookId,
            status: nextStatus,
          });
        } else if (trpcVanilla?.readingTracker?.trackBook?.mutate) {
          await trpcVanilla.readingTracker.trackBook.mutate({
            source: 'library',
            libraryId,
            bookId,
            status: nextStatus,
          });
        }
        toast.success(
          nextStatus === 'unset'
            ? 'Removed from reading list'
            : 'Reading status updated',
        );
        await invalidateAll();
      } catch (err) {
        console.error('Failed to update reading status:', err);
        toast.error('Failed to update reading status');
      }
    },
    [user, invalidateAll],
  );

  const trackBookItem = useCallback(
    async (input: TrackBookInput) => {
      if (!user) {
        return undefined;
      }
      const result = await trpcVanilla.readingTracker.trackBook.mutate(input);
      await invalidateAll();
      return result;
    },
    [user, invalidateAll],
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
