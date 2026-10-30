import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  RecommendationService,
  parseSeriesVolume,
  buildReaderTasteProfile,
  scoreUnreadShelfCandidates,
  mergeAndFilterRecommendations,
} from './recommendationService';
import {catalogOrchestrator} from '../catalog';
import {ReadingTrackerService} from '../readingTracker';
import * as geminiRecommendations from '../gemini/recommendations';
import type {
  ReadingShelfSummary,
  UnreadLibraryBookItem,
} from '../readingTracker';

vi.mock('../catalog', () => ({
  catalogOrchestrator: {
    searchByQuery: vi.fn(),
    searchByTitleAndAuthor: vi.fn(),
  },
}));

vi.mock('../readingTracker', () => ({
  ReadingTrackerService: {
    getPersonalReadingShelf: vi.fn(),
    getUnreadLibraryBooks: vi.fn(),
  },
}));

vi.mock('../gemini/recommendations', () => ({
  generateStructuredTasteRecommendations: vi.fn(),
}));

const sampleShelfSummary: ReadingShelfSummary = {
  items: [
    {
      id: 'b1',
      libraryId: 'lib-1',
      libraryName: 'Home Library',
      isVirtual: false,
      ownershipStatus: 'owned',
      readingStatus: 'finished',
      userRating: 5,
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      primaryGenre: 'Science Fiction',
      subgenres: ['Space Opera', 'Ecological Sci-Fi'],
      series: 'Dune Chronicles #1',
      addedAt: '2026-01-01',
    },
    {
      id: 'b2',
      libraryId: 'lib-1',
      libraryName: 'Home Library',
      isVirtual: false,
      ownershipStatus: 'owned',
      readingStatus: 'finished',
      userRating: 5,
      title: 'Piranesi',
      author: 'Susanna Clarke',
      primaryGenre: 'Fantasy',
      subgenres: ['Magical Realism'],
      addedAt: '2026-01-02',
    },
    {
      id: 'b3',
      libraryId: 'virtual_u1',
      libraryName: 'Personal Reading Shelf',
      isVirtual: true,
      ownershipStatus: 'unowned',
      readingStatus: 'abandoned',
      userRating: 1,
      title: 'Boring Economics Textbook',
      author: 'Dry Writer',
      primaryGenre: 'Business',
      addedAt: '2026-01-03',
    },
  ],
  counts: {
    all: 3,
    want_to_read: 0,
    reading: 0,
    finished: 2,
    abandoned: 1,
  },
};

const sampleUnreadBooks: UnreadLibraryBookItem[] = [
  {
    id: 'u1',
    libraryId: 'lib-2',
    libraryName: 'Living Room Shelf',
    readingStatus: 'unset',
    title: 'Dune Messiah',
    author: 'Frank Herbert',
    primaryGenre: 'Science Fiction',
    series: 'Dune Chronicles #2',
    synopsis: 'Paul Atreides rules as Emperor in the second Dune novel.',
    addedAt: '2026-01-04',
  },
  {
    id: 'u2',
    libraryId: 'lib-2',
    libraryName: 'Living Room Shelf',
    readingStatus: 'unset',
    title: 'Jonathan Strange & Mr Norrell',
    author: 'Susanna Clarke',
    primaryGenre: 'Fantasy',
    synopsis: 'Two magicians restore English magic in 19th-century England.',
    addedAt: '2026-01-05',
  },
];

