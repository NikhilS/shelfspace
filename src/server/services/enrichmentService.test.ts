import {describe, it, expect, vi, beforeEach} from 'vitest';
import {EnrichmentService} from './enrichmentService';
import {LibraryService} from './library';
import {MetadataRegistry} from './metadata';

vi.mock('./library');
vi.mock('./metadata');

const mockBookGet = vi.fn();
const mockBookDetailsGet = vi.fn().mockResolvedValue({exists: false});
const mockBookUpdate = vi.fn();
const mockBookDetailsSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockGetAll = vi.fn(
  async (...refs: Array<{get: () => Promise<unknown>}>) =>
    Promise.all(refs.map(ref => ref.get())),
);

const mockCollection = vi.fn(() => ({
  doc: vi.fn(() => ({
    collection: vi.fn((colName: string) => ({
      doc: vi.fn(() => ({
        get: colName === 'bookDetails' ? mockBookDetailsGet : mockBookGet,
        update: mockBookUpdate,
        set: mockBookDetailsSet,
      })),
    })),
  })),
}));

vi.mock('./firebaseAdmin', () => ({
  getAdminDb: () => ({
    collection: mockCollection,
    getAll: mockGetAll,
    batch: () => ({
      update: (
        ref: {update?: (d: unknown) => unknown},
        data: Record<string, unknown>,
      ) => {
        ref?.update?.(data);
      },
      set: (
        ref: {set?: (d: unknown, o?: unknown) => unknown},
        data: Record<string, unknown>,
        opts?: {merge?: boolean},
      ) => {
        ref?.set?.(data, opts);
      },
      commit: mockBatchCommit,
    }),
  }),
  formatFirestoreAdminError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

describe('EnrichmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully executes batch enrichment for valid books', async () => {
    // 1. Mock library access check
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    // 2. Mock provider
    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi
        .fn()
        .mockResolvedValue({b1: {locations: [{name: 'London'}]}}),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    // 3. Mock book doc in DB
    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Oliver Twist',
        author: 'Charles Dickens',
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'geo',
        bookIds: ['b1'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(1);
    expect(res.results[0]).toEqual({
      id: 'b1',
      geoMetadata: {locations: [{name: 'London'}]},
    });
    expect(mockBookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        geoMetadata: {locations: [{name: 'London'}]},
      }),
    );
  });

  it('handles non-existent books by returning empty results array', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue({
      getProvider: () => mockProvider,
    } as unknown as MetadataRegistry);

    mockBookGet.mockResolvedValueOnce({
      exists: false,
    });

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'synopsis',
        bookIds: ['nonexistent_book'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(0);
    expect(res.results).toEqual([]);
  });

  it('ignores books lacking a title and enriches valid ones', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({}),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue({
      getProvider: () => mockProvider,
    } as unknown as MetadataRegistry);

    mockBookGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: '', // Empty title
      }),
    });

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'genre',
        bookIds: ['b_notitle'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(0);
    expect(res.results).toEqual([]);
  });

  it('persists tombstone status "unsupported" when provider yields no metadata', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({}),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Abstract Math Treatise',
        author: 'Unknown Author',
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'geo',
        bookIds: ['b_abstract'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(0);
    expect(mockBookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        enrichmentStatus: expect.objectContaining({
          geo: 'unsupported',
        }) as unknown,
      }),
    );
  });

  it('does not poison enrichmentStatus with "unsupported" for hybrid fields when allowAiFallback is false', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({}),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Rare Edition',
        author: 'Obscure Author',
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'synopsis',
        bookIds: ['b_rare'],
        allowAiFallback: false,
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(0);
    expect(mockProvider.bulkFetch).toHaveBeenCalledWith(
      expect.any(Array),
      expect.objectContaining({allowAiFallback: false}),
    );
    expect(mockBookUpdate).not.toHaveBeenCalled();
  });

  it('resolves canonical temporal key, updates status to completed, and rejects legacy temporalMetadata alias', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi
        .fn()
        .mockResolvedValue({b2: {startYear: 1812, endYear: 1812}}),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'War and Peace',
        author: 'Leo Tolstoy',
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);

    await expect(
      EnrichmentService.triggerBatchEnrichment('u1', 'u1@example.com', {
        libraryId: 'lib1',
        enrichmentType: 'temporalMetadata',
        bookIds: ['b2'],
      }),
    ).rejects.toThrow(/Unsupported enrichment type/);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'temporal',
        bookIds: ['b2'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(1);
    expect(mockBookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        temporalMetadata: {startYear: 1812, endYear: 1812},
        enrichmentStatus: expect.objectContaining({
          temporal: 'completed',
        }) as unknown,
      }),
    );
  });

  it('updates primaryGenre and subgenres on genre enrichment', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({
        b_genre: {
          primaryGenre: 'Science Fiction',
          subgenres: ['Space Opera', 'Cyberpunk'],
          isCustomPrimary: false,
        },
      }),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Dune',
        author: 'Frank Herbert',
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'genre',
        bookIds: ['b_genre'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(1);
    expect(mockBookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        primaryGenre: 'Science Fiction',
        subgenres: ['Space Opera', 'Cyberpunk'],
        enrichmentStatus: expect.objectContaining({
          genre: 'completed',
        }) as unknown,
      }),
    );
  });

  it('hard-fences synopsis enrichment by writing bookDetailsMetadata to books and full synopsis to bookDetails', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({
        b_synopsis: 'A rich epic narrative set in a desert world.',
      }),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Dune',
        author: 'Frank Herbert',
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);
    mockBookDetailsSet.mockResolvedValue(undefined);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'synopsis',
        bookIds: ['b_synopsis'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(1);

    // Assert that books/{bookId}.update receives bookDetailsMetadata and NOT synopsis
    const updateCallArg = mockBookUpdate.mock.calls[0][0] as {
      synopsis?: unknown;
      bookDetailsMetadata?: unknown;
      enrichmentStatus: {synopsis?: string};
    };
    expect(updateCallArg.synopsis).toBeUndefined();
    expect(updateCallArg.bookDetailsMetadata).toEqual({
      hasSynopsis: true,
    });
    expect(updateCallArg.enrichmentStatus.synopsis).toBe('completed');

    // Assert that bookDetails receives the full text
    expect(mockBookDetailsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        synopsis: 'A rich epic narrative set in a desert world.',
      }),
      {merge: true},
    );
  });

  it('hard-fences embedding enrichment by writing bookDetailsMetadata to books and vectors to bookDetails', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({
        b_embed: [0.12, -0.45, 0.89],
      }),
    };

    const mockRegistry = {
      getProvider: vi.fn().mockReturnValue(mockProvider),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue(
      mockRegistry as unknown as MetadataRegistry,
    );

    mockBookGet.mockResolvedValue({
      exists: true,
      data: () => ({
        title: 'Neuromancer',
        author: 'William Gibson',
        bookDetailsMetadata: {
          hasSynopsis: true,
        },
      }),
    });

    mockBookUpdate.mockResolvedValue(undefined);
    mockBookDetailsSet.mockResolvedValue(undefined);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'embedding',
        bookIds: ['b_embed'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(1);

    // Assert that books/{bookId}.update does not have raw embedding array
    const updateCallArg = mockBookUpdate.mock.calls[0][0] as {
      embedding?: unknown;
      bookDetailsMetadata?: unknown;
    };
    expect(updateCallArg.embedding).toBeUndefined();
    expect(updateCallArg.bookDetailsMetadata).toEqual({
      hasSynopsis: true,
      hasEmbedding: true,
    });

    // Assert that bookDetails receives the vectors
    expect(mockBookDetailsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: [0.12, -0.45, 0.89],
      }),
      {merge: true},
    );
  });

  it('uses db.getAll() and db.batch() to eliminate N+1 Firestore RPCs when available', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const mockProvider = {
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({
        b1: {
          primaryGenre: 'Science Fiction',
          subgenres: ['Dystopian'],
          isCustomPrimary: false,
        },
        b2: {
          primaryGenre: 'Literary Fiction',
          subgenres: ['Classics'],
          isCustomPrimary: false,
        },
      }),
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue({
      getProvider: () => mockProvider,
    } as unknown as MetadataRegistry);

    const mockBatchUpdate = vi.fn();
    const mockBatchSet = vi.fn();
    const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
    const mockGetAll = vi
      .fn()
      // First getAll: primary book docs (missing inline synopsis so bookDetails getAll is triggered)
      .mockResolvedValueOnce([
        {
          exists: true,
          data: () => ({title: '1984', author: 'George Orwell'}),
        },
        {
          exists: true,
          data: () => ({title: 'Middlemarch', author: 'George Eliot'}),
        },
      ])
      // Second getAll: bookDetails docs for synopsis context
      .mockResolvedValueOnce([
        {
          exists: true,
          data: () => ({synopsis: 'Totalitarian surveillance state.'}),
        },
        {
          exists: true,
          data: () => ({synopsis: 'Provincial life in 19th-century England.'}),
        },
      ]);

    const firebaseAdminModule = await import('./firebaseAdmin');
    vi.spyOn(firebaseAdminModule, 'getAdminDb').mockReturnValueOnce({
      collection: mockCollection,
      getAll: mockGetAll,
      batch: () => ({
        update: mockBatchUpdate,
        set: mockBatchSet,
        commit: mockBatchCommit,
      }),
    } as unknown as ReturnType<typeof firebaseAdminModule.getAdminDb>);

    const res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'genre',
        bookIds: ['b1', 'b2'],
      },
    );

    expect(res.status).toBe('success');
    expect(res.processedCount).toBe(2);
    expect(mockGetAll).toHaveBeenCalledTimes(2);
    expect(mockBookGet).not.toHaveBeenCalled();
    expect(mockProvider.bulkFetch).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'b1',
          synopsis: 'Totalitarian surveillance state.',
        }),
        expect.objectContaining({
          id: 'b2',
          synopsis: 'Provincial life in 19th-century England.',
        }),
      ]),
      expect.any(Object),
    );
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(mockBookUpdate).not.toHaveBeenCalled();
  });

  it('executes single-wave stageIndex mode by committing resolved/pruned books and escalating residuals without premature tombstones', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValueOnce(true);

    const stage0Execute = vi.fn().mockResolvedValue(
      new Map([
        [
          'b_pruned',
          {
            status: 'pruned',
            reason: 'standalone',
          },
        ],
        [
          'b_escalated',
          {
            status: 'escalate',
            enrichedBook: {series: undefined},
          },
        ],
      ]),
    );
    const stage1Execute = vi.fn().mockResolvedValue(
      new Map([
        [
          'b_escalated',
          {
            status: 'resolved',
            value: 'The Expanse #1',
            winningProvider: 'apple_books',
            bonusCatalog: {
              isbn: '978-0-316-12908-4',
              publishedDate: '2011',
              synopsis: 'Ice hauler captain uncovers an alien conspiracy.',
            },
          },
        ],
      ]),
    );

    const stagedSeriesPlugin = {
      isAvailable: () => true,
      bulkFetch: vi.fn(),
      stages: [
        {id: 'series-decision-gate', tier: 'decision', execute: stage0Execute},
        {id: 'series-catalog', tier: 'catalog', execute: stage1Execute},
      ],
    };

    vi.mocked(MetadataRegistry.getInstance).mockReturnValue({
      getProvider: () => stagedSeriesPlugin,
    } as unknown as MetadataRegistry);

    mockBookGet
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          title: 'Middlemarch',
          author: 'George Eliot',
        }),
      })
      .mockResolvedValueOnce({
        exists: true,
        data: () => ({
          title: 'Leviathan Wakes',
          author: 'James S. A. Corey',
        }),
      });

    const wave0Progress: Array<{bookId: string; stage: string}> = [];
    const wave0Res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'series',
        bookIds: ['b_pruned', 'b_escalated'],
      },
      {
        stageIndex: 0,
        callbacks: {
          onBookProgress: u =>
            wave0Progress.push({bookId: u.bookId, stage: u.stage}),
        },
      },
    );

    expect(stage0Execute).toHaveBeenCalledTimes(1);
    expect(stage1Execute).not.toHaveBeenCalled();
    expect(wave0Res.prunedCount).toBe(1);
    expect(wave0Res.processedCount).toBe(0);
    expect(wave0Res.escalatedBooks).toEqual([
      {
        bookId: 'b_escalated',
        state: {enrichedBook: {series: undefined}},
      },
    ]);
    // Only the pruned standalone book should receive an 'unsupported' write in Wave 0
    expect(mockBookUpdate).toHaveBeenCalledTimes(1);
    expect(mockBookUpdate).toHaveBeenCalledWith({
      enrichmentStatus: {series: 'unsupported'},
    });
    expect(wave0Progress).toContainEqual({
      bookId: 'b_escalated',
      stage: 'evaluating_decisions',
    });
    expect(wave0Progress).not.toContainEqual({
      bookId: 'b_escalated',
      stage: 'skipped',
    });

    // Now run Wave 1 strictly on the escalated book and verify bonus catalog fields persist
    mockBookUpdate.mockClear();
    mockBookDetailsSet.mockClear();
    mockBookGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({
        title: 'Leviathan Wakes',
        author: 'James S. A. Corey',
      }),
    });

    const priorEscalations = new Map(
      (wave0Res.escalatedBooks ?? []).map(item => [item.bookId, item.state]),
    );
    const wave1Res = await EnrichmentService.triggerBatchEnrichment(
      'u1',
      'u1@example.com',
      {
        libraryId: 'lib1',
        enrichmentType: 'series',
        bookIds: ['b_escalated'],
      },
      {
        skipAccessCheck: true,
        stageIndex: 1,
        priorEscalations,
      },
    );

    expect(stage1Execute).toHaveBeenCalledTimes(1);
    expect(wave1Res.processedCount).toBe(1);
    expect(wave1Res.escalatedBooks).toEqual([]);
    expect(mockBookUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        series: 'The Expanse #1',
        isbn: '978-0-316-12908-4',
        cleanIsbn: '9780316129084',
        publishedDate: '2011',
        bookDetailsMetadata: {hasSynopsis: true},
        enrichmentStatus: {
          series: 'completed',
          synopsis: 'completed',
        },
      }),
    );
    expect(mockBookDetailsSet).toHaveBeenCalledWith(
      expect.objectContaining({
        synopsis: 'Ice hauler captain uncovers an alien conspiracy.',
      }),
      {merge: true},
    );
  });
});
