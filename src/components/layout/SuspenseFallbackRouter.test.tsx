import React from 'react';
import {describe, it, expect, beforeEach} from 'vitest';
import {render, screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {
  SuspenseFallbackRouter,
  resetSuspenseNavigationHistory,
  markLibraryVisited,
  parseRouteForFallback,
} from './SuspenseFallbackRouter';
import {Library} from '../../types';

const mockLibrary: Library = {
  id: 'lib-archival-1',
  name: 'botanical manuscripts',
  ownerId: 'user-1',
  ownerName: 'Ada Lovelace',
  ownerEmail: 'ada@example.com',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  bookCount: 42,
};

function renderWithRouterAndQuery(
  initialEntry: string,
  queryClient: QueryClient,
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <SuspenseFallbackRouter />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SuspenseFallbackRouter', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    resetSuspenseNavigationHistory();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {retry: false},
      },
    });
  });

  describe('parseRouteForFallback', () => {
    it('maps library overview, collection, and specialized sub-views accurately', () => {
      expect(parseRouteForFallback('/library/lib-1')).toEqual({
        routeCategory: 'library',
        libraryId: 'lib-1',
        viewType: 'overview',
        tab: 'overview',
      });

      expect(
        parseRouteForFallback('/library/lib-1', '?tab=collection'),
      ).toEqual({
        routeCategory: 'library',
        libraryId: 'lib-1',
        viewType: 'collection',
        tab: 'collection',
      });

      expect(parseRouteForFallback('/library/lib-1/constellation')).toEqual({
        routeCategory: 'library',
        libraryId: 'lib-1',
        viewType: 'constellation',
      });

      expect(parseRouteForFallback('/library/lib-1/map')).toEqual({
        routeCategory: 'library',
        libraryId: 'lib-1',
        viewType: 'world-map',
      });

      expect(parseRouteForFallback('/library/lib-1/timeline')).toEqual({
        routeCategory: 'library',
        libraryId: 'lib-1',
        viewType: 'timeline',
      });

      expect(parseRouteForFallback('/library/lib-1/book/book-99')).toEqual({
        routeCategory: 'library',
        libraryId: 'lib-1',
        viewType: 'book-details',
      });

      expect(parseRouteForFallback('/library/lib-1/spruce-up')).toEqual({
        routeCategory: 'library',
        libraryId: 'lib-1',
        viewType: 'spruce-up',
      });
    });
  });

  describe('Cold vs. Warm Library Navigation', () => {
    it('renders cold full-page skeleton (including header skeleton) when library is loaded for the first time', () => {
      renderWithRouterAndQuery('/library/lib-archival-1', queryClient);

      expect(screen.getByTestId('library-main-skeleton')).toHaveAttribute(
        'data-warm',
        'false',
      );
      expect(screen.getByTestId('library-header-skeleton')).toBeInTheDocument();
      expect(screen.getByTestId('library-tabs-skeleton')).toBeInTheDocument();
      expect(
        screen.getByTestId('library-overview-skeleton'),
      ).toBeInTheDocument();
    });

    it('keeps real LibraryHeader and skeletonizes only content area when library metadata is cached in TanStack Query', () => {
      queryClient.setQueryData(
        [['library', 'get'], {input: {libraryId: 'lib-archival-1'}}],
        mockLibrary,
      );

      renderWithRouterAndQuery(
        '/library/lib-archival-1?tab=collection',
        queryClient,
      );

      expect(screen.getByTestId('library-main-skeleton')).toHaveAttribute(
        'data-warm',
        'true',
      );
      // Real header title should be rendered instead of pulsing header skeleton
      expect(screen.getByText('Botanical Manuscripts')).toBeInTheDocument();
      expect(
        screen.queryByTestId('library-header-skeleton'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('warm-library-tabs-bar')).toBeInTheDocument();
      expect(
        screen.getByTestId('library-collection-skeleton'),
      ).toBeInTheDocument();
    });

    it('renders dedicated SpatialMapSkeleton with real LibraryHeader when navigating to Constellation on a warm library', () => {
      queryClient.setQueryData(
        [['library', 'list'], {input: {scopes: ['owned', 'shared']}}],
        {libraries: [mockLibrary]},
      );
      markLibraryVisited('lib-archival-1');

      renderWithRouterAndQuery(
        '/library/lib-archival-1/constellation',
        queryClient,
      );

      expect(
        screen.getByTestId('spatial-map-skeleton-constellation'),
      ).toBeInTheDocument();
      expect(screen.getByText('Constellation View')).toBeInTheDocument();
      expect(
        screen.getAllByText('Botanical Manuscripts').length,
      ).toBeGreaterThanOrEqual(1);
      expect(
        screen.queryByTestId('library-header-skeleton'),
      ).not.toBeInTheDocument();
    });

    it('renders dedicated TimelineViewSkeleton, BookDetailsSkeleton, and WorkbenchFormSkeleton for specialized routes', () => {
      queryClient.setQueryData(
        [['library', 'get'], {input: {libraryId: 'lib-archival-1'}}],
        mockLibrary,
      );

      const {unmount: unmountTimeline} = renderWithRouterAndQuery(
        '/library/lib-archival-1/timeline',
        queryClient,
      );
      expect(screen.getByTestId('timeline-view-skeleton')).toBeInTheDocument();
      expect(screen.getByText('Chronological Timeline')).toBeInTheDocument();
      unmountTimeline();

      const {unmount: unmountBook} = renderWithRouterAndQuery(
        '/library/lib-archival-1/book/book-123',
        queryClient,
      );
      expect(screen.getByTestId('book-details-skeleton')).toBeInTheDocument();
      expect(screen.getByText('Botanical Manuscripts')).toBeInTheDocument();
      unmountBook();

      renderWithRouterAndQuery(
        '/library/lib-archival-1/spruce-up',
        queryClient,
      );
      expect(
        screen.getByTestId('workbench-form-skeleton-spruce-up'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Shelf Care & Metadata Audit'),
      ).toBeInTheDocument();
    });

    it('renders dedicated skeletons for /reading/* sub-routes', () => {
      renderWithRouterAndQuery('/reading/map', queryClient);
      expect(
        screen.getByTestId('spatial-map-skeleton-world-map'),
      ).toBeInTheDocument();
      expect(screen.getByText('Literary World Map')).toBeInTheDocument();
    });

    it('renders DashboardMainSkeleton on root route', () => {
      renderWithRouterAndQuery('/', queryClient);
      expect(screen.getByTestId('dashboard-main-skeleton')).toBeInTheDocument();
    });
  });
});
