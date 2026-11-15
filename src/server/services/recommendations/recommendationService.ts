import {
  getRecommendationsOutputSchema,
  type GetRecommendationsOutput,
  type RecommendationCategoryFilter,
} from '../../../schemas/recommendation';
import {rerankCandidatesWithDecisions} from '../gemini/recommendations';
import {ReadingTrackerService} from '../readingTracker';
import {
  discoverAiCuratorCandidates,
  discoverCatalogGraphCandidates,
  mergeAndFilterRecommendations,
} from './catalogGraphRerank';
import {scoreUnreadShelfCandidates} from './shelfScorer';
import {
  buildReaderTasteProfile,
  parseSeriesVolume,
  type ActiveSeriesSignal,
  type ReaderTasteProfile,
} from './tasteProfile';

export {
  buildReaderTasteProfile,
  discoverAiCuratorCandidates,
  discoverCatalogGraphCandidates,
  mergeAndFilterRecommendations,
  parseSeriesVolume,
  scoreUnreadShelfCandidates,
  type ActiveSeriesSignal,
  type ReaderTasteProfile,
};

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

  const [rawShelfCandidates, rawGraphCandidates, aiCandidates] =
    await Promise.all([
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

  let shelfCandidates = rawShelfCandidates;
  let graphCandidates = rawGraphCandidates;

  if (
    includeAi &&
    profile.positiveAnchors.length > 0 &&
    typeof rerankCandidatesWithDecisions === 'function'
  ) {
    const [rerankedShelf, rerankedGraph] = await Promise.all([
      shelfCandidates.length > 1
        ? rerankCandidatesWithDecisions(shelfCandidates, profile, {
            priority: 'INTERACTIVE',
          })
        : Promise.resolve(shelfCandidates),
      graphCandidates.length > 1
        ? rerankCandidatesWithDecisions(graphCandidates, profile, {
            priority: 'INTERACTIVE',
          })
        : Promise.resolve(graphCandidates),
    ]);
    shelfCandidates = rerankedShelf;
    graphCandidates = rerankedGraph;
  }

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
