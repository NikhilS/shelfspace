import {describe, it, expect, vi, beforeEach} from 'vitest';
import {EnrichmentService} from './enrichmentService';
import {LibraryService} from './library';
import {
  extractBookGeoMetadataBatch,
  extractBookTemporalMetadataBatch,
  classifyBooks,
} from './gemini';
import {catalogOrchestrator, wikipediaProvider} from './catalog';

vi.mock('./library');

vi.mock('./firebaseAdmin', () => {
  return {
    getAdminDb: () => ({
      getAll: vi.fn(async (...refs: Array<{get: () => Promise<unknown>}>) =>
        Promise.all(refs.map(r => r.get())),
      ),
      batch: () => ({
        update: vi.fn(),
        set: vi.fn(),
        commit: vi.fn().mockResolvedValue(undefined),
      }),
      collection: () => ({
        doc: () => ({
          collection: (colName: string) => ({
            doc: (bookId: string) => ({
              get: vi.fn().mockResolvedValue({
                exists: true,
                data: () =>
                  colName === 'bookDetails'
                    ? {synopsis: ''}
                    : {
                        title: `Book ${bookId}`,
                        author: `Author ${bookId}`,
                        synopsis: '',
                      },
              }),
              update: vi.fn().mockResolvedValue(undefined),
              set: vi.fn().mockResolvedValue(undefined),
            }),
          }),
        }),
      }),
    }),
  };
});

vi.mock('./gemini', () => ({
  extractBookGeoMetadataBatch: vi.fn(),
  extractBookTemporalMetadataBatch: vi.fn(),
  classifyBooks: vi.fn(),
}));

vi.mock('./catalog', () => ({
  catalogOrchestrator: {
    searchByIsbn: vi.fn().mockResolvedValue(null),
    searchByQuery: vi.fn().mockResolvedValue({
      books: [
        {
          title: 'Matched Book',
          author: 'Matched Author',
          coverUrl: 'https://example.com/cover.jpg',
          synopsis: 'Found synopsis',
        },
      ],
      skippedProviders: [],
      respondedProviders: ['Apple Books'],
    }),
    fetchCoverCandidates: vi.fn().mockResolvedValue({
      candidates: [],
      skippedProviders: [],
      respondedProviders: [],
    }),
  },
  wikipediaProvider: {
    fetchAuthorBio: vi.fn().mockResolvedValue('Author biography text'),
  },
}));

vi.mock('./limiters', () => ({
  geminiLimiter: {
    schedule: vi.fn((fnOrOpts: unknown, maybeFn?: () => unknown) =>
      typeof fnOrOpts === 'function' ? fnOrOpts() : maybeFn?.(),
    ),
  },
}));

function createBookIds(count: number): string[] {
  return Array.from({length: count}, (_, i) => `book_${i + 1}`);
}

