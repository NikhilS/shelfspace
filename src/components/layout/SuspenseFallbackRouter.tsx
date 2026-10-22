import React, {useEffect} from 'react';
import {useLocation} from 'react-router-dom';
import {useQueryClient, QueryClient} from '@tanstack/react-query';
import {trpc} from '../../lib/trpc';
import {queryClient as defaultQueryClient} from '../../lib/queryClient';
import {useAuthStore} from '../../stores/authStore';
import {Library, Book} from '../../types';
import {PageLoading} from './PageLoading';
import {
  LibraryMainSkeleton,
  DashboardMainSkeleton,
  SpatialMapSkeleton,
  TimelineViewSkeleton,
  BookDetailsSkeleton,
  WorkbenchFormSkeleton,
  LibrarySkeletonViewType,
} from '../book/LibrarySkeletons';

// Session-scoped history tracking for visited libraries, reading shelf, and paths
const visitedLibraryIds = new Set<string>();
const visitedRoutePaths = new Set<string>();
let hasVisitedReadingShelf = false;

export function markLibraryVisited(libraryId: string): void {
  if (libraryId) {
    visitedLibraryIds.add(libraryId);
  }
}

export function isLibraryVisited(libraryId: string): boolean {
  return visitedLibraryIds.has(libraryId);
}

export function markReadingShelfVisited(): void {
  hasVisitedReadingShelf = true;
}

export function isReadingShelfVisited(): boolean {
  return hasVisitedReadingShelf;
}

export function markRouteVisited(pathname: string): void {
  if (pathname) {
    visitedRoutePaths.add(pathname);
  }
  const libMatch = pathname.match(/^\/library\/([^/]+)/);
  if (libMatch?.[1]) {
    visitedLibraryIds.add(libMatch[1]);
  }
  if (pathname === '/' || pathname.startsWith('/reading')) {
    hasVisitedReadingShelf = true;
  }
}

export function resetSuspenseNavigationHistory(): void {
  visitedLibraryIds.clear();
  visitedRoutePaths.clear();
  hasVisitedReadingShelf = false;
}

export interface RouteFallbackDescriptor {
  routeCategory: 'dashboard' | 'library' | 'reading' | 'other';
  libraryId?: string;
  viewType?: LibrarySkeletonViewType;
  tab?: 'overview' | 'collection';
}

export function parseRouteForFallback(
  pathname: string,
  search: string = '',
): RouteFallbackDescriptor {
  if (pathname === '/') {
    return {routeCategory: 'dashboard'};
  }

  // Match /library/:id and sub-routes
  const libMatch = pathname.match(/^\/library\/([^/]+)(?:\/(.*))?$/);
  if (libMatch) {
    const libraryId = libMatch[1];
    const subPath = (libMatch[2] || '').replace(/\/+$/, '');
    const params = new URLSearchParams(search);
    const queryTab = params.get('tab');

    if (!subPath) {
      const tab = queryTab === 'collection' ? 'collection' : 'overview';
      return {
        routeCategory: 'library',
        libraryId,
        viewType: tab,
        tab,
      };
    }

    if (subPath === 'collection') {
      return {
        routeCategory: 'library',
        libraryId,
        viewType: 'collection',
        tab: 'collection',
      };
    }

    if (subPath === 'constellation') {
      return {
        routeCategory: 'library',
        libraryId,
        viewType: 'constellation',
      };
    }

    if (subPath === 'map') {
      return {
        routeCategory: 'library',
        libraryId,
        viewType: 'world-map',
      };
    }

    if (subPath === 'timeline') {
      return {
        routeCategory: 'library',
        libraryId,
        viewType: 'timeline',
      };
    }

    if (subPath === 'add') {
      return {
        routeCategory: 'library',
        libraryId,
        viewType: 'add-book',
      };
    }

    if (subPath === 'spruce-up') {
      return {
        routeCategory: 'library',
        libraryId,
        viewType: 'spruce-up',
      };
    }

    if (subPath.startsWith('book/')) {
      return {
        routeCategory: 'library',
        libraryId,
        viewType: 'book-details',
      };
    }

    return {
      routeCategory: 'library',
      libraryId,
      viewType: 'overview',
      tab: 'overview',
    };
  }

  // Match /reading/* routes
  const readingMatch = pathname.match(/^\/reading(?:\/(.*))?$/);
  if (readingMatch) {
    const subPath = (readingMatch[1] || '').replace(/\/+$/, '');
    if (subPath === 'constellation') {
      return {routeCategory: 'reading', viewType: 'constellation'};
    }
    if (subPath === 'map') {
      return {routeCategory: 'reading', viewType: 'world-map'};
    }
    if (subPath === 'timeline') {
      return {routeCategory: 'reading', viewType: 'timeline'};
    }
    if (subPath === 'add') {
      return {routeCategory: 'reading', viewType: 'add-book'};
    }
    if (subPath.startsWith('book/')) {
      return {routeCategory: 'reading', viewType: 'book-details'};
    }
    return {routeCategory: 'reading', viewType: 'overview'};
  }

  return {routeCategory: 'other'};
}

