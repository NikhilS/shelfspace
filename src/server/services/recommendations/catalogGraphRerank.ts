import type {
  BookRecommendationItem,
  RecommendationCategoryFilter,
} from '../../../schemas/recommendation';
import type {BookDetails} from '../../../types';
import {catalogOrchestrator} from '../catalog';
import {generateStructuredTasteRecommendations} from '../gemini/recommendations';
import {
  isCandidateExcluded,
  normalizeRecommendationIsbn,
  normalizeRecommendationText,
  type ReaderTasteProfile,
} from './tasteProfile';

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

  for (const seriesSignal of profile.activeSeries.slice(0, 2)) {
    const nextVolume = seriesSignal.maxVolume + 1;
    tasks.push(async () => {
      try {
        const queryStr = `${seriesSignal.seriesName} ${nextVolume} ${seriesSignal.author}`;
        const response = await catalogOrchestrator.searchByQuery(
          {
            title: `${seriesSignal.seriesName} #${nextVolume}`,
            author: seriesSignal.author,
            rawQuery: queryStr,
            limit: 4,
          },
          {priority: 'INTERACTIVE'},
        );

        const books = Array.isArray(response?.books) ? response.books : [];
        for (const hit of books) {
          if (
            !hit?.title ||
            isCandidateExcluded(hit.title, hit.author, hit.isbn, profile)
          ) {
            continue;
          }
          const hitTitleKey = normalizeRecommendationText(hit.title);
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

  const authorPool = [...profile.topAuthors];
  if (refreshSeed > 0 && authorPool.length > 1) {
    const offset = refreshSeed % authorPool.length;
    authorPool.push(...authorPool.splice(0, offset));
  }

  for (const favoriteAuthor of authorPool.slice(0, 3)) {
    tasks.push(async () => {
      try {
        const response = await catalogOrchestrator.searchByQuery(
          {
            author: favoriteAuthor,
            rawQuery: favoriteAuthor,
            limit: 5,
          },
          {priority: 'INTERACTIVE'},
        );

        const books = Array.isArray(response?.books) ? response.books : [];
        for (const hit of books) {
          if (
            !hit?.title ||
            isCandidateExcluded(hit.title, hit.author, hit.isbn, profile)
          ) {
            continue;
          }
          const hitAuthorNorm = normalizeRecommendationText(hit.author);
          const targetAuthorNorm = normalizeRecommendationText(favoriteAuthor);
          if (
            hitAuthorNorm &&
            targetAuthorNorm &&
            !hitAuthorNorm.includes(targetAuthorNorm) &&
            !targetAuthorNorm.includes(hitAuthorNorm)
          ) {
            continue;
          }

          const hitTitleKey = normalizeRecommendationText(hit.title);
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
      const candidateKey = normalizeRecommendationText(candidate.title);
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
          const fallbackSearch = await catalogOrchestrator.searchByQuery(
            {
              title: candidate.title,
              author: candidate.author,
              rawQuery: `${candidate.title} ${candidate.author}`,
              limit: 2,
            },
            {priority: 'INTERACTIVE'},
          );
          const hits = Array.isArray(fallbackSearch?.books)
            ? fallbackSearch.books
            : [];
          catalogMatch = hits[0] ?? null;
        } catch {
          catalogMatch = null;
        }
      }

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

      const resolvedKey = normalizeRecommendationText(catalogMatch.title);
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
    const tKey = normalizeRecommendationText(item.title);
    const cleanIsbn = normalizeRecommendationIsbn(item.isbn);
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

  const maxLen = Math.max(aiItems.length, shelfItems.length, graphItems.length);
  for (let i = 0; i < maxLen; i++) {
    tryPush(aiItems[i]);
    tryPush(shelfItems[i]);
    tryPush(graphItems[i]);
  }

  return finalItems;
}
