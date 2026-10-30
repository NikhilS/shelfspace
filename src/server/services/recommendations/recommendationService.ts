import {catalogOrchestrator} from '../catalog';
import {
  ReadingTrackerService,
  type ReadingShelfSummary,
  type TrackedBookItem,
  type UnreadLibraryBookItem,
} from '../readingTracker';
import {
  generateStructuredTasteRecommendations,
  type TastePositiveAnchor,
  type TasteNegativeSignal,
} from '../gemini/recommendations';
import {
  getRecommendationsOutputSchema,
  type BookRecommendationItem,
  type GetRecommendationsOutput,
  type RecommendationCategoryFilter,
} from '../../../schemas/recommendation';
import type {BookDetails} from '../../../types';

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

function normalizeText(value?: string | null): string {
  return (value || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizeIsbn(value?: string | null): string {
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
    const tKey = normalizeText(title);
    const aKey = normalizeText(author);
    if (tKey) {
      excludedTitleKeys.add(tKey);
      if (title && excludedTitlesDisplay.length < 300) {
        excludedTitlesDisplay.push(title.trim());
      }
    }
    if (tKey && aKey) {
      excludedTitleAuthorKeys.add(`${tKey}::${aKey}`);
    }
    const cleanIsbn = normalizeIsbn(isbn);
    if (cleanIsbn.length >= 10) {
      excludedIsbns.add(cleanIsbn);
    }
  };

  for (const unread of unreadBooks) {
    registerExclusion(unread.title, unread.author, unread.isbn);
  }

  let finishedCount = 0;

  // Sort items so 5-star and 4-star finished books lead positive anchors
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
      const negAuthorKey = normalizeText(item.author);
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

      const authorNorm = normalizeText(item.author);
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
          const sKey = normalizeText(parsedSeries.seriesName);
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

/**
 * Pillar 1: Scores and ranks unread books already in the user's accessible libraries
 * against their ReaderTasteProfile.
 */
export function scoreUnreadShelfCandidates(
  unreadBooks: UnreadLibraryBookItem[],
  shelfItems: TrackedBookItem[],
  profile: ReaderTasteProfile,
  refreshSeed = 0,
): BookRecommendationItem[] {
  const activeOrFinishedKeys = new Set<string>();
  for (const item of shelfItems) {
    if (
      item.readingStatus === 'reading' ||
      item.readingStatus === 'finished' ||
      item.readingStatus === 'abandoned'
    ) {
      activeOrFinishedKeys.add(`${item.libraryId}::${item.id}`);
      const tKey = normalizeText(item.title);
      if (tKey) {
        activeOrFinishedKeys.add(tKey);
      }
    }
  }

  const topAuthorsNorm = new Set(profile.topAuthors.map(a => normalizeText(a)));
  const topGenresSet = new Set(profile.topGenres.map(g => g.toLowerCase()));
  const topSubgenresSet = new Set(
    profile.topSubgenres.map(s => s.toLowerCase()),
  );
  const activeSeriesNorm = new Map(
    profile.activeSeries.map(s => [normalizeText(s.seriesName), s]),
  );

  const scored: Array<{item: BookRecommendationItem; score: number}> = [];
  const seenTitleKeys = new Set<string>();

  for (let i = 0; i < unreadBooks.length; i++) {
    const book = unreadBooks[i];
    const idKey = `${book.libraryId}::${book.id}`;
    const titleKey = normalizeText(book.title);
    if (
      !titleKey ||
      activeOrFinishedKeys.has(idKey) ||
      activeOrFinishedKeys.has(titleKey) ||
      seenTitleKeys.has(titleKey)
    ) {
      continue;
    }
    seenTitleKeys.add(titleKey);

    let score = 10;
    let matchTag = book.libraryName
      ? `On Your Shelf · ${book.libraryName}`
      : 'On Your Shelf';
    const reasons: string[] = [];

    const parsedSeries = parseSeriesVolume(book.series);
    if (parsedSeries) {
      const matchedSeries = activeSeriesNorm.get(
        normalizeText(parsedSeries.seriesName),
      );
      if (matchedSeries) {
        score += 50;
        matchTag = `Next in ${matchedSeries.seriesName} · ${book.libraryName || 'Your Shelf'}`;
        reasons.push(
          `Continues ${matchedSeries.seriesName} after "${matchedSeries.seedBookTitle}", already waiting in ${book.libraryName || 'your library'}.`,
        );
      }
    }

    const authorKey = normalizeText(book.author);
    if (authorKey && topAuthorsNorm.has(authorKey)) {
      score += 35;
      if (reasons.length === 0) {
        matchTag = `Favorite Author · ${book.libraryName || 'Your Shelf'}`;
        reasons.push(
          `Another work by ${book.author}, one of your highest-rated authors, sitting unread in ${book.libraryName || 'your library'}.`,
        );
      }
    }

    if (
      book.primaryGenre &&
      topGenresSet.has(book.primaryGenre.toLowerCase())
    ) {
      score += 20;
      if (reasons.length === 0) {
        reasons.push(
          `Matches your affinity for ${book.primaryGenre} and is ready to read on the shelves of ${book.libraryName || 'your library'}.`,
        );
      }
    }

    if (Array.isArray(book.subgenres)) {
      for (const sub of book.subgenres) {
        if (topSubgenresSet.has(sub.toLowerCase())) {
          score += 10;
        }
      }
    }

    // Deterministic rotation offset when user clicks Refresh
    if (refreshSeed > 0) {
      score += ((i + refreshSeed * 7) % 13) * 1.5;
    }

    const defaultSynopsis = book.synopsis?.trim();
    const fallbackReason =
      reasons[0] ||
      (defaultSynopsis
        ? defaultSynopsis.length > 200
          ? `${defaultSynopsis.slice(0, 197).trimEnd()}...`
          : defaultSynopsis
        : `Waiting unread on the shelves of ${book.libraryName || 'your library'}.`);

    scored.push({
      score,
      item: {
        id: `shelf:${book.libraryId}:${book.id}`,
        title: book.title,
        author: book.author || 'Unknown Author',
        isbn: book.isbn,
        coverUrl: book.coverUrl,
        publishedDate: book.publishedDate,
        primaryGenre: book.primaryGenre,
        subgenres: book.subgenres,
        synopsis: book.synopsis,
        series: book.series,
        source: 'shelf',
        reason: fallbackReason,
        matchTag,
        libraryId: book.libraryId,
        libraryName: book.libraryName,
        bookId: book.id,
        readingStatus:
          book.readingStatus === 'want_to_read' ? 'want_to_read' : 'unset',
      },
    });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map(entry => entry.item);
}

function isCandidateExcluded(
  title: string | undefined,
  author: string | undefined,
  isbn: string | undefined,
  profile: ReaderTasteProfile,
): boolean {
  const tKey = normalizeText(title);
  if (!tKey) {
    return true;
  }
  if (profile.excludedTitleKeys.has(tKey)) {
    return true;
  }
  const aKey = normalizeText(author);
  if (aKey && profile.excludedTitleAuthorKeys.has(`${tKey}::${aKey}`)) {
    return true;
  }
  const cleanIsbn = normalizeIsbn(isbn);
  if (cleanIsbn.length >= 10 && profile.excludedIsbns.has(cleanIsbn)) {
    return true;
  }
  return false;
}

/**
 * Pillar 2: Traverses live external catalogs via CatalogOrchestrator for:
 * - Next unread volume in active literary series
 * - Acclaimed unread works by the reader's top-rated authors
 */
export async function discoverCatalogGraphCandidates(
  profile: ReaderTasteProfile,
  refreshSeed = 0,
): Promise<BookRecommendationItem[]> {
  const results: BookRecommendationItem[] = [];
  const seenKeys = new Set<string>();

  const tasks: Array<() => Promise<void>> = [];

  // 1. Series continuations (up to 2 active series)
  for (const seriesSignal of profile.activeSeries.slice(0, 2)) {
    const nextVolume = seriesSignal.maxVolume + 1;
    tasks.push(async () => {
      try {
        const queryStr = `${seriesSignal.seriesName} ${nextVolume} ${seriesSignal.author}`;
        const response = await catalogOrchestrator.searchByQuery({
          title: `${seriesSignal.seriesName} #${nextVolume}`,
          author: seriesSignal.author,
          rawQuery: queryStr,
          limit: 4,
          priority: 'INTERACTIVE',
        });

        const books = Array.isArray(response?.books) ? response.books : [];
        for (const hit of books) {
          if (
            !hit?.title ||
            isCandidateExcluded(hit.title, hit.author, hit.isbn, profile)
          ) {
            continue;
          }
          const hitTitleKey = normalizeText(hit.title);
          if (seenKeys.has(hitTitleKey)) {
            continue;
          }
          seenKeys.add(hitTitleKey);

          results.push({
            id: `graph:series:${hitTitleKey}`,
            title: hit.title,
            author: hit.author || seriesSignal.author,
            isbn: hit.isbn,
            coverUrl: hit.coverUrl,
            publishedDate: hit.publishedDate,
            primaryGenre: hit.primaryGenre,
            subgenres: hit.subgenres,
            synopsis: hit.synopsis,
            series: hit.series || `${seriesSignal.seriesName} #${nextVolume}`,
            source: 'catalog_graph',
            matchTag: `Next in ${seriesSignal.seriesName}`,
            reason:
              hit.synopsis && hit.synopsis.trim().length > 25
                ? hit.synopsis.trim().slice(0, 220)
                : `Continue ${seriesSignal.seriesName} following "${seriesSignal.seedBookTitle}".`,
          });
          break;
        }
      } catch {
        // Non-fatal catalog lookup failure
      }
    });
  }

  // 2. Favorite author backlist (rotate authors on refreshSeed)
  const authorPool = [...profile.topAuthors];
  if (refreshSeed > 0 && authorPool.length > 1) {
    const offset = refreshSeed % authorPool.length;
    authorPool.push(...authorPool.splice(0, offset));
  }

  for (const favoriteAuthor of authorPool.slice(0, 3)) {
    tasks.push(async () => {
      try {
        const response = await catalogOrchestrator.searchByQuery({
          author: favoriteAuthor,
          rawQuery: favoriteAuthor,
          limit: 5,
          priority: 'INTERACTIVE',
        });

        const books = Array.isArray(response?.books) ? response.books : [];
        for (const hit of books) {
          if (
            !hit?.title ||
            isCandidateExcluded(hit.title, hit.author, hit.isbn, profile)
          ) {
            continue;
          }
          const hitAuthorNorm = normalizeText(hit.author);
          const targetAuthorNorm = normalizeText(favoriteAuthor);
          if (
            hitAuthorNorm &&
            targetAuthorNorm &&
            !hitAuthorNorm.includes(targetAuthorNorm) &&
            !targetAuthorNorm.includes(hitAuthorNorm)
          ) {
            continue;
          }

          const hitTitleKey = normalizeText(hit.title);
          if (seenKeys.has(hitTitleKey)) {
            continue;
          }
          seenKeys.add(hitTitleKey);

          results.push({
            id: `graph:author:${hitTitleKey}`,
            title: hit.title,
            author: hit.author || favoriteAuthor,
            isbn: hit.isbn,
            coverUrl: hit.coverUrl,
            publishedDate: hit.publishedDate,
            primaryGenre: hit.primaryGenre,
            subgenres: hit.subgenres,
            synopsis: hit.synopsis,
            series: hit.series,
            source: 'catalog_graph',
            matchTag: `More by ${favoriteAuthor}`,
            reason:
              hit.synopsis && hit.synopsis.trim().length > 25
                ? hit.synopsis.trim().slice(0, 220)
                : `An acclaimed work by ${favoriteAuthor}, one of the highest-rated authors in your reading room.`,
          });
          break;
        }
      } catch {
        // Non-fatal catalog lookup failure
      }
    });
  }

  await Promise.allSettled(tasks.map(fn => fn()));
  return results;
}

/**
 * Pillar 3: Calls Gemini for taste-matched literary candidates and grounds each candidate
 * through CatalogOrchestrator so every recommendation has real metadata and cover art.
 */
export async function discoverAiCuratorCandidates(
  profile: ReaderTasteProfile,
  options?: {limit?: number; refreshSeed?: number},
): Promise<BookRecommendationItem[]> {
  if (profile.positiveAnchors.length === 0) {
    return [];
  }

  const rawCandidates = await generateStructuredTasteRecommendations({
    positiveAnchors: profile.positiveAnchors,
    negativeSignals: profile.negativeSignals,
    excludedTitles: profile.excludedTitlesDisplay,
    topGenres: profile.topGenres,
    limit: options?.limit ?? 6,
    refreshSeed: options?.refreshSeed ?? 0,
  });

  if (!Array.isArray(rawCandidates) || rawCandidates.length === 0) {
    return [];
  }

  const unexcluded = rawCandidates.filter(
    c => !isCandidateExcluded(c.title, c.author, undefined, profile),
  );

  const groundedResults: BookRecommendationItem[] = [];
  const seenKeys = new Set<string>();

  await Promise.allSettled(
    unexcluded.slice(0, 6).map(async candidate => {
      const candidateKey = normalizeText(candidate.title);
      if (!candidateKey || seenKeys.has(candidateKey)) {
        return;
      }

      let catalogMatch: BookDetails | null = null;
      try {
        catalogMatch = await catalogOrchestrator.searchByTitleAndAuthor(
          candidate.title,
          candidate.author,
          undefined,
          {priority: 'INTERACTIVE'},
        );
      } catch {
        catalogMatch = null;
      }

      if (!catalogMatch) {
        try {
          const fallbackSearch = await catalogOrchestrator.searchByQuery({
            title: candidate.title,
            author: candidate.author,
            rawQuery: `${candidate.title} ${candidate.author}`,
            limit: 2,
            priority: 'INTERACTIVE',
          });
          const hits = Array.isArray(fallbackSearch?.books)
            ? fallbackSearch.books
            : [];
          catalogMatch = hits[0] ?? null;
        } catch {
          catalogMatch = null;
        }
      }

      // Require catalog verification so hallucinated titles never surface
      if (!catalogMatch || !catalogMatch.title) {
        return;
      }

      if (
        isCandidateExcluded(
          catalogMatch.title,
          catalogMatch.author || candidate.author,
          catalogMatch.isbn,
          profile,
        )
      ) {
        return;
      }

      const resolvedKey = normalizeText(catalogMatch.title);
      if (!resolvedKey || seenKeys.has(resolvedKey)) {
        return;
      }
      seenKeys.add(resolvedKey);

      groundedResults.push({
        id: `ai:${resolvedKey}`,
        title: catalogMatch.title || candidate.title,
        author: catalogMatch.author || candidate.author,
        isbn: catalogMatch.isbn,
        coverUrl: catalogMatch.coverUrl,
        publishedDate: catalogMatch.publishedDate,
        primaryGenre: catalogMatch.primaryGenre,
        subgenres: catalogMatch.subgenres,
        synopsis: catalogMatch.synopsis || candidate.reason,
        series: catalogMatch.series,
        source: 'ai_curator',
        reason: candidate.reason,
        matchTag: candidate.matchTag || 'Curated for Your Taste',
      });
    }),
  );

  return groundedResults;
}

/**
 * Interleaves recommendations across AI Curator, Unread Shelf Picks, and Catalog Graph
 * while deduplicating by normalized title and ISBN.
 */
export function mergeAndFilterRecommendations(
  aiItems: BookRecommendationItem[],
  shelfItems: BookRecommendationItem[],
  graphItems: BookRecommendationItem[],
  filter: RecommendationCategoryFilter = 'all',
  limit = 12,
): BookRecommendationItem[] {
  const seenTitles = new Set<string>();
  const seenIsbns = new Set<string>();
  const finalItems: BookRecommendationItem[] = [];

  const tryPush = (item: BookRecommendationItem | undefined) => {
    if (!item || finalItems.length >= limit) {
      return;
    }
    const tKey = normalizeText(item.title);
    const cleanIsbn = normalizeIsbn(item.isbn);
    if (!tKey || seenTitles.has(tKey)) {
      return;
    }
    if (cleanIsbn.length >= 10 && seenIsbns.has(cleanIsbn)) {
      return;
    }
    seenTitles.add(tKey);
    if (cleanIsbn.length >= 10) {
      seenIsbns.add(cleanIsbn);
    }
    finalItems.push(item);
  };

  if (filter === 'from_shelves') {
    for (const item of shelfItems) {
      tryPush(item);
    }
    return finalItems;
  }

  if (filter === 'series_and_authors') {
    for (const item of graphItems) {
      tryPush(item);
    }
    for (const item of shelfItems) {
      if (
        item.matchTag.startsWith('Next in ') ||
        item.matchTag.startsWith('Favorite Author')
      ) {
        tryPush(item);
      }
    }
    return finalItems;
  }

  if (filter === 'discover') {
    const maxLen = Math.max(aiItems.length, graphItems.length);
    for (let i = 0; i < maxLen; i++) {
      tryPush(aiItems[i]);
      tryPush(graphItems[i]);
    }
    return finalItems;
  }

  // Default 'all': Interleave AI curator, Unread Shelf, and Catalog Graph picks
  const maxLen = Math.max(aiItems.length, shelfItems.length, graphItems.length);
  for (let i = 0; i < maxLen; i++) {
    tryPush(aiItems[i]);
    tryPush(shelfItems[i]);
    tryPush(graphItems[i]);
  }

  return finalItems;
}

export async function getRecommendationsForUser(
  userId: string,
  userEmail: string | undefined,
  options?: {
    filter?: RecommendationCategoryFilter;
    limit?: number;
    includeAi?: boolean;
    refreshSeed?: number;
  },
): Promise<GetRecommendationsOutput> {
  const filter = options?.filter ?? 'all';
  const limit = options?.limit ?? 12;
  const includeAi = options?.includeAi ?? true;
  const refreshSeed = options?.refreshSeed ?? 0;

  const [shelfSummary, unreadBooks] = await Promise.all([
    ReadingTrackerService.getPersonalReadingShelf(userId, userEmail, {
      shelf: 'all',
    }),
    ReadingTrackerService.getUnreadLibraryBooks(userId, userEmail),
  ]);

  const profile = buildReaderTasteProfile(shelfSummary, unreadBooks);

  const shouldRunShelf =
    filter === 'all' ||
    filter === 'from_shelves' ||
    filter === 'series_and_authors';
  const shouldRunGraph =
    filter === 'all' ||
    filter === 'discover' ||
    filter === 'series_and_authors';
  const shouldRunAi = includeAi && (filter === 'all' || filter === 'discover');

  const [shelfCandidates, graphCandidates, aiCandidates] = await Promise.all([
    shouldRunShelf
      ? Promise.resolve(
          scoreUnreadShelfCandidates(
            unreadBooks,
            shelfSummary.items,
            profile,
            refreshSeed,
          ),
        )
      : Promise.resolve([]),
    shouldRunGraph
      ? discoverCatalogGraphCandidates(profile, refreshSeed)
      : Promise.resolve([]),
    shouldRunAi
      ? discoverAiCuratorCandidates(profile, {limit: 6, refreshSeed})
      : Promise.resolve([]),
  ]);

  const merged = mergeAndFilterRecommendations(
    aiCandidates,
    shelfCandidates,
    graphCandidates,
    filter,
    limit,
  );

  return getRecommendationsOutputSchema.parse({
    items: merged,
    tasteSummary: {
      topGenres: profile.topGenres,
      topAuthors: profile.topAuthors,
      activeSeries: profile.activeSeries.map(s => s.seriesName),
      finishedCount: profile.finishedCount,
      unreadShelfCount: shelfCandidates.length,
    },
  });
}

export const RecommendationService = {
  parseSeriesVolume,
  buildReaderTasteProfile,
  scoreUnreadShelfCandidates,
  discoverCatalogGraphCandidates,
  discoverAiCuratorCandidates,
  mergeAndFilterRecommendations,
  getRecommendationsForUser,
};
