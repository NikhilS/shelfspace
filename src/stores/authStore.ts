import {create} from 'zustand';
import {
  User,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {auth} from '../firebase';

export interface AuthState {
  user: User | null;
  isAdmin: boolean;
  isAuthReady: boolean;
  authError: string | null;
  setUser: (user: User | null) => void;
  setIsAdmin: (isAdmin: boolean) => void;
  setIsAuthReady: (isAuthReady: boolean) => void;
  setAuthError: (authError: string | null) => void;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>(set => ({
  user: null,
  isAdmin: false,
  isAuthReady: false,
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
    try {
      await signOut(auth);
      set({user: null, authError: null});
    } catch (error) {
      console.error('Error signing out', error);
      throw error;
    }
  },
}));

export const useAuth = useAuthStore;
