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
  } as any;

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
    } as any);

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
    } as any);
    vi.mocked(enrichmentJobCoordinator.getJobStatus).mockReturnValueOnce({
      activeJob: null,
    } as any);

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
});
