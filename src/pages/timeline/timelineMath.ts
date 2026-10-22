import {Book} from '../../types';
import {formatYear, TimelineCluster} from './TimelineControls';

export interface TimelineStats {
  totalHistorical: number;
  earliestYear: number | null;
  latestYear: number | null;
  totalSpanning: number;
}

/**
 * Computes the bucket start year for a given historical year and zoom scale.
 */
export function getClusterKey(startYear: number, zoom: 1 | 5 | 20): number {
  let interval = 500;
  if (zoom === 5) {
    interval = 100;
  }
  if (zoom === 20) {
    interval = 10;
  }
  return Math.floor(startYear / interval) * interval;
}

/**
 * Partitions books into historical and non-historical sets.
 */
export function partitionHistoricalBooks(books: Book[]): {
  historicalBooks: Book[];
  nonHistoricalBooks: Book[];
} {
  const historicalBooks: Book[] = [];
  const nonHistoricalBooks: Book[] = [];

  for (const b of books) {
    if (b.temporalMetadata?.isNonHistorical === true) {
      nonHistoricalBooks.push(b);
    } else if (b.temporalMetadata && !b.temporalMetadata.isNonHistorical) {
      historicalBooks.push(b);
    }
  }

  return {historicalBooks, nonHistoricalBooks};
}

/**
 * Groups historical books into chronological river bend clusters with inferred era labels
 * and logarithmic channel widths.
 */
export function buildTimelineClusters(
  historicalBooks: Book[],
  zoomLevel: 1 | 5 | 20,
  selectedPreset: string,
): TimelineCluster[] {
  const map: Record<number, Book[]> = {};

  historicalBooks.forEach(b => {
    const year = b.temporalMetadata?.startYear;
    if (year !== undefined && year !== null) {
      if (selectedPreset === 'bce' && year > 0) {
        return;
      }

      const k = getClusterKey(year, zoomLevel);
      if (!map[k]) {
        map[k] = [];
      }
      map[k].push(b);
    }
  });

  const list: TimelineCluster[] = Object.keys(map)
    .map(Number)
    .map(key => {
      const cBooks = [...map[key]].sort(
        (a, b) =>
          (a.temporalMetadata?.startYear ?? 0) -
          (b.temporalMetadata?.startYear ?? 0),
      );

      const eraNames = cBooks
        .map(b => b.temporalMetadata?.eraName || b.temporalMetadata?.eraLabel)
        .filter(Boolean) as string[];

      let eraLabel = '';
      if (eraNames.length > 0) {
        const counts: Record<string, number> = {};
        let maxCount = 0;
        eraNames.forEach(n => {
          counts[n] = (counts[n] || 0) + 1;
          if (counts[n] > maxCount) {
            maxCount = counts[n];
            eraLabel = n;
          }
        });
      }

      if (!eraLabel) {
        const interval = zoomLevel === 1 ? 500 : zoomLevel === 5 ? 100 : 10;
        if (zoomLevel === 20) {
          eraLabel = `${formatYear(key)}s Era`;
        } else {
          eraLabel = `${formatYear(key)} – ${formatYear(key + interval - 1)}`;
        }
      }

      const startYears = cBooks.map(b => b.temporalMetadata?.startYear ?? key);
      const endYears = cBooks.map(
        b =>
          b.temporalMetadata?.endYear ?? b.temporalMetadata?.startYear ?? key,
      );
      const minYear = Math.min(...startYears);
      const maxYear = Math.max(...endYears);

      const channelWidth = Math.min(
        96,
        Math.max(36, Math.round(32 + Math.log2(cBooks.length + 1) * 18)),
      );

      const spanningBooks = cBooks.filter(b => {
        const s = b.temporalMetadata?.startYear;
        const e = b.temporalMetadata?.endYear;
        return s !== undefined && e !== undefined && e - s >= 15;
      });

      return {
        key,
        label: eraLabel,
        books: cBooks,
        minYear,
        maxYear,
        channelWidth,
        spanningBooks,
      };
    });

  return list.sort((a, b) => a.key - b.key);
}

/**
 * Computes summary hydrographic statistics across all active chronological clusters.
 */
export function computeTimelineStats(
  clusters: TimelineCluster[],
): TimelineStats {
  if (clusters.length === 0) {
    return {
      totalHistorical: 0,
      earliestYear: null,
      latestYear: null,
      totalSpanning: 0,
    };
  }
  const earliestYear = Math.min(...clusters.map(c => c.minYear));
  const latestYear = Math.max(...clusters.map(c => c.maxYear));
  const totalHistorical = clusters.reduce((acc, c) => acc + c.books.length, 0);
  const totalSpanning = clusters.reduce(
    (acc, c) => acc + c.spanningBooks.length,
    0,
  );
  return {
    totalHistorical,
    earliestYear,
    latestYear,
    totalSpanning,
  };
}
