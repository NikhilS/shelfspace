import {describe, it, expect} from 'vitest';
import {
  getClusterKey,
  partitionHistoricalBooks,
  buildTimelineClusters,
  computeTimelineStats,
} from './timelineMath';
import {Book} from '../../types';

const makeBook = (
  id: string,
  title: string,
  temporalMetadata?: Book['temporalMetadata'],
): Book =>
  ({
    id,
    title,
    author: 'Author',
    createdAt: 1000,
    temporalMetadata,
  }) as Book;

describe('timelineMath chronological engine', () => {
  it('computes accurate bucket start years across zoom levels (1, 5, 20) for BCE and CE', () => {
    expect(getClusterKey(1925, 1)).toBe(1500);
    expect(getClusterKey(1925, 5)).toBe(1900);
    expect(getClusterKey(1925, 20)).toBe(1920);

    // Negative BCE floor bucketing
    expect(getClusterKey(-44, 1)).toBe(-500);
    expect(getClusterKey(-44, 5)).toBe(-100);
    expect(getClusterKey(-44, 20)).toBe(-50);
  });

  it('partitions historical and non-historical books while ignoring unenriched books', () => {
    const bHistorical = makeBook('h1', 'Rome', {
      isNonHistorical: false,
      startYear: -44,
    });
    const bNonHistorical = makeBook('nh1', 'Dune', {
      isNonHistorical: true,
    });
    const bUnenriched = makeBook('u1', 'Unknown');

    const {historicalBooks, nonHistoricalBooks} = partitionHistoricalBooks([
      bHistorical,
      bNonHistorical,
      bUnenriched,
    ]);

    expect(historicalBooks).toEqual([bHistorical]);
    expect(nonHistoricalBooks).toEqual([bNonHistorical]);
  });

  it('builds river bend clusters with BCE filtering, dominant era label, fallback era label, logarithmic width, and spanning books', () => {
    const books: Book[] = [
      makeBook('b1', 'Republic', {
        isNonHistorical: false,
        startYear: -380,
        endYear: -360, // 20-year span (>= 15)
        eraName: 'Classical Greece',
      }),
      makeBook('b2', 'Symposium', {
        isNonHistorical: false,
        startYear: -385,
        endYear: -385,
        eraName: 'Classical Greece',
      }),
      makeBook('b3', 'Gatsby', {
        isNonHistorical: false,
        startYear: 1922,
        endYear: 1922,
      }),
    ];

    // Preset 'bce' filters out positive years
    const bceOnly = buildTimelineClusters(books, 5, 'bce');
    expect(bceOnly).toHaveLength(1);
    expect(bceOnly[0].key).toBe(-400);
    expect(bceOnly[0].label).toBe('Classical Greece');
    expect(bceOnly[0].books.map(b => b.id)).toEqual(['b2', 'b1']);
    expect(bceOnly[0].spanningBooks.map(b => b.id)).toEqual(['b1']);
    expect(bceOnly[0].channelWidth).toBeGreaterThanOrEqual(36);
    expect(bceOnly[0].channelWidth).toBeLessThanOrEqual(96);

    // Preset 'all' at zoom 20 generates decade fallback label when eraName is absent (-390, -380, 1920)
    const allDecades = buildTimelineClusters(books, 20, 'all');
    expect(allDecades).toHaveLength(3);
    expect(allDecades[2].key).toBe(1920);
    expect(allDecades[2].label).toContain('1920');
    expect(allDecades[2].label).toContain('Era');
  });

  it('computes aggregate hydrographic statistics and handles empty clusters', () => {
    expect(computeTimelineStats([])).toEqual({
      totalHistorical: 0,
      earliestYear: null,
      latestYear: null,
      totalSpanning: 0,
    });

    const clusters = buildTimelineClusters(
      [
        makeBook('b1', 'Iliad', {
          isNonHistorical: false,
          startYear: -750,
          endYear: -730,
        }),
        makeBook('b2', '1984', {
          isNonHistorical: false,
          startYear: 1949,
          endYear: 1950,
        }),
      ],
      1,
      'all',
    );

    const stats = computeTimelineStats(clusters);
    expect(stats).toEqual({
      totalHistorical: 2,
      earliestYear: -750,
      latestYear: 1950,
      totalSpanning: 1,
    });
  });
});
