import {describe, it, expect, vi, beforeEach} from 'vitest';
import {userRouter} from './user';
import {UserService} from '../../services/userService';
import type {SecurityContext} from '../../auth/types';

vi.mock('../../services/userService', () => ({
  UserService: {
    syncProfile: vi.fn(),
  },
}));

const userCtx: SecurityContext = {
  req: {} as SecurityContext['req'],
  res: {} as SecurityContext['res'],
  user: {
    uid: 'user-123',
    email: 'reader@example.com',
    displayName: 'Reader One',
    photoURL: 'https://example.com/avatar.png',
  },
  isAdmin: false,
  isAppAllowed: true,
};

const unauthCtx: SecurityContext = {
  req: {} as SecurityContext['req'],
  res: {} as SecurityContext['res'],
  user: null,
  isAdmin: false,
  isAppAllowed: false,
};

describe('userRouter tRPC procedures & security boundaries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated callers with UNAUTHORIZED', async () => {
    const caller = userRouter.createCaller(unauthCtx);
    await expect(
      caller.syncProfile({displayName: 'Anon'}),
    ).rejects.toMatchObject({code: 'UNAUTHORIZED'});
  });

  it('syncs the authenticated user profile using ctx.user.uid even if a spoofed uid is passed', async () => {
    vi.mocked(UserService.syncProfile).mockResolvedValue({success: true});
    const caller = userRouter.createCaller(userCtx);

    const res = await caller.syncProfile({
      uid: 'other-user-999',
      displayName: 'Updated Name',
    });
    expect(res).toEqual({success: true});
    expect(UserService.syncProfile).toHaveBeenCalledWith({
      uid: 'user-123',
      email: 'reader@example.com',
      displayName: 'Updated Name',
      photoURL: 'https://example.com/avatar.png',
    });
  });
});