describe('Enrichment Public API Batching Behavior', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'mock-gemini-key';
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue(true);
  });

  describe('Batched Gemini Operations (geo, temporal, genre)', () => {
    describe('geo enrichment', () => {
      it('makes 1 call with 5 books', async () => {
        vi.mocked(extractBookGeoMetadataBatch).mockResolvedValue({
          enrichment: [],
        });
        const bookIds = createBookIds(5);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'geo',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(extractBookGeoMetadataBatch).toHaveBeenCalledTimes(1);
        const firstCallArg = vi.mocked(extractBookGeoMetadataBatch).mock
          .calls[0][0];
        expect(firstCallArg).toHaveLength(5);
      });

      it('makes 1 call with 10 books', async () => {
        vi.mocked(extractBookGeoMetadataBatch).mockResolvedValue({
          enrichment: [],
        });
        const bookIds = createBookIds(10);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'geo',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(extractBookGeoMetadataBatch).toHaveBeenCalledTimes(1);
        const firstCallArg = vi.mocked(extractBookGeoMetadataBatch).mock
          .calls[0][0];
        expect(firstCallArg).toHaveLength(10);
      });

      it('makes 4 calls with 33 books (10 + 10 + 10 + 3)', async () => {
        vi.mocked(extractBookGeoMetadataBatch).mockResolvedValue({
          enrichment: [],
        });
        const bookIds = createBookIds(33);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'geo',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(extractBookGeoMetadataBatch).toHaveBeenCalledTimes(4);

        const calls = vi.mocked(extractBookGeoMetadataBatch).mock.calls;
        expect(calls[0][0]).toHaveLength(10);
        expect(calls[1][0]).toHaveLength(10);
        expect(calls[2][0]).toHaveLength(10);
        expect(calls[3][0]).toHaveLength(3);
      });
    });

    describe('temporal enrichment', () => {
      it('makes 1 call with 5 books', async () => {
        vi.mocked(extractBookTemporalMetadataBatch).mockResolvedValue({
          enrichment: [],
        });
        const bookIds = createBookIds(5);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'temporal',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(extractBookTemporalMetadataBatch).toHaveBeenCalledTimes(1);
        expect(
          vi.mocked(extractBookTemporalMetadataBatch).mock.calls[0][0],
        ).toHaveLength(5);
      });

      it('makes 1 call with 10 books', async () => {
        vi.mocked(extractBookTemporalMetadataBatch).mockResolvedValue({
          enrichment: [],
        });
        const bookIds = createBookIds(10);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'temporal',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(extractBookTemporalMetadataBatch).toHaveBeenCalledTimes(1);
        expect(
          vi.mocked(extractBookTemporalMetadataBatch).mock.calls[0][0],
        ).toHaveLength(10);
      });

      it('makes 4 calls with 33 books (10 + 10 + 10 + 3)', async () => {
        vi.mocked(extractBookTemporalMetadataBatch).mockResolvedValue({
          enrichment: [],
        });
        const bookIds = createBookIds(33);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'temporal',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(extractBookTemporalMetadataBatch).toHaveBeenCalledTimes(4);

        const calls = vi.mocked(extractBookTemporalMetadataBatch).mock.calls;
        expect(calls[0][0]).toHaveLength(10);
        expect(calls[1][0]).toHaveLength(10);
        expect(calls[2][0]).toHaveLength(10);
        expect(calls[3][0]).toHaveLength(3);
      });
    });

    describe('genre enrichment', () => {
      it('makes 1 call with 5 books', async () => {
        vi.mocked(classifyBooks).mockResolvedValue([]);
        const bookIds = createBookIds(5);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'genre',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(classifyBooks).toHaveBeenCalledTimes(1);
        expect(vi.mocked(classifyBooks).mock.calls[0][0]).toHaveLength(5);
      });

      it('makes 1 call with 10 books', async () => {
        vi.mocked(classifyBooks).mockResolvedValue([]);
        const bookIds = createBookIds(10);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'genre',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(classifyBooks).toHaveBeenCalledTimes(1);
        expect(vi.mocked(classifyBooks).mock.calls[0][0]).toHaveLength(10);
      });

      it('makes 4 calls with 33 books (10 + 10 + 10 + 3)', async () => {
        vi.mocked(classifyBooks).mockResolvedValue([]);
        const bookIds = createBookIds(33);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'genre',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(classifyBooks).toHaveBeenCalledTimes(4);

        const calls = vi.mocked(classifyBooks).mock.calls;
        expect(calls[0][0]).toHaveLength(10);
        expect(calls[1][0]).toHaveLength(10);
        expect(calls[2][0]).toHaveLength(10);
        expect(calls[3][0]).toHaveLength(3);
      });
    });
  });

  describe('Non-Gemini / Per-Book Enrichment Operations (coverImage, synopsis, authorBio)', () => {
    describe('coverImage enrichment', () => {
      it('makes requests equal to number of books (5 books -> 5 calls)', async () => {
        const bookIds = createBookIds(5);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'coverImage',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(catalogOrchestrator.searchByQuery).toHaveBeenCalledTimes(5);
      });

      it('makes requests equal to number of books (33 books -> 33 calls)', async () => {
        const bookIds = createBookIds(33);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'coverImage',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(catalogOrchestrator.searchByQuery).toHaveBeenCalledTimes(33);
      });
    });

    describe('synopsis enrichment', () => {
      it('makes requests equal to number of books (5 books -> 5 calls)', async () => {
        const bookIds = createBookIds(5);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'synopsis',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(catalogOrchestrator.searchByQuery).toHaveBeenCalledTimes(5);
      });

      it('makes requests equal to number of books (33 books -> 33 calls)', async () => {
        const bookIds = createBookIds(33);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'synopsis',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(catalogOrchestrator.searchByQuery).toHaveBeenCalledTimes(33);
      });
    });

    describe('authorBio enrichment', () => {
      it('makes requests equal to number of books (5 books -> 5 calls)', async () => {
        const bookIds = createBookIds(5);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'authorBio',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(wikipediaProvider.fetchAuthorBio).toHaveBeenCalledTimes(5);
      });

      it('makes requests equal to number of books (33 books -> 33 calls)', async () => {
        const bookIds = createBookIds(33);

        const res = await EnrichmentService.triggerBatchEnrichment(
          'u1',
          'u1@example.com',
          {
            libraryId: 'lib1',
            enrichmentType: 'authorBio',
            bookIds,
          },
        );

        expect(res.status).toBe('success');
        expect(wikipediaProvider.fetchAuthorBio).toHaveBeenCalledTimes(33);
      });
    });
  });
});