describe('RecommendationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses series names and volume numbers cleanly', () => {
    expect(parseSeriesVolume('Dune Chronicles #1')).toEqual({
      seriesName: 'Dune Chronicles',
      volumeNumber: 1,
    });
    expect(parseSeriesVolume('The Stormlight Archive, Book 3')).toEqual({
      seriesName: 'The Stormlight Archive',
      volumeNumber: 3,
    });
    expect(parseSeriesVolume('Standalone Series')).toEqual({
      seriesName: 'Standalone Series',
      volumeNumber: null,
    });
    expect(parseSeriesVolume('')).toBeNull();
  });

  it('builds a reader taste profile weighting 4-5 star reads and separating abandoned negative signals', () => {
    const profile = buildReaderTasteProfile(
      sampleShelfSummary,
      sampleUnreadBooks,
    );

    expect(profile.finishedCount).toBe(2);
    expect(profile.positiveAnchors.map(a => a.title)).toEqual([
      'Dune',
      'Piranesi',
    ]);
    expect(profile.negativeSignals).toHaveLength(1);
    expect(profile.negativeSignals[0].title).toBe('Boring Economics Textbook');
    expect(profile.topAuthors).toContain('Frank Herbert');
    expect(profile.topAuthors).toContain('Susanna Clarke');
    expect(profile.topAuthors).not.toContain('Dry Writer');
    expect(profile.activeSeries).toEqual([
      {
        seriesName: 'Dune Chronicles',
        maxVolume: 1,
        author: 'Frank Herbert',
        seedBookTitle: 'Dune',
      },
    ]);
  });

  it('scores unread shelf books with boosts for series continuation and favorite authors', () => {
    const profile = buildReaderTasteProfile(
      sampleShelfSummary,
      sampleUnreadBooks,
    );
    const shelfRecs = scoreUnreadShelfCandidates(
      sampleUnreadBooks,
      sampleShelfSummary.items,
      profile,
    );

    expect(shelfRecs).toHaveLength(2);
    // Dune Messiah gets series boost (+50) + favorite author (+35) + genre (+20)
    expect(shelfRecs[0].title).toBe('Dune Messiah');
    expect(shelfRecs[0].source).toBe('shelf');
    expect(shelfRecs[0].matchTag).toContain('Next in Dune Chronicles');
    expect(shelfRecs[1].title).toBe('Jonathan Strange & Mr Norrell');
    expect(shelfRecs[1].matchTag).toContain('Favorite Author');
  });

  it('grounds AI candidates through catalogOrchestrator and drops unverified or duplicate titles', async () => {
    vi.mocked(
      ReadingTrackerService.getPersonalReadingShelf,
    ).mockResolvedValueOnce(sampleShelfSummary);
    vi.mocked(
      ReadingTrackerService.getUnreadLibraryBooks,
    ).mockResolvedValueOnce(sampleUnreadBooks);

    vi.mocked(
      geminiRecommendations.generateStructuredTasteRecommendations,
    ).mockResolvedValueOnce([
      {
        title: 'Hyperion',
        author: 'Dan Simmons',
        reason: 'Epic space opera with literary depth.',
        matchTag: 'Because you loved Dune',
      },
      {
        title: 'Imaginary Nonexistent Book 999',
        author: 'Fake Author',
        reason: 'Hallucinated entry that should be dropped.',
        matchTag: 'Because you loved Piranesi',
      },
    ]);

    vi.mocked(catalogOrchestrator.searchByTitleAndAuthor).mockImplementation(
      async (title: string) => {
        if (title === 'Hyperion') {
          return {
            title: 'Hyperion',
            author: 'Dan Simmons',
            isbn: '9780553283686',
            coverUrl:
              'https://covers.openlibrary.org/b/isbn/9780553283686-L.jpg',
            primaryGenre: 'Science Fiction',
            synopsis: 'Seven pilgrims travel to the time tombs on Hyperion.',
          };
        }
        return null;
      },
    );

    vi.mocked(catalogOrchestrator.searchByQuery).mockImplementation(
      async query => {
        const q = typeof query === 'string' ? query : query.rawQuery || '';
        if (q.includes('Susanna Clarke')) {
          return {
            books: [
              {
                title: 'The Ladies of Grace Adieu',
                author: 'Susanna Clarke',
                isbn: '9781596912519',
                primaryGenre: 'Fantasy',
                synopsis: 'Eight fairy stories set in an alternate England.',
              },
            ],
            providersQueried: ['openLibrary'],
            fromCache: false,
          };
        }
        return {books: [], providersQueried: [], fromCache: false};
      },
    );

    const output = await RecommendationService.getRecommendationsForUser(
      'u1',
      'reader@example.com',
      {filter: 'all', limit: 10, includeAi: true},
    );

    const titles = output.items.map(i => i.title);
    expect(titles).toContain('Hyperion');
    expect(titles).toContain('Dune Messiah');
    expect(titles).toContain('The Ladies of Grace Adieu');
    expect(titles).not.toContain('Imaginary Nonexistent Book 999');
  });

  it('merges and filters recommendations by category', () => {
    const ai = [
      {
        id: 'ai-1',
        title: 'Hyperion',
        author: 'Dan Simmons',
        source: 'ai_curator' as const,
        reason: 'Epic sci-fi.',
        matchTag: 'Because you loved Dune',
      },
    ];
    const shelf = [
      {
        id: 'shelf-1',
        title: 'Dune Messiah',
        author: 'Frank Herbert',
        source: 'shelf' as const,
        reason: 'Next in series on your shelf.',
        matchTag: 'Next in Dune Chronicles · Living Room Shelf',
      },
    ];
    const graph = [
      {
        id: 'graph-1',
        title: 'The Ladies of Grace Adieu',
        author: 'Susanna Clarke',
        source: 'catalog_graph' as const,
        reason: 'More by Susanna Clarke.',
        matchTag: 'More by Susanna Clarke',
      },
    ];

    expect(
      mergeAndFilterRecommendations(ai, shelf, graph, 'from_shelves').map(
        i => i.id,
      ),
    ).toEqual(['shelf-1']);

    expect(
      mergeAndFilterRecommendations(ai, shelf, graph, 'discover').map(
        i => i.id,
      ),
    ).toEqual(['ai-1', 'graph-1']);

    expect(
      mergeAndFilterRecommendations(ai, shelf, graph, 'series_and_authors').map(
        i => i.id,
      ),
    ).toEqual(['graph-1', 'shelf-1']);
  });
});