function extractCachedLibraryFromQueryClient(
  qc: QueryClient,
  libraryId: string,
  trpcUtils?: ReturnType<typeof trpc.useUtils>,
): Library | null {
  if (!libraryId) {
    return null;
  }

  // 1. Try tRPC typed cache helpers first if available
  try {
    if (trpcUtils?.library) {
      const fromGet = trpcUtils.library.get?.getData?.({
        libraryId,
      }) as Library | undefined;
      if (fromGet && fromGet.id === libraryId) {
        return fromGet;
      }

      const ownedShared = trpcUtils.library.list?.getData?.({
        scopes: ['owned', 'shared'],
      })?.libraries as Library[] | undefined;
      const foundOwned = ownedShared?.find(l => l.id === libraryId);
      if (foundOwned) {
        return foundOwned;
      }

      const allLibs = trpcUtils.library.list?.getData?.({
        scopes: ['all'],
      })?.libraries as Library[] | undefined;
      const foundAll = allLibs?.find(l => l.id === libraryId);
      if (foundAll) {
        return foundAll;
      }

      const defaultLibs = trpcUtils.library.list?.getData?.()?.libraries as
        Library[] | undefined;
      const foundDefault = defaultLibs?.find(l => l.id === libraryId);
      if (foundDefault) {
        return foundDefault;
      }
    }
  } catch {
    // Fallback to raw QueryClient cache inspection
  }

  // 2. Inspect raw QueryClient cache entries (handles both tRPC nested keys and test keys)
  const allQueries = qc.getQueriesData<unknown>({});
  for (const [, data] of allQueries) {
    if (!data || typeof data !== 'object') {
      continue;
    }
    const record = data as Record<string, unknown>;
    if (record.id === libraryId && typeof record.name === 'string') {
      return record as unknown as Library;
    }
    if (Array.isArray(record.libraries)) {
      const match = (record.libraries as Library[]).find(
        l => l && l.id === libraryId,
      );
      if (match) {
        return match;
      }
    }
  }

  return null;
}

function extractCachedBooksFromQueryClient(
  qc: QueryClient,
  libraryId: string,
  trpcUtils?: ReturnType<typeof trpc.useUtils>,
): Book[] | undefined {
  if (!libraryId) {
    return undefined;
  }

  try {
    if (trpcUtils?.book?.list?.getData) {
      const raw = trpcUtils.book.list.getData({libraryId}) as unknown;
      if (Array.isArray(raw)) {
        return raw as Book[];
      }
      if (
        raw &&
        typeof raw === 'object' &&
        'books' in raw &&
        Array.isArray((raw as {books: unknown}).books)
      ) {
        return (raw as {books: Book[]}).books;
      }
    }
  } catch {
    // Fallback to raw QueryClient inspection
  }

  const allQueries = qc.getQueriesData<unknown>({});
  for (const [queryKey, data] of allQueries) {
    const keyStr = JSON.stringify(queryKey);
    if (!keyStr.includes(libraryId) || !keyStr.includes('book')) {
      continue;
    }
    if (Array.isArray(data)) {
      return data as Book[];
    }
    if (
      data &&
      typeof data === 'object' &&
      'books' in data &&
      Array.isArray((data as {books: unknown}).books)
    ) {
      return (data as {books: Book[]}).books;
    }
  }

  return undefined;
}

