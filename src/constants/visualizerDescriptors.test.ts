import {describe, expect, it} from 'vitest';
import type {Book} from '../types';
import {
  CONSTELLATION_MIN_BOOKS,
  VISUALIZER_DESCRIPTORS,
  findVisualizerDescriptor,
  getVisualizersForScope,
} from './visualizerDescriptors';

function makeBook(overrides: Partial<Book> = {}): Book {
  return {
    id: overrides.id ?? 'book-1',
    title: overrides.title ?? 'Test Book',
    author: overrides.author ?? 'Test Author',
    format: overrides.format ?? 'physical',
    addedAt: overrides.addedAt ?? '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('visualizerDescriptors', () => {
  it('registers unique visualizer ids, route patterns, permissions, and lazy loaders', () => {
    const ids = VISUALIZER_DESCRIPTORS.map(d => d.id);
    const suffixes = VISUALIZER_DESCRIPTORS.map(d => d.routeSuffix);
    const libraryPaths = VISUALIZER_DESCRIPTORS.map(d => d.libraryRoutePath);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(suffixes).size).toBe(suffixes.length);
    expect(new Set(libraryPaths).size).toBe(libraryPaths.length);

    for (const descriptor of VISUALIZER_DESCRIPTORS) {
      expect(descriptor.libraryRoutePath).toBe(
        `/library/:id${descriptor.routeSuffix}`,
      );
      expect(descriptor.requiredPermission).toBe('viewer');
      expect(descriptor.iconName).toBeTruthy();
      expect(typeof descriptor.loadComponent).toBe('function');
      expect(typeof descriptor.evaluateReadiness).toBe('function');
    }
  });

  it('filters visualizers by scope and optional readSwipe override', () => {
    expect(getVisualizersForScope('readingRoom').map(d => d.id)).toEqual([
      'timeline',
      'worldMap',
      'constellation',
    ]);
    expect(getVisualizersForScope('library').map(d => d.id)).toEqual([
      'timeline',
      'worldMap',
      'constellation',
      'readSwipe',
    ]);
    expect(
      getVisualizersForScope('readingRoom', {showReadSwipe: true}).map(
        d => d.id,
      ),
    ).toContain('readSwipe');
  });

  it('computes progressive unlock readiness for constellation threshold', () => {
    const constellation = findVisualizerDescriptor('constellation');
    expect(constellation).toBeDefined();

    const underThreshold = constellation!.computeReadiness([
      makeBook({id: '1', primaryGenre: 'Fiction'}),
      makeBook({id: '2', primaryGenre: 'History'}),
    ]);
    expect(underThreshold.isReady).toBe(false);
    expect(underThreshold.badgeLabel).toBe('2 Genres');
    expect(underThreshold.subtitleText).toContain(
      `Needs ${CONSTELLATION_MIN_BOOKS}+ books (2/${CONSTELLATION_MIN_BOOKS})`,
    );

    const unlocked = constellation!.computeReadiness([
      makeBook({id: '1', primaryGenre: 'Fiction'}),
      makeBook({id: '2', primaryGenre: 'History'}),
      makeBook({id: '3', primaryGenre: 'Science'}),
    ]);
    expect(unlocked.isReady).toBe(true);
    expect(unlocked.badgeLabel).toBe('3 Genres');
    expect(unlocked.subtitleText).toBe('Connected clusters by genre & theme');
  });

  it('computes timeline, worldMap, and readSwipe badges accurately', () => {
    const books: Book[] = [
      makeBook({
        id: '1',
        publishedDate: '1984',
        readingStatus: 'unset',
        geoMetadata: {
          isNonEarth: false,
          locations: [
            {
              name: 'London',
              adminLevel: 'city',
              rationale: 'Primary setting',
              coordinates: {lat: 51.5074, lng: -0.1278},
            },
          ],
        },
      }),
      makeBook({
        id: '2',
        readingStatus: 'finished',
      }),
    ];

    expect(
      findVisualizerDescriptor('timeline')!.computeReadiness(books).badgeLabel,
    ).toBe('1 Charted');
    expect(
      findVisualizerDescriptor('worldMap')!.computeReadiness(books).badgeLabel,
    ).toBe('1 Places');
    expect(
      findVisualizerDescriptor('readSwipe')!.computeReadiness(books).badgeLabel,
    ).toBe('1 Unread');
  });
});
