import {create} from 'zustand';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
} from 'firebase/auth';
import {doc, setDoc, getDoc, serverTimestamp} from 'firebase/firestore';
import {auth, db, handleFirestoreError, OperationType} from '../firebase';

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
    } catch (error) {
      console.error('Error signing in with Google', error);
      throw error;
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
      set({user: currentUser, authError: null});

      if (currentUser) {
        if (!currentUser.emailVerified) {
          await signOut(auth);
          set({
            authError: 'Please verify your email to access this app.',
            isAuthReady: true,
          });
          return;
        }

        try {
          // Ensure user document exists
          const userRef = doc(db, 'users', currentUser.uid);
          const userSnap = await getDoc(userRef);
          if (!userSnap.exists()) {
            await setDoc(userRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName || '',
              photoURL: currentUser.photoURL || '',
              createdAt: serverTimestamp(),
            });
          }
        } catch (error) {
          console.error('Error ensuring user document:', error);
          handleFirestoreError(
            error,
            OperationType.GET,
            `users/${currentUser.uid}`,
          );
        }
      }

      set({isAuthReady: true});
    });

    return unsubscribe;
  },
}));

export const useAuth = useAuthStore;