function checkReadingShelfCache(qc: QueryClient): boolean {
  if (hasVisitedReadingShelf) {
    return true;
  }
  const allQueries = qc.getQueriesData<unknown>({});
  for (const [queryKey, data] of allQueries) {
    if (!data) {
      continue;
    }
    const keyStr = JSON.stringify(queryKey);
    if (
      keyStr.includes('readingTracker') ||
      keyStr.includes('getShelf') ||
      keyStr.includes('library')
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Hook that records warm route/library visits after a view has mounted.
 */
export function useTrackNavigationWarmth(): void {
  const location = useLocation();
  useEffect(() => {
    markRouteVisited(location.pathname);
  }, [location.pathname]);
}

export interface SuspenseFallbackRouterProps {
  pathnameOverride?: string;
  searchOverride?: string;
}

/**
 * Centralized Suspense skeleton fallback strategy.
 * Differentiates between cold first-time data loads and warm navigations
 * between existing library or reading-shelf views.
 */
export function SuspenseFallbackRouter({
  pathnameOverride,
  searchOverride,
}: SuspenseFallbackRouterProps = {}) {
  const location = useLocation();
  const pathname = pathnameOverride ?? location.pathname;
  const search = searchOverride ?? location.search;
  const {user} = useAuthStore();

  let activeQueryClient: QueryClient = defaultQueryClient;
  try {
    activeQueryClient = useQueryClient();
  } catch {
    activeQueryClient = defaultQueryClient;
  }

  let trpcUtils: ReturnType<typeof trpc.useUtils> | undefined;
  try {
    if (typeof trpc !== 'undefined' && typeof trpc.useUtils === 'function') {
      trpcUtils = trpc.useUtils();
    }
  } catch {
    trpcUtils = undefined;
  }

  const descriptor = parseRouteForFallback(pathname, search);

  if (descriptor.routeCategory === 'dashboard') {
    return <DashboardMainSkeleton />;
  }

  if (descriptor.routeCategory === 'library' && descriptor.libraryId) {
    const {libraryId, viewType = 'overview', tab = 'overview'} = descriptor;
    const cachedLibrary = extractCachedLibraryFromQueryClient(
      activeQueryClient,
      libraryId,
      trpcUtils,
    );
    const cachedBooks = extractCachedBooksFromQueryClient(
      activeQueryClient,
      libraryId,
      trpcUtils,
    );
    const isWarm = Boolean(
      cachedLibrary ||
      (cachedBooks && cachedBooks.length > 0) ||
      isLibraryVisited(libraryId),
    );

    return (
      <LibraryMainSkeleton
        tab={tab}
        viewType={viewType}
        isWarm={isWarm}
        cachedLibrary={cachedLibrary}
        cachedBooks={cachedBooks || []}
        currentUserId={user?.uid}
      />
    );
  }

  if (descriptor.routeCategory === 'reading') {
    const isWarm = checkReadingShelfCache(activeQueryClient);
    const viewType = descriptor.viewType || 'overview';

    if (viewType === 'constellation' || viewType === 'world-map') {
      return (
        <SpatialMapSkeleton
          variant={viewType}
          isWarm={isWarm}
          isReadingShelf={true}
        />
      );
    }

    if (viewType === 'timeline') {
      return <TimelineViewSkeleton isWarm={isWarm} isReadingShelf={true} />;
    }

    if (viewType === 'book-details') {
      return <BookDetailsSkeleton isWarm={isWarm} isReadingShelf={true} />;
    }

    if (viewType === 'add-book') {
      return (
        <WorkbenchFormSkeleton
          variant="add-book"
          isWarm={isWarm}
          isReadingShelf={true}
        />
      );
    }
  }

  return (
    <div
      data-testid="generic-module-loading"
      className="flex-1 flex flex-col items-center justify-center min-h-[50vh]"
    >
      <PageLoading
        title="Loading module..."
        subtitle="Downloading application assets and views."
      />
    </div>
  );
}
