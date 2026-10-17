import {onAuthStateChanged, signOut} from 'firebase/auth';
import {auth} from '../firebase';
import {useAuthStore, AuthState} from '../stores/authStore';
import {trpcVanilla} from '../lib/trpc';

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
  console.info('[auth] Initializing Firebase Auth listener...');

  // Safety timeout: Ensure UI unblocks even if network latency or iframe constraints delay Firebase Auth
  const fallbackTimer = setTimeout(() => {
    const state = useAuthStore.getState();
    if (!state.isAuthReady) {
      console.warn(
        '[auth] Firebase Auth state did not resolve within 1500ms; unblocking UI via safety fallback timer.',
      );
      updateAuthState({
        isAuthReady: true,
      });
    }
  }, 1500);

  const unsubscribe = onAuthStateChanged(
    auth,
    currentUser => {
      clearTimeout(fallbackTimer);
      void (async () => {
        try {
          if (currentUser) {
            console.info(
              `[auth] User session resolved: ${currentUser.email || currentUser.uid} (verified=${currentUser.emailVerified})`,
            );
            if (!currentUser.emailVerified) {
              console.warn(
                `[auth] Signing out unverified user: ${currentUser.email || currentUser.uid}`,
              );
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
                  await trpcVanilla.user.syncProfile.mutate({
                    uid: currentUser.uid,
                    email: currentUser.email || '',
                    displayName: currentUser.displayName || '',
                    photoURL: currentUser.photoURL || '',
                  });
                  sessionStorage.setItem(sessionSyncKey, '1');
                } catch (error) {
                  console.warn(
                    '[auth] Background user document sync failed:',
                    error,
                  );
                }
              })();
            }
          } else {
            console.info('[auth] No active user session (unauthenticated).');
            updateAuthState({user: null, authError: null, isAuthReady: true});
          }
        } catch (err) {
          console.warn(
            '[auth] Error during auth state change processing:',
            err,
          );
          updateAuthState({
            user: null,
            isAuthReady: true,
          });
        }
      })();
    },
    err => {
      clearTimeout(fallbackTimer);
      console.warn('[auth] Firebase Auth observer error:', err);
      updateAuthState({
        user: null,
        isAuthReady: true,
      });
    },
  );

  return unsubscribe;
}
