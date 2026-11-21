import {describe, it, expect, vi, beforeEach} from 'vitest';
import {metadataRouter} from './metadata';
import {catalogOrchestrator} from '../../services/catalog';
import {serverTelemetryBuffer} from '../../services/telemetry/serverTelemetryBuffer';
import type {SecurityContext} from '../../auth/types';

vi.mock('../../services/catalog', () => ({
  catalogOrchestrator: {
    searchByIsbn: vi.fn(),
    searchByQuery: vi.fn(),
    fetchCoverCandidates: vi.fn(),
    inspectAllCapacities: vi.fn(),
  },
}));

const userCtx: SecurityContext = {
  req: {} as SecurityContext['req'],
  res: {} as SecurityContext['res'],
  user: {uid: 'user-1', email: 'reader@example.com'},
  isAdmin: false,
  isAppAllowed: true,
};

const adminCtx: SecurityContext = {
  req: {} as SecurityContext['req'],
  res: {} as SecurityContext['res'],
  user: {uid: 'admin-1', email: 'admin@example.com'},
  isAdmin: true,
  isAppAllowed: true,
};

describe('metadataRouter tRPC procedures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates searchByIsbn, searchByTitleAndAuthor, searchByTitle, and fetchCoverCandidates', async () => {
    const caller = metadataRouter.createCaller(userCtx);

    vi.mocked(catalogOrchestrator.searchByIsbn).mockResolvedValue({
      title: 'Dune',
      author: 'Frank Herbert',
      isbn: '9780441172719',
      coverUrl: '',
      publishedDate: '1965',
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
          isbn: '9780441172719',
          coverUrl: '',
          publishedDate: '1965',
          sources: ['google-books'],
        },
      ],
      skippedProviders: [],
      respondedProviders: ['google-books'],
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

    vi.mocked(catalogOrchestrator.fetchCoverCandidates).mockResolvedValue({
      candidates: [
        {
          url: 'https://covers.openlibrary.org/b/id/1-L.jpg',
          source: 'Open Library',
        },
      ],
      skippedProviders: [],
      respondedProviders: ['Open Library'],
    });
    expect(
      (await caller.fetchCoverCandidates({title: 'Dune'})).candidates,
    ).toHaveLength(1);
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
