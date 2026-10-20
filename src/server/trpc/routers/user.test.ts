import {describe, it, expect, vi, beforeEach} from 'vitest';
import {userRouter} from './user';
import {UserService} from '../../services/userService';
import type {SecurityContext} from '../../auth/types';

vi.mock('../../services/userService', () => ({
  UserService: {
    syncProfile: vi.fn(),
    getProfile: vi.fn(),
  },
}));

const userCtx: SecurityContext = {
  user: {
    uid: 'user-123',
    email: 'reader@example.com',
    displayName: 'Reader One',
    photoURL: 'https://example.com/avatar.png',
  },
  isAdmin: false,
  isAppAllowed: true,
};

const adminCtx: SecurityContext = {
  user: {
    uid: 'admin-1',
    email: 'admin@example.com',
  },
  isAdmin: true,
  isAppAllowed: true,
};

describe('userRouter tRPC procedures & IDOR protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs the authenticated user profile using ctx.user.uid', async () => {
    vi.mocked(UserService.syncProfile).mockResolvedValue({success: true});
    const caller = userRouter.createCaller(userCtx);

    const res = await caller.syncProfile({displayName: 'Updated Name'});
    expect(res).toEqual({success: true});
    expect(UserService.syncProfile).toHaveBeenCalledWith({
      uid: 'user-123',
      email: 'reader@example.com',
      displayName: 'Updated Name',
      photoURL: 'https://example.com/avatar.png',
    });
  });

  it('allows self profile lookup and blocks non-admin cross-user lookup (IDOR protection)', async () => {
    vi.mocked(UserService.getProfile).mockResolvedValue({
      uid: 'user-123',
      email: 'reader@example.com',
    });
    const caller = userRouter.createCaller(userCtx);

    // Implicit self lookup
    expect(await caller.getProfile()).toEqual({
      uid: 'user-123',
      email: 'reader@example.com',
    });

    // Cross-user lookup by non-admin throws FORBIDDEN
    await expect(
      caller.getProfile({uid: 'other-user-999'}),
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });

    // Admin can inspect another user profile
    const adminCaller = userRouter.createCaller(adminCtx);
    await adminCaller.getProfile({uid: 'other-user-999'});
    expect(UserService.getProfile).toHaveBeenLastCalledWith('other-user-999');
  });
});
