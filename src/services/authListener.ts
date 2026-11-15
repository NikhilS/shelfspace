import {onAuthStateChanged, signOut, type User} from 'firebase/auth';
import {auth} from '../firebase';
import {
  clearAuthShellSnapshot,
  clearCachedIdToken,
  initAuthTokenCacheListener,
  markLiveAuthResolved,
  readAuthShellSnapshot,
  writeAuthShellSnapshot,
} from '../lib/authTokenCache';
import {
  resetClientQueryCaches,
  setActivePersistenceUid,
} from '../lib/queryClient';
import {trpcVanilla} from '../lib/trpc';
import {useAuthStore, AuthState} from '../stores/authStore';

const PROFILE_FINGERPRINT_PREFIX = 'bookish_profile_fp_';

function updateAuthState(partial: Partial<AuthState>): void {
  if (useAuthStore && typeof useAuthStore.setState === 'function') {
    useAuthStore.setState(partial);
  }
}

function buildProfileFingerprint(user: User): string {
  return `${user.email || ''}|${user.displayName || ''}|${user.photoURL || ''}`;
}

function hasSyncedMatchingProfile(user: User, fingerprint: string): boolean {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const saved = window.localStorage.getItem(
        `${PROFILE_FINGERPRINT_PREFIX}${user.uid}`,
      );
      if (saved === fingerprint) {
        return true;
      }
    }
    if (typeof sessionStorage !== 'undefined') {
      return Boolean(sessionStorage.getItem(`user_doc_synced_${user.uid}`));
    }
    return false;
  } catch {
    return false;
  }
}

function recordSyncedProfileFingerprint(
  uid: string,
  fingerprint: string,
): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(
        `${PROFILE_FINGERPRINT_PREFIX}${uid}`,
        fingerprint,
      );
    }
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(`user_doc_synced_${uid}`, '1');
    }
  } catch {
    // Ignore storage quota errors
  }
}

function scheduleIdleProfileSync(currentUser: User): void {
  const fingerprint = buildProfileFingerprint(currentUser);
  if (hasSyncedMatchingProfile(currentUser, fingerprint)) {
    return;
  }

  const syncUserProfile = async () => {
    try {
      await trpcVanilla.user.syncProfile.mutate({
        uid: currentUser.uid,
        email: currentUser.email || '',
        displayName: currentUser.displayName || '',
        photoURL: currentUser.photoURL || '',
      });
      recordSyncedProfileFingerprint(currentUser.uid, fingerprint);
    } catch (error) {
      if (typeof navigator === 'undefined' || navigator.onLine !== false) {
        console.warn('[auth] Background user document sync failed:', error);
      }
    }
  };

  if (
    typeof navigator !== 'undefined' &&
    navigator.onLine === false &&
    typeof window !== 'undefined'
  ) {
    window.addEventListener(
      'online',
      () => {
        void syncUserProfile();
      },
      {once: true},
    );
    return;
  }

  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => {
      void syncUserProfile();
    });
  } else {
    setTimeout(() => {
      void syncUserProfile();
    }, 250);
  }
}

/**
 * Initializes the Firebase Auth state listener, synchronous JWT header cache,
 * and idle-deferred profile synchronization.
 */
export function initAuthListener(): () => void {
  console.info('[auth] Initializing Firebase Auth listener...');

  const unsubscribeTokenCache = initAuthTokenCacheListener(auth);

  // Safety timeout: Ensure UI unblocks even if network latency or iframe constraints delay Firebase Auth
  const fallbackTimer = setTimeout(() => {
    const state = useAuthStore.getState();
    if (!state.isAuthReady) {
      console.warn(
        '[auth] Firebase Auth state did not resolve within 1500ms; unblocking UI via safety fallback timer.',
      );
      markLiveAuthResolved();
      updateAuthState({
        isAuthReady: true,
      });
    }
  }, 1500);

  const unsubscribeAuthState = onAuthStateChanged(
    auth,
    currentUser => {
      clearTimeout(fallbackTimer);
      void (async () => {
        try {
          const previousUid =
            useAuthStore.getState().user?.uid ?? readAuthShellSnapshot()?.uid;

          if (currentUser) {
            console.info(
              `[auth] User session resolved: ${currentUser.email || currentUser.uid} (verified=${currentUser.emailVerified})`,
            );
            if (!currentUser.emailVerified) {
              console.warn(
                `[auth] Signing out unverified user: ${currentUser.email || currentUser.uid}`,
              );
              clearAuthShellSnapshot();
              clearCachedIdToken();
              setActivePersistenceUid(null);
              markLiveAuthResolved();
              if (previousUid) {
                void resetClientQueryCaches(previousUid);
              }
              await signOut(auth);
              updateAuthState({
                user: null,
                authError: 'Please verify your email to access this app.',
                isAuthReady: true,
                isOptimisticShell: false,
                isLiveAuthVerified: true,
              });
              return;
            }

            if (previousUid && previousUid !== currentUser.uid) {
              void resetClientQueryCaches(previousUid);
            }

            setActivePersistenceUid(currentUser.uid);
            writeAuthShellSnapshot(currentUser);
            markLiveAuthResolved();

            // Upgrade optimistic shell seamlessly to live verified user
            updateAuthState({
              user: currentUser,
              authError: null,
              isAuthReady: true,
              isOptimisticShell: false,
              isLiveAuthVerified: true,
            });

            // Defer profile sync off the critical startup path and skip when unchanged
            scheduleIdleProfileSync(currentUser);
          } else {
            console.info('[auth] No active user session (unauthenticated).');
            clearAuthShellSnapshot();
            clearCachedIdToken();
            setActivePersistenceUid(null);
            markLiveAuthResolved();
            if (previousUid) {
              void resetClientQueryCaches(previousUid);
            }
            updateAuthState({
              user: null,
              authError: null,
              isAuthReady: true,
              isOptimisticShell: false,
              isLiveAuthVerified: true,
            });
          }
        } catch (err) {
          console.warn(
            '[auth] Error during auth state change processing:',
            err,
          );
          markLiveAuthResolved();
          updateAuthState({
            user: null,
            isAuthReady: true,
            isOptimisticShell: false,
            isLiveAuthVerified: true,
          });
        }
      })();
    },
    err => {
      clearTimeout(fallbackTimer);
      console.warn('[auth] Firebase Auth observer error:', err);
      markLiveAuthResolved();
      updateAuthState({
        user: null,
        isAuthReady: true,
        isOptimisticShell: false,
        isLiveAuthVerified: true,
      });
    },
  );

  return () => {
    clearTimeout(fallbackTimer);
    unsubscribeTokenCache();
    unsubscribeAuthState();
  };
}
