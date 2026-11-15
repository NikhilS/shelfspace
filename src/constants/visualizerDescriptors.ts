import type React from 'react';
import {partitionUnreadSwipeBooks} from '../pages/read-swipe/readSwipeMath';
import type {Book} from '../types';

export const CONSTELLATION_MIN_BOOKS = 3;

export type VisualizerId =
  'timeline' | 'worldMap' | 'constellation' | 'readSwipe';

export type VisualizerScope = 'library' | 'readingRoom';

export type VisualizerIconName = 'clock' | 'globe' | 'sparkles' | 'layers';

export type VisualizerPermissionLevel = 'viewer' | 'editor';

export type VisualizerComponentLoader = () => Promise<{
  default: React.ComponentType;
}>;

export interface VisualizerReadiness {
  isReady: boolean;
  badgeLabel: string;
  subtitleText: string;
  chartedCount: number;
  minBooksRequired: number;
}

export interface VisualizerDescriptor {
  id: VisualizerId;
  title: string;
  ctaLabel: string;
  defaultSubtitle: string;
  iconName: VisualizerIconName;
  routeSuffix: string;
  libraryRoutePath: string;
  readingRoutePath?: string;
  requiredPermission: VisualizerPermissionLevel;
  preloadKey: VisualizerId;
  scopes: readonly VisualizerScope[];
  minBooksRequired: number;
  tabularBadge?: boolean;
  tabularSubtitle?: boolean;
  loadComponent: VisualizerComponentLoader;
  evaluateReadiness: (books: Book[]) => VisualizerReadiness;
  computeReadiness: (books: Book[]) => VisualizerReadiness;
}

export function countTemporalBooks(books: Book[]): number {
  let count = 0;
  for (const book of books) {
    if (
      book.temporalMetadata?.startYear !== undefined ||
      Boolean(book.publishedDate && book.publishedDate.length >= 4)
    ) {
      count += 1;
    }
  }
  return count;
}

export function countGeoLocations(books: Book[]): number {
  let count = 0;
  for (const book of books) {
    if (book.geoMetadata?.locations?.length) {
      count += book.geoMetadata.locations.length;
    }
  }
  return count;
}

export function countUniqueGenres(books: Book[]): number {
  const genres = new Set<string>();
  for (const book of books) {
    if (book.primaryGenre) {
      genres.add(book.primaryGenre);
    }
  }
  return genres.size;
}

function evaluateTimelineReadiness(books: Book[]): VisualizerReadiness {
  const chartedCount = countTemporalBooks(books);
  return {
    isReady: books.length >= 1,
    badgeLabel: chartedCount > 0 ? `${chartedCount} Charted` : 'Chronology',
    subtitleText: 'Historical eras & publication years',
    chartedCount,
    minBooksRequired: 1,
  };
}

function evaluateWorldMapReadiness(books: Book[]): VisualizerReadiness {
  const chartedCount = countGeoLocations(books);
  return {
    isReady: books.length >= 1,
    badgeLabel: chartedCount > 0 ? `${chartedCount} Places` : 'Cartography',
    subtitleText: 'Story settings & real-world places',
    chartedCount,
    minBooksRequired: 1,
  };
}

function evaluateConstellationReadiness(books: Book[]): VisualizerReadiness {
  const chartedCount = countUniqueGenres(books);
  const isReady = books.length >= CONSTELLATION_MIN_BOOKS;
  return {
    isReady,
    badgeLabel: chartedCount > 0 ? `${chartedCount} Genres` : '3D Galaxy',
    subtitleText: isReady
      ? 'Connected clusters by genre & theme'
      : `Needs ${CONSTELLATION_MIN_BOOKS}+ books (${books.length}/${CONSTELLATION_MIN_BOOKS}) · Connected clusters by genre & theme`,
    chartedCount,
    minBooksRequired: CONSTELLATION_MIN_BOOKS,
  };
}

