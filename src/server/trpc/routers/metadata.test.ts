import {describe, it, expect, vi, beforeEach} from 'vitest';
import {metadataRouter} from './metadata';
import {MetadataRegistry} from '../../services/metadata';
import {MetadataKey} from '../../../types/metadata';
import {catalogOrchestrator, wikipediaProvider} from '../../services/catalog';
import {serverTelemetryBuffer} from '../../services/telemetry/serverTelemetryBuffer';
import type {SecurityContext} from '../../auth/types';

vi.mock('../../services/catalog', () => ({
  catalogOrchestrator: {
    searchByIsbn: vi.fn(),
    searchByQuery: vi.fn(),
    fetchCoverCandidates: vi.fn(),
    inspectAllCapacities: vi.fn(),
  },
  wikipediaProvider: {
    fetchAuthorBio: vi.fn(),
  },
}));

const userCtx: SecurityContext = {
  user: {uid: 'user-1', email: 'reader@example.com'},
  isAdmin: false,
  isAppAllowed: true,
};

const adminCtx: SecurityContext = {
  user: {uid: 'admin-1', email: 'admin@example.com'},
  isAdmin: true,
  isAppAllowed: true,
};

describe('metadataRouter tRPC procedures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('enriches books on create across available on-create providers', async () => {
    const mockProvider = {
      getKey: () => MetadataKey.GENRE,
      shouldFetchOnCreate: () => true,
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({
        'b-1': {primaryGenre: 'Literary Fiction', subgenres: []},
      }),
    };

    vi.spyOn(MetadataRegistry, 'getInstance').mockReturnValue({
      getAllProviders: () => [mockProvider],
    } as unknown as MetadataRegistry);

    const caller = metadataRouter.createCaller(userCtx);
    const res = await caller.enrichCreate({
      books: [{id: 'b-1', title: 'Middlemarch', author: 'George Eliot'}],
    });

    expect(res['b-1'][MetadataKey.GENRE]).toEqual({
      primaryGenre: 'Literary Fiction',
      subgenres: [],
    });
  });

  it('validates provider existence and availability in enrichSpruceUp', async () => {
    const registryMock = {
      getProvider: vi.fn(),
    };
    vi.spyOn(MetadataRegistry, 'getInstance').mockReturnValue(
      registryMock as unknown as MetadataRegistry,
    );

    const caller = metadataRouter.createCaller(userCtx);

    registryMock.getProvider.mockReturnValue(undefined);
    await expect(
      caller.enrichSpruceUp({
        providerKey: MetadataKey.SYNOPSIS,
        books: [{id: 'b-1', title: 'Book', author: 'Author'}],
      }),
    ).rejects.toThrow(/No provider registered/);

    registryMock.getProvider.mockReturnValue({
      isAvailable: () => false,
    });
    await expect(
      caller.enrichSpruceUp({
        providerKey: MetadataKey.SYNOPSIS,
        books: [{id: 'b-1', title: 'Book', author: 'Author'}],
      }),
    ).rejects.toThrow(/currently unavailable/);

    registryMock.getProvider.mockReturnValue({
      isAvailable: () => true,
      bulkFetch: vi.fn().mockResolvedValue({'b-1': 'A great synopsis'}),
    });
    const result = await caller.enrichSpruceUp({
      providerKey: MetadataKey.SYNOPSIS,
      books: [{id: 'b-1', title: 'Book', author: 'Author'}],
    });
    expect(result).toEqual({'b-1': 'A great synopsis'});
  });

  it('delegates searchByIsbn, searchByTitleAndAuthor, searchByTitle, fetchCoverCandidates, and fetchAuthorBio', async () => {
    const caller = metadataRouter.createCaller(userCtx);

    vi.mocked(catalogOrchestrator.searchByIsbn).mockResolvedValue({
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      sources: ['open-library'],
    });
    expect(await caller.searchByIsbn({isbn: '9780441172719'})).toMatchObject({
      title: 'Dune',
    });

    vi.mocked(catalogOrchestrator.searchByQuery).mockResolvedValue({
      books: [
        {
          title: 'Dune',
          author: 'Frank Herbert',
          sources: ['google-books'],
        },
      ],
      sourcesQueried: ['google-books'],
      sourcesSucceeded: ['google-books'],
    });

    expect(
      await caller.searchByTitleAndAuthor({
        title: 'Dune',
        author: 'Frank Herbert',
      }),
    ).toMatchObject({title: 'Dune'});

    expect(await caller.searchByTitle({query: 'Dune', limit: 5})).toHaveLength(
      1,
    );
    expect(catalogOrchestrator.searchByQuery).toHaveBeenLastCalledWith(
      {
        rawQuery: 'Dune',
        limit: 5,
      },
      {
        priority: 'INTERACTIVE',
        verifyCovers: false,
      },
    );

    vi.mocked(catalogOrchestrator.fetchCoverCandidates).mockResolvedValue([
      {
        url: 'https://covers.openlibrary.org/b/id/1-L.jpg',
        sourceId: 'open-library',
        sourceName: 'Open Library',
      },
    ]);
    expect(await caller.fetchCoverCandidates({title: 'Dune'})).toHaveLength(1);

    vi.mocked(wikipediaProvider.fetchAuthorBio).mockResolvedValue(
      'Frank Herbert was an American science-fiction author.',
    );
    expect(await caller.fetchAuthorBio({author: 'Frank Herbert'})).toContain(
      'Frank Herbert',
    );
  });

  it('enforces admin-only access on providerCapacities and debugTelemetry', async () => {
    const nonAdminCaller = metadataRouter.createCaller(userCtx);
    await expect(nonAdminCaller.providerCapacities()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(nonAdminCaller.debugTelemetry()).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    const adminCaller = metadataRouter.createCaller(adminCtx);
    vi.mocked(catalogOrchestrator.inspectAllCapacities).mockReturnValue([]);
    vi.spyOn(serverTelemetryBuffer, 'getSnapshot').mockReturnValue({
      serverTimeMs: 12345,
      entries: [],
      providers: [],
      governor: {
        providers: [],
        activeTotal: 0,
        activeInteractive: 0,
        activeBatch: 0,
        maxGlobalConcurrent: 24,
        reservedInteractiveSlots: 4,
      },
      totals: {
        totalCalls: 0,
        totalErrors: 0,
        totalRateLimits: 0,
        totalGeminiTokens: 0,
      },
    });

    expect(await adminCaller.providerCapacities()).toEqual([]);
    expect(
      (await adminCaller.debugTelemetry({sinceMs: 100})).serverTimeMs,
    ).toBe(12345);
  });
});
