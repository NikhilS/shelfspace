import {describe, it, expect, vi, beforeEach} from 'vitest';
import {libraryApiRouter} from './libraryApi';
import {LibraryService} from '../../services/library';
import {PermissionService} from '../../auth/permissions';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';

vi.mock('../../services/library', () => ({
  LibraryService: {
    getUserLibraries: vi.fn(),
    resetMetadata: vi.fn(),
    upsertCollaborator: vi.fn(),
    removeCollaborator: vi.fn(),
    getCollaboratorStatuses: vi.fn(),
    listAllowedDuplicates: vi.fn(),
    allowDuplicateGroup: vi.fn(),
  },
}));

vi.mock('../../auth/permissions', () => ({
  PermissionService: {
    verifyLibraryAccess: vi.fn(),
  },
}));

vi.mock('../../services/enrichmentService', () => ({
  EnrichmentService: {
    triggerBatchEnrichment: vi.fn(),
  },
}));

describe('libraryApiRouter', () => {
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

  it('calls LibraryService.getUserLibraries and returns libraries', async () => {
    const mockLibraries = [
      {
        id: 'lib-1',
        name: 'My Library',
        ownerId: 'user-123',
        callerRole: 'owner' as const,
      },
    ];
    vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
      libraries: mockLibraries as any,
    });

    const caller = libraryApiRouter.createCaller(mockCtx);
    const res = await caller.list({});

    expect(LibraryService.getUserLibraries).toHaveBeenCalledWith(
      'user-123',
      SUPERADMIN_EMAIL,
      ['owned', 'shared'],
      true,
    );
    expect(res).toEqual({libraries: mockLibraries});
  });

  it('passes specific scopes to LibraryService.getUserLibraries', async () => {
    vi.mocked(LibraryService.getUserLibraries).mockResolvedValue({
      libraries: [],
    });

    const caller = libraryApiRouter.createCaller(mockCtx);
    await caller.list({scopes: ['all']});

    expect(LibraryService.getUserLibraries).toHaveBeenCalledWith(
      'user-123',
      SUPERADMIN_EMAIL,
      ['all'],
      true,
    );
  });

  it('calls LibraryService.upsertCollaborator with owner role check', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValueOnce({
      role: 'owner',
      userId: 'user-123',
    });
    vi.mocked(LibraryService.upsertCollaborator).mockResolvedValueOnce({
      success: true,
      email: 'friend@example.com',
      role: 'viewer',
      allowlistStatus: 'pending_approval',
    });

    const caller = libraryApiRouter.createCaller(mockCtx);
    const res = await caller.upsertCollaborator({
      libraryId: 'lib-1',
      email: 'friend@example.com',
      role: 'viewer',
    });

    expect(PermissionService.verifyLibraryAccess).toHaveBeenCalledWith(
      mockCtx.user,
      'lib-1',
      'owner',
    );
    expect(LibraryService.upsertCollaborator).toHaveBeenCalledWith(
      'user-123',
      SUPERADMIN_EMAIL,
      'lib-1',
      'friend@example.com',
      'viewer',
      {skipAccessCheck: true},
    );
    expect(res.allowlistStatus).toBe('pending_approval');
  });

  it('calls LibraryService.listAllowedDuplicates and allowDuplicateGroup with correct libraryId and bookIds', async () => {
    vi.mocked(PermissionService.verifyLibraryAccess).mockResolvedValue({
      role: 'editor',
      userId: 'user-123',
    });
    vi.mocked(LibraryService.listAllowedDuplicates).mockResolvedValueOnce({
      groups: [],
    });
    vi.mocked(LibraryService.allowDuplicateGroup).mockResolvedValueOnce({
      success: true,
      id: 'dup-1',
    });

    const caller = libraryApiRouter.createCaller(mockCtx);
    await caller.listAllowedDuplicates({libraryId: 'lib-1'});
    expect(LibraryService.listAllowedDuplicates).toHaveBeenCalledWith('lib-1');

    await caller.allowDuplicateGroup({
      libraryId: 'lib-1',
      bookIds: ['b1', 'b2'],
    });
    expect(LibraryService.allowDuplicateGroup).toHaveBeenCalledWith('lib-1', [
      'b1',
      'b2',
    ]);
  });
});
