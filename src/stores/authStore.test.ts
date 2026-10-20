import {describe, it, expect, vi, beforeEach} from 'vitest';
import {useAuthStore} from './authStore';
import {signInWithPopup, signOut, User} from 'firebase/auth';

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: class {
    setCustomParameters = vi.fn();
  },
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../firebase', () => ({
  auth: {},
}));

describe('useAuthStore Zustand store unit suite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({
      user: null,
      isAdmin: false,
      isAuthReady: false,
      authError: null,
    });
  });

  it('updates state via setUser, setIsAdmin, setIsAuthReady, and setAuthError', () => {
    const fakeUser = {uid: 'u-1', email: 'reader@example.com'} as User;
    useAuthStore.getState().setUser(fakeUser);
    useAuthStore.getState().setIsAdmin(true);
    useAuthStore.getState().setIsAuthReady(true);
    useAuthStore.getState().setAuthError('Test error');

    const state = useAuthStore.getState();
    expect(state.user).toBe(fakeUser);
    expect(state.isAdmin).toBe(true);
    expect(state.isAuthReady).toBe(true);
    expect(state.authError).toBe('Test error');
  });

  it('ignores popup-closed-by-user during signIn and records unexpected errors', async () => {
    vi.mocked(signInWithPopup).mockRejectedValueOnce({
      code: 'auth/popup-closed-by-user',
    });
    await useAuthStore.getState().signIn();
    expect(useAuthStore.getState().authError).toBeNull();

    vi.mocked(signInWithPopup).mockRejectedValueOnce(
      new Error('Network auth failure'),
    );
    await useAuthStore.getState().signIn();
    expect(useAuthStore.getState().authError).toBe('Network auth failure');
  });

  it('clears user and admin state on logOut', async () => {
    useAuthStore.setState({
      user: {uid: 'u-1'} as User,
      isAdmin: true,
      authError: 'old error',
    });
    vi.mocked(signOut).mockResolvedValueOnce(undefined);

    await useAuthStore.getState().logOut();
    expect(useAuthStore.getState().user).toBeNull();
    expect(useAuthStore.getState().isAdmin).toBe(false);
    expect(useAuthStore.getState().authError).toBeNull();
  });
});
