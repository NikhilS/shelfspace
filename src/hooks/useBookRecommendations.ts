import {useState, useMemo, useCallback} from 'react';
import {useAuth} from '../stores/authStore';
import {trpc} from '../lib/trpc';
import {useAppPermissions} from './useAppPermissions';
import {useOnlineStatus} from './useOnlineStatus';
import type {
  BookRecommendationItem,
  GetRecommendationsOutput,
  RecommendationCategoryFilter,
} from '../schemas/recommendation';
import type {
  TrackedBookItem,
  UnreadLibraryBookItem,
} from '../server/services/readingTracker';

export interface UseBookRecommendationsOptions {
  enabled?: boolean;
  books?: TrackedBookItem[];
  unreadLibraryBooks?: UnreadLibraryBookItem[];
  limit?: number;
}

const EMPTY_TASTE_SUMMARY: GetRecommendationsOutput['tasteSummary'] = {
  topGenres: [],
  topAuthors: [],
  activeSeries: [],
  finishedCount: 0,
  unreadShelfCount: 0,
};

function buildLocalFallbackRecommendations(
  books: TrackedBookItem[],
  unreadLibraryBooks: UnreadLibraryBookItem[],
  refreshSeed: number,
): BookRecommendationItem[] {
  const excludedIds = new Set<string>();
  const excludedTitles = new Set<string>();
  const topGenres = new Set<string>();
  const topAuthors = new Set<string>();

  for (const item of books) {
    if (
      item.readingStatus === 'reading' ||
      item.readingStatus === 'finished' ||
      item.readingStatus === 'abandoned'
    ) {
      excludedIds.add(`${item.libraryId}::${item.id}`);
      excludedTitles.add(item.title.toLowerCase().trim());
    }
    if (item.readingStatus === 'finished' || item.readingStatus === 'reading') {
      if (item.primaryGenre) {
        topGenres.add(item.primaryGenre.toLowerCase());
      }
      if ((item.userRating ?? 4) >= 4 && item.author) {
        topAuthors.add(item.author.toLowerCase().trim());
      }
    }
  }

  const candidates: Array<{item: BookRecommendationItem; score: number}> = [];
  const seen = new Set<string>();

  for (let i = 0; i < unreadLibraryBooks.length; i++) {
    const unread = unreadLibraryBooks[i];
    const idKey = `${unread.libraryId}::${unread.id}`;
    const tKey = unread.title.toLowerCase().trim();
    if (
      !tKey ||
      excludedIds.has(idKey) ||
      excludedTitles.has(tKey) ||
      seen.has(tKey)
    ) {
      continue;
    }
    seen.add(tKey);

    const isFavAuthor =
      unread.author && topAuthors.has(unread.author.toLowerCase().trim());
    const isFavGenre =
      unread.primaryGenre && topGenres.has(unread.primaryGenre.toLowerCase());

    let score = 10 + ((i + refreshSeed * 5) % 9);
    let matchTag = unread.libraryName
      ? `From Your Libraries · ${unread.libraryName}`
      : 'From Your Libraries';
    let reason =
      unread.synopsis && unread.synopsis.trim().length > 0
        ? unread.synopsis.trim().slice(0, 210)
        : `Waiting on the shelves of ${unread.libraryName || 'your library'}, ready for your next read.`;

    if (isFavAuthor) {
      score += 35;
      matchTag = unread.libraryName
        ? `From Your Libraries · ${unread.libraryName}`
        : 'Favorite Author · Your Shelf';
      if (!unread.synopsis) {
        reason = `Another volume by ${unread.author}, waiting unread in ${unread.libraryName || 'your library'}.`;
      }
    } else if (isFavGenre && unread.primaryGenre) {
      score += 20;
      if (!unread.synopsis) {
        reason = `Matches your interest in ${unread.primaryGenre}, waiting on the shelves of ${unread.libraryName || 'your library'}.`;
      }
    }

    candidates.push({
      score,
      item: {
        id: `shelf:${unread.libraryId}:${unread.id}`,
        title: unread.title,
        author: unread.author || 'Unknown Author',
        isbn: unread.isbn,
        coverUrl: unread.coverUrl,
        publishedDate: unread.publishedDate,
        primaryGenre: unread.primaryGenre,
        subgenres: unread.subgenres,
        synopsis: unread.synopsis,
        series: unread.series,
        source: 'shelf',
        reason,
        matchTag,
        libraryId: unread.libraryId,
        libraryName: unread.libraryName,
        bookId: unread.id,
        readingStatus:
          unread.readingStatus === 'want_to_read' ? 'want_to_read' : 'unset',
      },
    });
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(c => c.item);
}

export function useBookRecommendations(
  options?: UseBookRecommendationsOptions,
) {
  const {user} = useAuth();
  const {hasAiPlan} = useAppPermissions();
  const isOnline = useOnlineStatus();
  const [activeFilter, setActiveFilter] =
    useState<RecommendationCategoryFilter>('all');
  const [refreshSeed, setRefreshSeed] = useState(0);

  const isEnabled = (options?.enabled ?? true) && Boolean(user) && isOnline;
  const books = options?.books ?? [];
  const unreadLibraryBooks = options?.unreadLibraryBooks ?? [];
  const limit = options?.limit ?? 12;

  let queryResult:
    | {
        data?: unknown;
        isLoading?: boolean;
        isFetching?: boolean;
        error?: unknown;
        refetch?: () => Promise<unknown>;
      }
    | undefined;

  try {
    if (trpc?.readingTracker?.getRecommendations?.useQuery) {
      queryResult = trpc.readingTracker.getRecommendations.useQuery(
        {
          filter: 'all',
          limit,
          includeAi: Boolean(hasAiPlan),
          refreshSeed,
        },
        {
          enabled:
            isEnabled && (books.length > 0 || unreadLibraryBooks.length > 0),
          staleTime: 1000 * 60 * 30, // 30 minutes
          refetchOnWindowFocus: false,
        },
      );
    }
  } catch {
    queryResult = undefined;
  }

  const localFallbackItems = useMemo(
    () =>
      buildLocalFallbackRecommendations(books, unreadLibraryBooks, refreshSeed),
    [books, unreadLibraryBooks, refreshSeed],
  );

  const allItems = useMemo<BookRecommendationItem[]>(() => {
    const data = queryResult?.data as GetRecommendationsOutput | undefined;
    if (data && Array.isArray(data.items) && data.items.length > 0) {
      return data.items;
    }
    return localFallbackItems;
  }, [queryResult?.data, localFallbackItems]);

  const filteredItems = useMemo<BookRecommendationItem[]>(() => {
    if (activeFilter === 'all') {
      return allItems;
    }
    if (activeFilter === 'from_shelves') {
      return allItems.filter(item => item.source === 'shelf');
    }
    if (activeFilter === 'discover') {
      return allItems.filter(
        item => item.source === 'ai_curator' || item.source === 'catalog_graph',
      );
    }
    if (activeFilter === 'series_and_authors') {
      return allItems.filter(
        item =>
          item.source === 'catalog_graph' ||
          item.matchTag.startsWith('Next in ') ||
          item.matchTag.startsWith('Favorite Author'),
      );
    }
    return allItems;
  }, [allItems, activeFilter]);

  const tasteSummary = useMemo(() => {
    const data = queryResult?.data as GetRecommendationsOutput | undefined;
    return data?.tasteSummary ?? EMPTY_TASTE_SUMMARY;
  }, [queryResult?.data]);

  const refreshRecommendations = useCallback(() => {
    setRefreshSeed(prev => prev + 1);
  }, []);

  return {
    items: filteredItems,
    allItems,
    tasteSummary,
    activeFilter,
    setActiveFilter,
    isLoading: Boolean(queryResult?.isLoading) && allItems.length === 0,
    isRefreshing: Boolean(queryResult?.isFetching),
    error:
      queryResult?.error instanceof Error ? queryResult.error.message : null,
    refreshRecommendations,
  };
}
