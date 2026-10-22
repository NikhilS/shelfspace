import {describe, it, expect, vi, beforeEach} from 'vitest';
import {MetadataRegistry} from './registry';
import {resolveBookSynopses} from './utils';
import {MetadataKey, IMetadataProvider} from '../../../types/metadata';
import {catalogOrchestrator} from '../catalog';

vi.mock('../catalog', () => ({
  catalogOrchestrator: {
    searchByIsbn: vi.fn(),
    searchByQuery: vi.fn(),
  },
}));

describe('MetadataRegistry & resolveBookSynopses unit suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-hydrates books in a single unified catalog pass and sequentially runs on-create providers', async () => {
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

    const mockEmbeddingProvider: IMetadataProvider<number[]> = {
      getKey: () => MetadataKey.EMBEDDING,
      shouldFetchOnCreate: () => true,
      isAvailable: () => true,
      fetch: vi.fn(),
      bulkFetch: vi.fn(async books => {
        // Verify that EmbeddingMetadataProvider receives the pre-hydrated synopsis & genre!
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

  it('preserves existing synopses, fetches missing ones in bulk, and respects AbortSignal cancellation', async () => {
    const registry = MetadataRegistry.getInstance();
    const originalSynopsis = registry.getProvider(MetadataKey.SYNOPSIS);

    const mockSynopsisProvider: IMetadataProvider<string | null> = {
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

      // Aborted signal skips provider call and returns existing synopses immediately
      const abortController = new AbortController();
      abortController.abort();
      vi.mocked(mockSynopsisProvider.bulkFetch!).mockClear();

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
