import {describe, it, expect, vi, beforeEach} from 'vitest';
import {UserService} from './userService';
import {getAdminDb} from './firebaseAdmin';

vi.mock('./firebaseAdmin', () => ({
  getAdminDb: vi.fn(),
  formatFirestoreAdminError: (err: unknown) => String(err),
}));

describe('UserService unit suite', () => {
  const getMock = vi.fn();
  const setMock = vi.fn();
  const updateMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAdminDb).mockReturnValue({
      collection: vi.fn(() => ({
        doc: vi.fn(() => ({
          get: getMock,
          set: setMock,
          update: updateMock,
        })),
      })),
    } as unknown as ReturnType<typeof getAdminDb>);
  });

  it('creates a new user document when none exists and updates when it already exists', async () => {
    // 1. Missing uid returns early
    expect(await UserService.syncProfile({uid: ''})).toEqual({success: true});
    expect(getMock).not.toHaveBeenCalled();

    // 2. New user -> set()
    getMock.mockResolvedValueOnce({exists: false});
    await UserService.syncProfile({
      uid: 'u-1',
      email: 'u1@example.com',
      displayName: 'User 1',
    });
    expect(setMock).toHaveBeenCalledTimes(1);
    expect(setMock.mock.calls[0][0]).toMatchObject({
      uid: 'u-1',
      email: 'u1@example.com',
      displayName: 'User 1',
    });

    // 3. Existing user -> update()
    getMock.mockResolvedValueOnce({exists: true});
    await UserService.syncProfile({
      uid: 'u-1',
      email: 'u1@example.com',
      displayName: 'User 1 Updated',
    });
    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock.mock.calls[0][0]).toMatchObject({
      email: 'u1@example.com',
      displayName: 'User 1 Updated',
    });
  });

  it('handles Firestore errors gracefully in syncProfile and getProfile', async () => {
    getMock.mockRejectedValueOnce(new Error('Firestore offline'));
    expect(await UserService.syncProfile({uid: 'u-1'})).toEqual({
      success: true,
    });

    getMock.mockResolvedValueOnce({exists: false});
    expect(await UserService.getProfile('u-missing')).toBeNull();

    getMock.mockResolvedValueOnce({
      exists: true,
      id: 'u-1',
      data: () => ({email: 'u1@example.com'}),
    });
    expect(await UserService.getProfile('u-1')).toEqual({
      uid: 'u-1',
      email: 'u1@example.com',
    });

    getMock.mockRejectedValueOnce(new Error('Read error'));
    expect(await UserService.getProfile('u-1')).toBeNull();
  });
});
