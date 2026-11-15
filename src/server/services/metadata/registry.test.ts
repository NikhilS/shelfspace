import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {MetadataKey, type MetadataProvider} from '../../../types/metadata';
import {catalogOrchestrator} from '../catalog';
import {classifyBooks, evaluateGenreAndSeriesGateCoalesced} from '../gemini';
import {MetadataRegistry} from './registry';
import {resolveBookSynopses} from './utils';

vi.mock('../catalog', () => ({
  catalogOrchestrator: {
    searchByIsbn: vi.fn(),
    searchByQuery: vi.fn(),
  },
}));

vi.mock('../gemini', () => ({
  GENRE_CONFIDENCE_THRESHOLD: 0.65,
  classifyBooks: vi.fn(),
  evaluateGenreAndSeriesGateCoalesced: vi.fn(),
}));

describe('MetadataRegistry & resolveBookSynopses unit suite', () => {
  const originalGeminiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GEMINI_API_KEY;
  });

  afterEach(() => {
    if (originalGeminiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalGeminiKey;
    }
  });

  it('registers all 8 typed MetadataPlugin implementations lazily without circular init errors', () => {
    const registry = MetadataRegistry.getInstance();
    const plugins = registry.getAllPlugins();
    expect(plugins).toHaveLength(8);
    expect(registry.getPlugin(MetadataKey.GEO)?.statusKey).toBe('geo');
    expect(registry.getPlugin(MetadataKey.TEMPORAL)?.statusKey).toBe(
      'temporal',
    );
    expect(registry.getPlugin(MetadataKey.GENRE)?.statusKey).toBe('genre');
    expect(registry.getPlugin(MetadataKey.SYNOPSIS)?.statusKey).toBe(
      'synopsis',
    );
  });

  it('pre-hydrates books in a single unified catalog pass and sequentially runs on-create providers when GEMINI_API_KEY is absent', async () => {
    const registry = MetadataRegistry.getInstance();

    vi.mocked(catalogOrchestrator.searchByIsbn).mockResolvedValueOnce({
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg',
      synopsis: 'Arrakis desert epic.',
      publishedDate: '1965',
      series: 'Dune Chronicles #1',
      primaryGenre: 'Science Fiction',
      subgenres: ['Space Opera'],
      isCustomPrimary: false,
      sources: ['open-library'],
    });

    type BulkFetchBooks = Parameters<
      NonNullable<MetadataProvider<number[]>['bulkFetch']>
    >[0];

    const mockEmbeddingProvider: MetadataProvider<number[]> = {
      getKey: () => MetadataKey.EMBEDDING,
      shouldFetchOnCreate: () => true,
      isAvailable: () => true,
      fetch: vi.fn(),
      bulkFetch: vi.fn(async (books: BulkFetchBooks) => {
        expect(books[0].synopsis).toBe('Arrakis desert epic.');
        expect(books[0].primaryGenre).toBe('Science Fiction');
        return {[books[0].id]: [0.5, 0.5]};
      }),
    };

    const originalEmbedding = registry.getProvider(MetadataKey.EMBEDDING);
    registry.register(mockEmbeddingProvider);

    try {
      const updates = await registry.enrichBooksOnCreate([
        {
          id: 'book-1',
          title: 'Dune',
          author: 'Frank Herbert',
          isbn: '9780441172719',
        },
      ]);

      const bookUpdates = updates.get('book-1');
      expect(bookUpdates).toMatchObject({
        [MetadataKey.COVER_IMAGE]:
          'https://covers.openlibrary.org/b/id/123-L.jpg',
        [MetadataKey.SYNOPSIS]: 'Arrakis desert epic.',
        publishedDate: '1965',
        series: 'Dune Chronicles #1',
        primaryGenre: 'Science Fiction',
        subgenres: ['Space Opera'],
        [MetadataKey.EMBEDDING]: [0.5, 0.5],
      });
    } finally {
      if (originalEmbedding) {
        registry.register(originalEmbedding);
      }
    }
  });

  it('runs coalesced Genre + Series Gate Decisions first, blocks standalone catalog series noise, and re-passes only low-confidence genres on new synopsis', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini-key';
    const registry = MetadataRegistry.getInstance();

    const mockEmbeddingProvider: MetadataProvider<number[]> = {
      getKey: () => MetadataKey.EMBEDDING,
      shouldFetchOnCreate: () => true,
      isAvailable: () => false,
      fetch: vi.fn(),
      bulkFetch: vi.fn(),
    };
    const originalEmbedding = registry.getProvider(MetadataKey.EMBEDDING);
    registry.register(mockEmbeddingProvider);

    vi.mocked(evaluateGenreAndSeriesGateCoalesced).mockResolvedValueOnce({
      genresByBookId: new Map([
        [
          'standalone-high-conf',
          {
            id: 'standalone-high-conf',
            primaryGenre: 'Literary Fiction',
            subgenres: ['Classics'],
            isCustomPrimary: false,
            confidence: 0.92,
          },
        ],
        [
          'series-low-conf',
          {
            id: 'series-low-conf',
            primaryGenre: 'Fiction',
            subgenres: [],
            isCustomPrimary: false,
            confidence: 0.41,
          },
        ],
      ]),
      seriesGateByBookId: new Map([
        ['standalone-high-conf', {isSeriesCandidate: false, noul: 0.08}],
        ['series-low-conf', {isSeriesCandidate: true, noul: 0.89}],
      ]),
    });

    vi.mocked(catalogOrchestrator.searchByIsbn)
      .mockResolvedValueOnce({
        title: 'Middlemarch',
        author: 'George Eliot',
        isbn: '9780141439549',
        coverUrl: 'https://covers.openlibrary.org/b/id/111-L.jpg',
        publishedDate: '1871',
        synopsis: 'Provincial Victorian life.',
        series: 'Penguin Classics Omnibus', // noisy publisher imprint that must be ignored for standalone book
        sources: ['open-library'],
      })
      .mockResolvedValueOnce({
        title: 'Leviathan Wakes',
        author: 'James S. A. Corey',
        isbn: '9780316129084',
        coverUrl: 'https://covers.openlibrary.org/b/id/222-L.jpg',
        publishedDate: '2011',
        synopsis: 'Interplanetary conspiracy across the Asteroid Belt.',
        series: 'The Expanse #1',
        sources: ['open-library'],
      });

    vi.mocked(classifyBooks).mockResolvedValueOnce([
      {
        id: 'series-low-conf',
        primaryGenre: 'Science Fiction',
        subgenres: ['Space Opera'],
        isCustomPrimary: false,
        confidence: 0.95,
      },
    ]);

    try {
      const fastState = await registry.enrichBooksOnCreateFastTier([
        {
          id: 'standalone-high-conf',
          title: 'Middlemarch',
          author: 'George Eliot',
          isbn: '9780141439549',
        },
        {
          id: 'series-low-conf',
          title: 'Leviathan Wakes',
          author: 'James S. A. Corey',
          isbn: '9780316129084',
        },
      ]);

      expect(evaluateGenreAndSeriesGateCoalesced).toHaveBeenCalledTimes(1);
      expect(catalogOrchestrator.searchByIsbn).not.toHaveBeenCalled();
      expect(
        fastState.standaloneSeriesBookIds.has('standalone-high-conf'),
      ).toBe(true);
      expect(fastState.lowConfidenceGenreBookIds.has('series-low-conf')).toBe(
        true,
      );
      expect(
        fastState.lowConfidenceGenreBookIds.has('standalone-high-conf'),
      ).toBe(false);
      expect(fastState.updatesByBookId.get('standalone-high-conf')).toEqual({
        primaryGenre: 'Literary Fiction',
        subgenres: ['Classics'],
        isCustomPrimary: false,
        enrichmentStatus: {
          genre: 'completed',
          series: 'unsupported',
        },
      });

      const slowDelta = await registry.enrichBooksOnCreateSlowTier(fastState);

      // Targeted classifyBooks re-pass should ONLY run on the 1 low-confidence book
      expect(classifyBooks).toHaveBeenCalledTimes(1);
      expect(vi.mocked(classifyBooks).mock.calls[0][0]).toEqual([
        {
          id: 'series-low-conf',
          title: 'Leviathan Wakes',
          author: 'James S. A. Corey',
          synopsis: 'Interplanetary conspiracy across the Asteroid Belt.',
        },
      ]);

      // Standalone book does NOT get noisy publisher series string
      expect(slowDelta.get('standalone-high-conf')?.series).toBeUndefined();

      // Series candidate gets catalog series + upgraded genre from synopsis re-pass
      expect(slowDelta.get('series-low-conf')).toMatchObject({
        [MetadataKey.COVER_IMAGE]:
          'https://covers.openlibrary.org/b/id/222-L.jpg',
        [MetadataKey.SYNOPSIS]:
          'Interplanetary conspiracy across the Asteroid Belt.',
        series: 'The Expanse #1',
        primaryGenre: 'Science Fiction',
        subgenres: ['Space Opera'],
      });
    } finally {
      if (originalEmbedding) {
        registry.register(originalEmbedding);
      }
    }
  });

  it('preserves existing synopses, fetches missing ones in bulk, and respects AbortSignal cancellation', async () => {
    const registry = MetadataRegistry.getInstance();
    const originalSynopsis = registry.getProvider(MetadataKey.SYNOPSIS);

    const mockSynopsisProvider: MetadataProvider<string | null> = {
      getKey: () => MetadataKey.SYNOPSIS,
      shouldFetchOnCreate: () => true,
      isAvailable: () => true,
      fetch: vi.fn(),
      bulkFetch: vi.fn().mockResolvedValue({
        'b-missing': 'Fetched synopsis from catalog.',
      }),
    };
    registry.register(mockSynopsisProvider);

    try {
      const result = await resolveBookSynopses([
        {
          id: 'b-existing',
          title: 'Existing',
          author: 'Author',
          synopsis: '  Already has synopsis  ',
        },
        {
          id: 'b-missing',
          title: 'Missing',
          author: 'Author',
        },
      ]);

      expect(result.get('b-existing')).toBe('Already has synopsis');
      expect(result.get('b-missing')).toBe('Fetched synopsis from catalog.');
      expect(mockSynopsisProvider.bulkFetch).toHaveBeenCalledTimes(1);

      const abortController = new AbortController();
      abortController.abort();
      vi.mocked(mockSynopsisProvider.bulkFetch).mockClear();

      const abortedResult = await resolveBookSynopses(
        [
          {
            id: 'b-existing',
            title: 'Existing',
            author: 'Author',
            synopsis: 'Preserved',
          },
          {id: 'b-missing-2', title: 'Missing 2', author: 'Author'},
        ],
        {signal: abortController.signal},
      );
      expect(abortedResult.get('b-existing')).toBe('Preserved');
      expect(abortedResult.has('b-missing-2')).toBe(false);
      expect(mockSynopsisProvider.bulkFetch).not.toHaveBeenCalled();
    } finally {
      if (originalSynopsis) {
        registry.register(originalSynopsis);
      }
    }
  });
});
