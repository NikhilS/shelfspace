import {create} from 'zustand';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {doc, setDoc, getDoc, serverTimestamp} from 'firebase/firestore';
import {auth, db} from '../firebase';

interface AuthState {
  user: User | null;
  isAdmin: boolean;
  isAuthReady: boolean;
  authError: string | null;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
  _initialize: () => () => void;
}

export const useAuthStore = create<AuthState>(set => ({
  user: null,
  isAdmin: false,
  isAuthReady: false,
  authError: null,

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
    } catch (error) {
      console.error('Error signing out', error);
      throw error;
    }
  },

  _initialize: () => {
    const unsubscribe = onAuthStateChanged(auth, async currentUser => {
      try {
        if (currentUser) {
          if (!currentUser.emailVerified) {
            await signOut(auth);
            set({
              user: null,
              authError: 'Please verify your email to access this app.',
              isAuthReady: true,
            });
            return;
          }

          // Unblock app render immediately with the authenticated user
          set({user: currentUser, authError: null, isAuthReady: true});

          // Ensure user document exists in the background without blocking the critical load path
          const sessionSyncKey = `user_doc_synced_${currentUser.uid}`;
          if (!sessionStorage.getItem(sessionSyncKey)) {
            void (async () => {
              try {
                const userRef = doc(db, 'users', currentUser.uid);
                const userSnap = await getDoc(userRef);
                if (!userSnap.exists()) {
                  await setDoc(userRef, {
                    uid: currentUser.uid,
                    email: currentUser.email || '',
                    displayName: currentUser.displayName || '',
                    photoURL: currentUser.photoURL || '',
                    createdAt: serverTimestamp(),
                  });
                }
                sessionStorage.setItem(sessionSyncKey, '1');
              } catch (error) {
                console.warn('Background user document sync failed:', error);
              }
            })();
          }
        } else {
          set({user: null, authError: null, isAuthReady: true});
        }
      } catch (err) {
        console.error('Error during auth state change processing:', err);
        set({isAuthReady: true});
      }
    });

    return unsubscribe;
  },
}));

export const useAuth = useAuthStore;
