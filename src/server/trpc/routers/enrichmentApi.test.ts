import {describe, it, expect, vi, beforeEach} from 'vitest';
import {enrichmentApiRouter} from './enrichmentApi';
import {EnrichmentService} from '../../services/enrichmentService';
import {enrichmentJobCoordinator} from '../../services/enrichmentJobCoordinator';
import {PermissionService} from '../../auth/permissions';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';

vi.mock('../../services/enrichmentService', () => ({
  EnrichmentService: {
    triggerBatchEnrichment: vi.fn(),
  },
}));

vi.mock('../../services/enrichmentJobCoordinator', () => ({
  enrichmentJobCoordinator: {
    startJob: vi.fn(),
    cancelJob: vi.fn(),
    getJobStatus: vi.fn(),
  },
}));

vi.mock('../../auth/permissions', () => ({
  PermissionService: {
    verifyLibraryAccess: vi.fn(),
  },
}));

describe('enrichmentApiRouter', () => {
  const mockCtx = {
    user: {
      uid: 'user-123',
      email: SUPERADMIN_EMAIL,
    },
    isAppAllowed: true,
    isAdmin: true,
  } as unknown as Parameters<typeof enrichmentApiRouter.createCaller>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('triggers batch enrichment with normalized enrichmentType and editor access check', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
      role: 'editor',
      userId: 'user-123',
    });
    vi.mocked(EnrichmentService.triggerBatchEnrichment).mockResolvedValueOnce({
      enrichedCount: 2,
      failedCount: 0,
      results: [],
    } as unknown as Awaited<
      ReturnType<typeof EnrichmentService.triggerBatchEnrichment>
    >);

    const caller = enrichmentApiRouter.createCaller(mockCtx);
    const res = await caller.triggerBatch({
      libraryId: 'lib-1',
      enrichmentType: 'genre',
      bookIds: ['b1', 'b2'],
      overwrite: true,
    });

    expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
      mockCtx.user,
      'lib-1',
      'editor',
    );
    expect(EnrichmentService.triggerBatchEnrichment).toHaveBeenCalledWith(
      'user-123',
      SUPERADMIN_EMAIL,
      {
        libraryId: 'lib-1',
        enrichmentType: 'genre',
        bookIds: ['b1', 'b2'],
        overwrite: true,
        customGenres: undefined,
        allowAiFallback: true,
      },
      {skipAccessCheck: true},
    );
    expect(res).toEqual({
      enrichedCount: 2,
      failedCount: 0,
      results: [],
    });
  });

  it('starts and queries background enrichment jobs via enrichmentJobCoordinator', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValue({
      role: 'editor',
      userId: 'user-123',
    });
    vi.mocked(enrichmentJobCoordinator.startJob).mockResolvedValueOnce({
      jobId: 'job-1',
      status: 'running',
      totalBooks: 2,
    } as unknown as Awaited<
      ReturnType<typeof enrichmentJobCoordinator.startJob>
    >);
    vi.mocked(enrichmentJobCoordinator.getJobStatus).mockReturnValueOnce({
      activeJob: null,
    } as unknown as ReturnType<typeof enrichmentJobCoordinator.getJobStatus>);

    const caller = enrichmentApiRouter.createCaller(mockCtx);
    const startRes = await caller.startJob({
      libraryId: 'lib-1',
      enrichmentType: 'genre',
      bookIds: ['b1', 'b2'],
    });
    expect(startRes.jobId).toBe('job-1');

    const statusRes = await caller.getJobStatus({libraryId: 'lib-1'});
    expect(statusRes).toEqual({activeJob: null});
  });

  it('blocks pure-AI enrichment flows (geo, temporal, genre, embedding) for standard users without AI Plan', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValue({
      role: 'editor',
      userId: 'user-standard',
    });

    const nonAiCtx = {
      user: {
        uid: 'user-standard',
        email: 'reader@example.com',
      },
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: false,
    } as unknown as Parameters<typeof enrichmentApiRouter.createCaller>[0];

    const caller = enrichmentApiRouter.createCaller(nonAiCtx);
    await expect(
      caller.triggerBatch({
        libraryId: 'lib-1',
        enrichmentType: 'geo',
        bookIds: ['b1'],
      }),
    ).rejects.toThrow(/AI Plan required/);
    expect(EnrichmentService.triggerBatchEnrichment).not.toHaveBeenCalled();
  });

  it('allows hybrid catalog enrichment (synopsis, authorBio, series, coverImage) with allowAiFallback: false when hasAiPlan is false', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
      role: 'editor',
      userId: 'user-standard',
    });
    vi.mocked(EnrichmentService.triggerBatchEnrichment).mockResolvedValueOnce({
      enrichedCount: 1,
      failedCount: 0,
      results: [],
    } as unknown as Awaited<
      ReturnType<typeof EnrichmentService.triggerBatchEnrichment>
    >);

    const nonAiCtx = {
      user: {
        uid: 'user-standard',
        email: 'reader@example.com',
      },
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: false,
    } as unknown as Parameters<typeof enrichmentApiRouter.createCaller>[0];

    const caller = enrichmentApiRouter.createCaller(nonAiCtx);
    await caller.triggerBatch({
      libraryId: 'lib-1',
      enrichmentType: 'synopsis',
      bookIds: ['b1'],
    });

    expect(EnrichmentService.triggerBatchEnrichment).toHaveBeenCalledWith(
      'user-standard',
      'reader@example.com',
      expect.objectContaining({
        libraryId: 'lib-1',
        enrichmentType: 'synopsis',
        allowAiFallback: false,
      }),
      {skipAccessCheck: true},
    );
  });
});
