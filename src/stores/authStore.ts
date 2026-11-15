import {create} from 'zustand';
import {
  User,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {auth} from '../firebase';
import {
  clearAuthShellSnapshot,
  clearCachedIdToken,
  createOptimisticShellUser,
  readAuthShellSnapshot,
} from '../lib/authTokenCache';
import {
  resetClientQueryCaches,
  setActivePersistenceUid,
} from '../lib/queryClient';

export interface AuthState {
  user: User | null;
  isAdmin: boolean;
  isAuthReady: boolean;
  isOptimisticShell: boolean;
  isLiveAuthVerified: boolean;
  authError: string | null;
  setUser: (user: User | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setIsAuthReady: (isAuthReady: boolean) => void;
  setAuthError: (authError: string | null) => void;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const initialShellSnapshot =
  typeof window !== 'undefined' ? readAuthShellSnapshot() : null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: initialShellSnapshot
    ? createOptimisticShellUser(initialShellSnapshot, () => auth?.currentUser)
    : null,
  isAdmin: false,
  isAuthReady: Boolean(initialShellSnapshot),
  isOptimisticShell: Boolean(initialShellSnapshot),
  isLiveAuthVerified: false,
  authError: null,

  setUser: user => set({user}),
  setIsAdmin: isAdmin => set({isAdmin}),
  setIsAuthReady: isAuthReady => set({isAuthReady}),
  setAuthError: authError => set({authError}),

  signIn: async () => {
    set({authError: null});
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({
      prompt: 'select_account',
    });
    try {
      await signInWithPopup(auth, provider);
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'auth/cancelled-popup-request' ||
          error.code === 'auth/popup-closed-by-user')
      ) {
        console.log('Login popup closed by user or cancelled.');
        return;
      }
      console.error('Error signing in with Google', error);
      const errorMessage =
        error instanceof Error
          ? error.message
          : 'An error occurred during sign in.';
      set({authError: errorMessage});
    }
  },

  logOut: async () => {
    const previousUid = get().user?.uid;
    try {
      await signOut(auth);
      clearAuthShellSnapshot();
      clearCachedIdToken();
      setActivePersistenceUid(null);
      void resetClientQueryCaches(previousUid);
      set({
        user: null,
        isAdmin: false,
        authError: null,
        isOptimisticShell: false,
        isLiveAuthVerified: true,
      });
    } catch (error) {
      console.error('Error signing out', error);
      throw error;
    }
  },
}));

export const useAuth = useAuthStore;
