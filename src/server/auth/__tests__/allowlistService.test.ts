import {describe, it, expect, vi, beforeEach} from 'vitest';
import {AllowlistService} from '../allowlistService';
import {SUPERADMIN_EMAIL} from '../../../constants/auth';
import admin from 'firebase-admin';

const mockDocGet = vi.fn();
const mockDoc = vi.fn((_path: string) => ({
  get: mockDocGet,
}));
const mockFirestore = vi.fn(() => ({
  doc: mockDoc,
}));

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => mockFirestore(),
  },
}));

vi.mock('../../../services/server/firebaseAdmin', () => ({
  getAdminDb: () => mockFirestore(),
}));

describe('AllowlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocGet.mockReset();
    AllowlistService.clearCache();
  });

  it('returns isAppAllowed: true, isAdmin: true for superadmin email without querying DB', async () => {
    const res = await AllowlistService.getPermissions(SUPERADMIN_EMAIL);
    expect(res).toEqual({isAppAllowed: true, isAdmin: true});
    expect(mockDoc).not.toHaveBeenCalled();
  });

  it('returns isAppAllowed: false, isAdmin: false for empty or null email', async () => {
    const res1 = await AllowlistService.getPermissions(null);
    expect(res1).toEqual({isAppAllowed: false, isAdmin: false});

    const res2 = await AllowlistService.getPermissions('');
    expect(res2).toEqual({isAppAllowed: false, isAdmin: false});
    expect(mockDoc).not.toHaveBeenCalled();
  });

  it('queries Firestore for regular user and returns permissions', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({role: 'user'}),
    });

    const res = await AllowlistService.getPermissions('reader@example.com');
    expect(res).toEqual({isAppAllowed: true, isAdmin: false});
    expect(mockDoc).toHaveBeenCalledWith(
      'appSettings/allowlist/users/reader@example.com',
    );
  });

  it('identifies admin users when role is admin', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({role: 'admin'}),
    });

    const res = await AllowlistService.getPermissions('admin@example.com');
    expect(res).toEqual({isAppAllowed: true, isAdmin: true});
  });

  it('returns not allowed if user document does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: false,
    });

    const res = await AllowlistService.getPermissions('stranger@example.com');
    expect(res).toEqual({isAppAllowed: false, isAdmin: false});
  });

  it('caches permissions in-memory and avoids repeated DB lookups', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({role: 'user'}),
    });

    const res1 = await AllowlistService.getPermissions('cached@example.com');
    expect(res1).toEqual({isAppAllowed: true, isAdmin: false});
    expect(mockDocGet).toHaveBeenCalledTimes(1);

    // Second call should hit in-memory cache
    const res2 = await AllowlistService.getPermissions('cached@example.com');
    expect(res2).toEqual({isAppAllowed: true, isAdmin: false});
    expect(mockDocGet).toHaveBeenCalledTimes(1);
  });

  it('allows manual cache setting via setCache and clearing via clearCache', async () => {
    AllowlistService.setCache('manual@example.com', {
      isAppAllowed: true,
      isAdmin: true,
    });

    const res1 = await AllowlistService.getPermissions('manual@example.com');
    expect(res1).toEqual({isAppAllowed: true, isAdmin: true});
    expect(mockDocGet).not.toHaveBeenCalled();

    AllowlistService.clearCache();
    mockDocGet.mockResolvedValueOnce({
      exists: false,
    });

    const res2 = await AllowlistService.getPermissions('manual@example.com');
    expect(res2).toEqual({isAppAllowed: false, isAdmin: false});
    expect(mockDocGet).toHaveBeenCalledTimes(1);
  });
});