function evaluateReadSwipeReadiness(books: Book[]): VisualizerReadiness {
  const {readyBooks, recentlyCheckedBooks} = partitionUnreadSwipeBooks(books);
  const badgeLabel =
    readyBooks.length > 0
      ? `${readyBooks.length} Unread`
      : recentlyCheckedBooks.length > 0
        ? 'Checked Recently'
        : 'All Sorted';
  return {
    isReady: readyBooks.length > 0,
    badgeLabel,
    subtitleText: 'Swipe through unread books at random',
    chartedCount: readyBooks.length,
    minBooksRequired: 1,
  };
}

export const VISUALIZER_DESCRIPTORS: readonly VisualizerDescriptor[] = [
  {
    id: 'timeline',
    title: 'Historical Timeline',
    ctaLabel: 'Open Timeline',
    defaultSubtitle: 'Historical eras & publication years',
    iconName: 'clock',
    routeSuffix: '/timeline',
    libraryRoutePath: '/library/:id/timeline',
    readingRoutePath: '/reading/timeline',
    requiredPermission: 'viewer',
    preloadKey: 'timeline',
    scopes: ['library', 'readingRoom'],
    minBooksRequired: 1,
    loadComponent: () =>
      import('../pages/TimelineView').then(m => ({default: m.TimelineView})),
    evaluateReadiness: evaluateTimelineReadiness,
    computeReadiness: evaluateTimelineReadiness,
  },
  {
    id: 'worldMap',
    title: 'Literary World Map',
    ctaLabel: 'Open World Map',
    defaultSubtitle: 'Story settings & real-world places',
    iconName: 'globe',
    routeSuffix: '/map',
    libraryRoutePath: '/library/:id/map',
    readingRoutePath: '/reading/map',
    requiredPermission: 'viewer',
    preloadKey: 'worldMap',
    scopes: ['library', 'readingRoom'],
    minBooksRequired: 1,
    loadComponent: () =>
      import('../pages/WorldMap').then(m => ({default: m.WorldMap})),
    evaluateReadiness: evaluateWorldMapReadiness,
    computeReadiness: evaluateWorldMapReadiness,
  },
  {
    id: 'constellation',
    title: 'Thematic Constellations',
    ctaLabel: 'Open Constellations',
    defaultSubtitle: 'Connected clusters by genre & theme',
    iconName: 'sparkles',
    routeSuffix: '/constellation',
    libraryRoutePath: '/library/:id/constellation',
    readingRoutePath: '/reading/constellation',
    requiredPermission: 'viewer',
    preloadKey: 'constellation',
    scopes: ['library', 'readingRoom'],
    minBooksRequired: CONSTELLATION_MIN_BOOKS,
    tabularSubtitle: true,
    loadComponent: () =>
      import('../pages/ConstellationMap').then(m => ({
        default: m.ConstellationMap,
      })),
    evaluateReadiness: evaluateConstellationReadiness,
    computeReadiness: evaluateConstellationReadiness,
  },
  {
    id: 'readSwipe',
    title: 'Have You Read It?',
    ctaLabel: 'Start Swiping',
    defaultSubtitle: 'Swipe through unread books at random',
    iconName: 'layers',
    routeSuffix: '/swipe',
    libraryRoutePath: '/library/:id/swipe',
    requiredPermission: 'viewer',
    preloadKey: 'readSwipe',
    scopes: ['library'],
    minBooksRequired: 1,
    tabularBadge: true,
    loadComponent: () =>
      import('../pages/ReadSwipeView').then(m => ({default: m.ReadSwipeView})),
    evaluateReadiness: evaluateReadSwipeReadiness,
    computeReadiness: evaluateReadSwipeReadiness,
  },
];

const DESCRIPTOR_MAP = new Map<VisualizerId, VisualizerDescriptor>(
  VISUALIZER_DESCRIPTORS.map(descriptor => [descriptor.id, descriptor]),
);

export function findVisualizerDescriptor(
  id: VisualizerId,
): VisualizerDescriptor | undefined {
  return DESCRIPTOR_MAP.get(id);
}

export function getVisualizersForScope(
  scope: VisualizerScope,
  options?: {showReadSwipe?: boolean},
): VisualizerDescriptor[] {
  return VISUALIZER_DESCRIPTORS.filter(descriptor => {
    if (descriptor.id === 'readSwipe' && options?.showReadSwipe !== undefined) {
      return options.showReadSwipe;
    }
    return descriptor.scopes.includes(scope);
  });
}
