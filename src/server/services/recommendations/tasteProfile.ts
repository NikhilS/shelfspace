import type {ReadingShelfSummary, UnreadLibraryBookItem} from '../../../types';
import type {
  TasteNegativeSignal,
  TastePositiveAnchor,
} from '../gemini/recommendations';

export interface ActiveSeriesSignal {
  seriesName: string;
  maxVolume: number;
  author: string;
  seedBookTitle: string;
}

export interface ReaderTasteProfile {
  positiveAnchors: TastePositiveAnchor[];
  negativeSignals: TasteNegativeSignal[];
  topGenres: string[];
  topSubgenres: string[];
  topAuthors: string[];
  activeSeries: ActiveSeriesSignal[];
  excludedTitleKeys: Set<string>;
  excludedTitleAuthorKeys: Set<string>;
  excludedIsbns: Set<string>;
  excludedTitlesDisplay: string[];
  finishedCount: number;
}

export function normalizeRecommendationText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeRecommendationIsbn(value?: string | null): string {
  return (value || '').replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function parseSeriesVolume(rawSeries?: string | null): {
  seriesName: string;
  volumeNumber: number | null;
} | null {
  if (!rawSeries || !rawSeries.trim()) {
    return null;
  }
  const trimmed = rawSeries.trim();
  const hashMatch = trimmed.match(/^(.+?)\s*(?:#|Book\s+|Vol\.?\s*)(\d+)$/i);
  if (hashMatch) {
    const seriesName = hashMatch[1].replace(/[,-]+$/, '').trim();
    const volumeNumber = Number.parseInt(hashMatch[2], 10);
    if (seriesName) {
      return {
        seriesName,
        volumeNumber: Number.isFinite(volumeNumber) ? volumeNumber : null,
      };
    }
  }
  return {
    seriesName: trimmed,
    volumeNumber: null,
  };
}

export function isCandidateExcluded(
  title: string | undefined,
  author: string | undefined,
  isbn: string | undefined,
  profile: ReaderTasteProfile,
): boolean {
  const tKey = normalizeRecommendationText(title);
  if (!tKey) {
    return true;
  }
  if (profile.excludedTitleKeys.has(tKey)) {
    return true;
  }
  const aKey = normalizeRecommendationText(author);
  if (aKey && profile.excludedTitleAuthorKeys.has(`${tKey}::${aKey}`)) {
    return true;
  }
  const cleanIsbn = normalizeRecommendationIsbn(isbn);
  if (cleanIsbn.length >= 10 && profile.excludedIsbns.has(cleanIsbn)) {
    return true;
  }
  return false;
}

/**
 * Synthesizes a structured ReaderTasteProfile from the user's tracked reading ledger
 * and unread library books.
 */
export function buildReaderTasteProfile(
  shelfSummary: ReadingShelfSummary,
  unreadBooks: UnreadLibraryBookItem[],
): ReaderTasteProfile {
  const positiveAnchors: TastePositiveAnchor[] = [];
  const negativeSignals: TasteNegativeSignal[] = [];
  const excludedTitleKeys = new Set<string>();
  const excludedTitleAuthorKeys = new Set<string>();
  const excludedIsbns = new Set<string>();
  const excludedTitlesDisplay: string[] = [];

  const genreWeights = new Map<string, number>();
  const subgenreWeights = new Map<string, number>();
  const authorWeights = new Map<string, {display: string; score: number}>();
  const negativeAuthors = new Set<string>();
  const seriesMap = new Map<string, ActiveSeriesSignal>();

  const registerExclusion = (
    title?: string,
    author?: string,
    isbn?: string,
  ) => {
    const tKey = normalizeRecommendationText(title);
    const aKey = normalizeRecommendationText(author);
    if (tKey) {
      excludedTitleKeys.add(tKey);
      if (title && excludedTitlesDisplay.length < 300) {
        excludedTitlesDisplay.push(title.trim());
      }
    }
    if (tKey && aKey) {
      excludedTitleAuthorKeys.add(`${tKey}::${aKey}`);
    }
    const cleanIsbn = normalizeRecommendationIsbn(isbn);
    if (cleanIsbn.length >= 10) {
      excludedIsbns.add(cleanIsbn);
    }
  };

  for (const unread of unreadBooks) {
    registerExclusion(unread.title, unread.author, unread.isbn);
  }

  let finishedCount = 0;

  const sortedItems = [...shelfSummary.items].sort((a, b) => {
    const scoreA =
      (a.readingStatus === 'finished'
        ? 10
        : a.readingStatus === 'reading'
          ? 6
          : 2) + (a.userRating ?? 3.5);
    const scoreB =
      (b.readingStatus === 'finished'
        ? 10
        : b.readingStatus === 'reading'
          ? 6
          : 2) + (b.userRating ?? 3.5);
    return scoreB - scoreA;
  });

  for (const item of sortedItems) {
    registerExclusion(item.title, item.author, item.isbn);

    if (item.readingStatus === 'finished') {
      finishedCount += 1;
    }

    const isLowRated =
      typeof item.userRating === 'number' && item.userRating <= 2;
    if (item.readingStatus === 'abandoned' || isLowRated) {
      negativeSignals.push({
        title: item.title,
        author: item.author,
        rating: item.userRating,
        primaryGenre: item.primaryGenre,
        reason: item.readingStatus === 'abandoned' ? 'abandoned' : 'low_rating',
      });
      const negAuthorKey = normalizeRecommendationText(item.author);
      if (negAuthorKey) {
        negativeAuthors.add(negAuthorKey);
      }
      continue;
    }

    if (
      item.readingStatus === 'finished' ||
      item.readingStatus === 'reading' ||
      item.readingStatus === 'want_to_read'
    ) {
      positiveAnchors.push({
        title: item.title,
        author: item.author,
        rating: item.userRating,
        primaryGenre: item.primaryGenre,
        subgenres: item.subgenres,
        series: item.series,
        status: item.readingStatus,
      });

      const weight =
        item.readingStatus === 'finished'
          ? item.userRating === 5
            ? 5
            : item.userRating === 4
              ? 4
              : 3
          : item.readingStatus === 'reading'
            ? 2.5
            : 1;

      if (item.primaryGenre && item.primaryGenre !== 'Other') {
        genreWeights.set(
          item.primaryGenre,
          (genreWeights.get(item.primaryGenre) ?? 0) + weight,
        );
      }

      if (Array.isArray(item.subgenres)) {
        for (const sub of item.subgenres) {
          if (sub && sub.trim()) {
            subgenreWeights.set(
              sub.trim(),
              (subgenreWeights.get(sub.trim()) ?? 0) + weight,
            );
          }
        }
      }

      const authorNorm = normalizeRecommendationText(item.author);
      if (
        authorNorm &&
        authorNorm !== 'unknown author' &&
        (item.readingStatus === 'finished' || item.readingStatus === 'reading')
      ) {
        const existing = authorWeights.get(authorNorm);
        authorWeights.set(authorNorm, {
          display: existing?.display || item.author.trim(),
          score: (existing?.score ?? 0) + weight,
        });
      }

      if (
        item.series &&
        (item.readingStatus === 'finished' || item.readingStatus === 'reading')
      ) {
        const parsedSeries = parseSeriesVolume(item.series);
        if (parsedSeries && parsedSeries.volumeNumber !== null) {
          const sKey = normalizeRecommendationText(parsedSeries.seriesName);
          const existingSeries = seriesMap.get(sKey);
          if (
            !existingSeries ||
            parsedSeries.volumeNumber > existingSeries.maxVolume
          ) {
            seriesMap.set(sKey, {
              seriesName: parsedSeries.seriesName,
              maxVolume: parsedSeries.volumeNumber,
              author: item.author,
              seedBookTitle: item.title,
            });
          }
        }
      }
    }
  }

  const topGenres = Array.from(genreWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([genre]) => genre);

  const topSubgenres = Array.from(subgenreWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([sub]) => sub);

  const topAuthors = Array.from(authorWeights.entries())
    .filter(([key]) => !negativeAuthors.has(key))
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 5)
    .map(([, val]) => val.display);

  return {
    positiveAnchors,
    negativeSignals,
    topGenres,
    topSubgenres,
    topAuthors,
    activeSeries: Array.from(seriesMap.values()).slice(0, 4),
    excludedTitleKeys,
    excludedTitleAuthorKeys,
    excludedIsbns,
    excludedTitlesDisplay: Array.from(new Set(excludedTitlesDisplay)),
    finishedCount,
  };
}
