import {describe, it, expect, vi, beforeEach} from 'vitest';
import {PermissionService} from './permissions';
import {LibraryService} from '../services/library';

vi.mock('../services/library', () => ({
  LibraryService: {
    verifyLibraryAccess: vi.fn(),
  },
}));

describe('PermissionService server RBAC unit suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws UNAUTHORIZED when user or user.uid is missing', async () => {
    await expect(
      PermissionService.verifyLibraryAccess(null, 'lib-1'),
    ).rejects.toMatchObject({code: 'UNAUTHORIZED'});

    await expect(
      PermissionService.verifyLibraryAccess({uid: ''}, 'lib-1'),
    ).rejects.toMatchObject({code: 'UNAUTHORIZED'});
  });

  it('delegates verifyLibraryAccess, verifyLibraryWriteAccess, and verifyLibraryReadAccess with required roles', async () => {
    vi.mocked(LibraryService.verifyLibraryAccess).mockResolvedValue({
      role: 'editor',
      userId: 'u-1',
    });

    const user = {uid: 'u-1', email: 'editor@example.com'};

    await PermissionService.verifyLibraryReadAccess('lib-1', user);
    expect(LibraryService.verifyLibraryAccess).toHaveBeenLastCalledWith(
      'u-1',
      'editor@example.com',
      'lib-1',
      'viewer',
    );

    await PermissionService.verifyLibraryWriteAccess('lib-1', user);
    expect(LibraryService.verifyLibraryAccess).toHaveBeenLastCalledWith(
      'u-1',
      'editor@example.com',
      'lib-1',
      'editor',
    );
  });

  it('evaluates role hierarchy accurately via hasSufficientRole', () => {
    expect(PermissionService.hasSufficientRole('owner', 'owner')).toBe(true);
    expect(PermissionService.hasSufficientRole('owner', 'editor')).toBe(true);
    expect(PermissionService.hasSufficientRole('owner', 'viewer')).toBe(true);

    expect(PermissionService.hasSufficientRole('editor', 'owner')).toBe(false);
    expect(PermissionService.hasSufficientRole('editor', 'editor')).toBe(true);
    expect(PermissionService.hasSufficientRole('editor', 'viewer')).toBe(true);

    expect(PermissionService.hasSufficientRole('viewer', 'owner')).toBe(false);
    expect(PermissionService.hasSufficientRole('viewer', 'editor')).toBe(false);
    expect(PermissionService.hasSufficientRole('viewer', 'viewer')).toBe(true);
  });
});
