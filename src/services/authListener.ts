import {onAuthStateChanged, signOut} from 'firebase/auth';
import {auth} from '../firebase';
import {useAuthStore, AuthState} from '../stores/authStore';

function updateAuthState(partial: Partial<AuthState>) {
  if (useAuthStore && typeof useAuthStore.setState === 'function') {
    useAuthStore.setState(partial);
  }
}

/**
 * Initializes the Firebase Auth state listener and synchronizes user profiles.
 * Keeps side-effects cleanly isolated from the pure Zustand store definition.
 */
export function initAuthListener(): () => void {
  // Safety timeout: Ensure UI unblocks even if network latency or iframe constraints delay Firebase Auth
  const fallbackTimer = setTimeout(() => {
    const state = useAuthStore.getState();
    if (!state.isAuthReady) {
      updateAuthState({isAuthReady: true});
    }
  }, 2500);

  const unsubscribe = onAuthStateChanged(auth, async currentUser => {
    clearTimeout(fallbackTimer);
    try {
      if (currentUser) {
        if (!currentUser.emailVerified) {
          await signOut(auth);
          updateAuthState({
            user: null,
            authError: 'Please verify your email to access this app.',
            isAuthReady: true,
          });
          return;
        }

        // Unblock app render immediately with the authenticated user
        updateAuthState({
          user: currentUser,
          authError: null,
          isAuthReady: true,
        });

        // Ensure user document exists in the background without blocking the critical load path
        const sessionSyncKey = `user_doc_synced_${currentUser.uid}`;
        if (
          typeof sessionStorage !== 'undefined' &&
          !sessionStorage.getItem(sessionSyncKey)
        ) {
          void (async () => {
            try {
              const {trpcVanilla} = await import('../lib/trpc');
              await trpcVanilla.user.syncProfile.mutate({
                uid: currentUser.uid,
                email: currentUser.email || '',
                displayName: currentUser.displayName || '',
                photoURL: currentUser.photoURL || '',
              });
              sessionStorage.setItem(sessionSyncKey, '1');
            } catch (error) {
              console.warn('Background user document sync failed:', error);
            }
          })();
        }
      } else {
        updateAuthState({user: null, authError: null, isAuthReady: true});
      }
    } catch (err) {
      console.error('Error during auth state change processing:', err);
      updateAuthState({isAuthReady: true});
    }
  });

  return unsubscribe;
}
