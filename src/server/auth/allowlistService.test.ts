import {describe, it, expect, vi, beforeEach} from 'vitest';
import {AllowlistService} from './allowlistService';
import {SUPERADMIN_EMAIL} from '../../constants/auth';

const mockDocGet = vi.fn();
const mockDocSet = vi.fn();
const mockGetAll = vi.fn(
  async (...refs: Array<{get: () => Promise<unknown>}>) =>
    Promise.all(refs.map(r => r.get())),
);
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn(() => ({
  get: mockDocGet,
  set: mockDocSet,
}));
const mockFirestore = vi.fn(() => ({
  doc: mockDoc,
  collection: vi.fn(() => ({
    doc: mockDoc,
  })),
  getAll: mockGetAll,
  batch: () => ({
    set: mockBatchSet,
    commit: mockBatchCommit,
  }),
}));

vi.mock('firebase-admin', () => ({
  default: {
    firestore: () => mockFirestore(),
  },
}));

vi.mock('../services/firebaseAdmin', () => ({
  getAdminDb: () => mockFirestore(),
  FieldValue: {
    serverTimestamp: () => 'MOCK_TIMESTAMP',
  },
}));

describe('AllowlistService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDocGet.mockReset();
    mockGetAll.mockClear();
    AllowlistService.clearCache();
  });

  it('returns isAppAllowed: true, isAdmin: true, hasAiPlan: true for superadmin email without querying DB', async () => {
    const res = await AllowlistService.getPermissions(SUPERADMIN_EMAIL);
    expect(res).toEqual({
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
    });
    expect(mockDoc).not.toHaveBeenCalled();
  });

  it('returns isAppAllowed: false, isAdmin: false, hasAiPlan: false for empty or null email', async () => {
    const res1 = await AllowlistService.getPermissions(null);
    expect(res1).toEqual({
      isAppAllowed: false,
      isAdmin: false,
      hasAiPlan: false,
    });

    const res2 = await AllowlistService.getPermissions('');
    expect(res2).toEqual({
      isAppAllowed: false,
      isAdmin: false,
      hasAiPlan: false,
    });
    expect(mockDoc).not.toHaveBeenCalled();
  });

  it('queries Firestore for regular user and returns permissions with default hasAiPlan: false', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({role: 'user'}),
    });

    const res = await AllowlistService.getPermissions('reader@example.com');
    expect(res).toEqual({
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: false,
    });
    expect(mockDoc).toHaveBeenCalledWith(
      'appSettings/allowlist/users/reader@example.com',
    );
  });

  it('returns hasAiPlan: true for regular user when hasAiPlan is enabled on document', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({role: 'user', hasAiPlan: true}),
    });

    const res = await AllowlistService.getPermissions('ai-reader@example.com');
    expect(res).toEqual({
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: true,
    });
  });

  it('identifies admin users when role is admin and grants hasAiPlan: true', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({role: 'admin'}),
    });

    const res = await AllowlistService.getPermissions('admin@example.com');
    expect(res).toEqual({
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
    });
  });

  it('returns not allowed if user document does not exist', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: false,
    });

    const res = await AllowlistService.getPermissions('stranger@example.com');
    expect(res).toEqual({
      isAppAllowed: false,
      isAdmin: false,
      hasAiPlan: false,
    });
  });

  it('caches permissions in-memory and avoids repeated DB lookups', async () => {
    mockDocGet.mockResolvedValueOnce({
      exists: true,
      data: () => ({role: 'user'}),
    });

    const res1 = await AllowlistService.getPermissions('cached@example.com');
    expect(res1).toEqual({
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: false,
    });
    expect(mockDocGet).toHaveBeenCalledTimes(1);

    // Second call should hit in-memory cache
    const res2 = await AllowlistService.getPermissions('cached@example.com');
    expect(res2).toEqual({
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: false,
    });
    expect(mockDocGet).toHaveBeenCalledTimes(1);
  });

  it('allows manual cache setting via setCache and clearing via clearCache', async () => {
    AllowlistService.setCache('manual@example.com', {
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
    });

    const res1 = await AllowlistService.getPermissions('manual@example.com');
    expect(res1).toEqual({
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
    });
    expect(mockDocGet).not.toHaveBeenCalled();

    AllowlistService.clearCache();
    mockDocGet.mockResolvedValueOnce({
      exists: false,
    });

    const res2 = await AllowlistService.getPermissions('manual@example.com');
    expect(res2).toEqual({
      isAppAllowed: false,
      isAdmin: false,
      hasAiPlan: false,
    });
    expect(mockDocGet).toHaveBeenCalledTimes(1);
  });

  it('resolves permissions in bulk via getPermissionsBulk using L1 cache and a single db.getAll call for misses', async () => {
    AllowlistService.setCache('cached@example.com', {
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: true,
    });

    mockGetAll.mockResolvedValueOnce([
      {
        exists: true,
        data: () => ({role: 'admin'}),
      },
      {
        exists: false,
      },
    ]);

    const resultMap = await AllowlistService.getPermissionsBulk([
      SUPERADMIN_EMAIL,
      'cached@example.com',
      'admin-miss@example.com',
      'stranger-miss@example.com',
    ]);

    expect(mockGetAll).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledTimes(2);
    expect(resultMap.get(SUPERADMIN_EMAIL.toLowerCase().trim())).toEqual({
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
    });
    expect(resultMap.get('cached@example.com')).toEqual({
      isAppAllowed: true,
      isAdmin: false,
      hasAiPlan: true,
    });
    expect(resultMap.get('admin-miss@example.com')).toEqual({
      isAppAllowed: true,
      isAdmin: true,
      hasAiPlan: true,
    });
    expect(resultMap.get('stranger-miss@example.com')).toEqual({
      isAppAllowed: false,
      isAdmin: false,
      hasAiPlan: false,
    });
  });
});
