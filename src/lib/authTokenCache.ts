import {onIdTokenChanged, type Auth, type User} from 'firebase/auth';

export const AUTH_SHELL_STORAGE_KEY = 'bookish_auth_shell_v1';
const TOKEN_EXPIRY_SAFETY_BUFFER_MS = 30_000;
const PROACTIVE_REFRESH_LEAD_MS = 120_000;
const DEFAULT_FALLBACK_TTL_MS = 5 * 60_000;
const MAX_SHELL_SNAPSHOT_AGE_MS = 1000 * 60 * 60 * 24 * 14; // 14 days

export interface AuthShellSnapshot {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  emailVerified: boolean;
  updatedAtMs: number;
}

interface CachedJwtEntry {
  token: string;
  uid: string;
  expiresAtMs: number;
}

let cachedJwt: CachedJwtEntry | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let liveAuthResolved = false;
const liveAuthWaiters = new Set<() => void>();

function clearRefreshTimer(): void {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function decodeBase64UrlSegment(segment: string): string | null {
  try {
    const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padLength = (4 - (normalized.length % 4)) % 4;
    const padded = normalized + '='.repeat(padLength);
    if (typeof atob === 'function') {
      return atob(padded);
    }
    if (typeof Buffer !== 'undefined') {
      return Buffer.from(padded, 'base64').toString('utf8');
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extracts the `exp` claim (in epoch milliseconds) from a 3-segment JWT without
 * cryptographic verification (cryptographic verification occurs per-request on the server).
 */
export function decodeJwtExpirationMs(token: string): number | null {
  if (!token || typeof token !== 'string') {
    return null;
  }
  const parts = token.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  const decodedJson = decodeBase64UrlSegment(parts[1]);
  if (!decodedJson) {
    return null;
  }
  try {
    const payload = JSON.parse(decodedJson) as {exp?: unknown};
    if (typeof payload.exp === 'number' && Number.isFinite(payload.exp)) {
      return payload.exp * 1000;
    }
    return null;
  } catch {
    return null;
  }
}

export function primeCachedIdToken(
  token: string,
  uid: string,
  explicitExpiresAtMs?: number,
): void {
  if (!token || !uid) {
    return;
  }
  const expiresAtMs =
    explicitExpiresAtMs ??
    decodeJwtExpirationMs(token) ??
    Date.now() + DEFAULT_FALLBACK_TTL_MS;

  cachedJwt = {
    token,
    uid,
    expiresAtMs,
  };
}

/**
 * Synchronously returns a non-expired Firebase ID token in 0ms when available.
 */
export function getCachedIdToken(expectedUid?: string): string | null {
  if (!cachedJwt) {
    return null;
  }
  if (expectedUid && cachedJwt.uid !== expectedUid) {
    return null;
  }
  if (cachedJwt.expiresAtMs - Date.now() <= TOKEN_EXPIRY_SAFETY_BUFFER_MS) {
    return null;
  }
  return cachedJwt.token;
}

export function clearCachedIdToken(): void {
  cachedJwt = null;
  clearRefreshTimer();
}

export function markLiveAuthResolved(): void {
  liveAuthResolved = true;
  if (liveAuthWaiters.size > 0) {
    for (const resolve of liveAuthWaiters) {
      resolve();
    }
    liveAuthWaiters.clear();
  }
}

export function resetLiveAuthGateForTests(): void {
  liveAuthResolved = false;
  liveAuthWaiters.clear();
  clearCachedIdToken();
}

/**
 * Awaits live Firebase Auth resolution (bounded by `timeoutMs`) during an optimistic
 * cached shell boot so background tRPC revalidations never fire without a Bearer token.
 */
export function waitForLiveAuthResolution(timeoutMs = 2000): Promise<void> {
  if (liveAuthResolved) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      liveAuthWaiters.delete(finish);
      resolve();
    };
    liveAuthWaiters.add(finish);
    setTimeout(finish, timeoutMs);
  });
}

function scheduleProactiveTokenRefresh(user: User, expiresAtMs: number): void {
  clearRefreshTimer();
  const delayMs = Math.max(
    5_000,
    expiresAtMs - Date.now() - PROACTIVE_REFRESH_LEAD_MS,
  );
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    if (typeof user.getIdToken !== 'function') {
      return;
    }
    void user
      .getIdToken(true)
      .then(freshToken => {
        if (freshToken) {
          const nextExp =
            decodeJwtExpirationMs(freshToken) ??
            Date.now() + DEFAULT_FALLBACK_TTL_MS;
          primeCachedIdToken(freshToken, user.uid, nextExp);
          scheduleProactiveTokenRefresh(user, nextExp);
        }
      })
      .catch(() => {
        // Ignore transient background refresh errors; on-demand getIdToken handles retries
      });
  }, delayMs);
}

/**
 * Subscribes to Firebase `onIdTokenChanged` to keep the synchronous in-memory JWT
 * header cache warm and proactively refreshed ahead of token expiration.
 */
export function initAuthTokenCacheListener(
  authInstance: Auth | undefined,
): () => void {
  if (!authInstance || typeof onIdTokenChanged !== 'function') {
    return () => {};
  }
  try {
    const unsubscribe = onIdTokenChanged(authInstance, tokenUser => {
      if (!tokenUser) {
        clearCachedIdToken();
        markLiveAuthResolved();
        return;
      }
      if (typeof tokenUser.getIdToken !== 'function') {
        markLiveAuthResolved();
        return;
      }
      void tokenUser
        .getIdToken(false)
        .then(token => {
          if (token) {
            const expMs =
              decodeJwtExpirationMs(token) ??
              Date.now() + DEFAULT_FALLBACK_TTL_MS;
            primeCachedIdToken(token, tokenUser.uid, expMs);
            scheduleProactiveTokenRefresh(tokenUser, expMs);
          }
          markLiveAuthResolved();
        })
        .catch(() => {
          markLiveAuthResolved();
        });
    });
    return () => {
      clearRefreshTimer();
      unsubscribe();
    };
  } catch {
    return () => {};
  }
}

export function readAuthShellSnapshot(): AuthShellSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(AUTH_SHELL_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<AuthShellSnapshot>;
    if (
      typeof parsed.uid !== 'string' ||
      parsed.uid.trim().length === 0 ||
      parsed.emailVerified !== true ||
      typeof parsed.updatedAtMs !== 'number'
    ) {
      return null;
    }
    if (Date.now() - parsed.updatedAtMs > MAX_SHELL_SNAPSHOT_AGE_MS) {
      window.localStorage.removeItem(AUTH_SHELL_STORAGE_KEY);
      return null;
    }
    return {
      uid: parsed.uid,
      email: typeof parsed.email === 'string' ? parsed.email : null,
      displayName:
        typeof parsed.displayName === 'string' ? parsed.displayName : null,
      photoURL: typeof parsed.photoURL === 'string' ? parsed.photoURL : null,
      emailVerified: true,
      updatedAtMs: parsed.updatedAtMs,
    };
  } catch {
    return null;
  }
}

export function writeAuthShellSnapshot(user: {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  emailVerified?: boolean;
}): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  if (!user.uid || user.emailVerified === false) {
    return;
  }
  const snapshot: AuthShellSnapshot = {
    uid: user.uid,
    email: user.email ?? null,
    displayName: user.displayName ?? null,
    photoURL: user.photoURL ?? null,
    emailVerified: true,
    updatedAtMs: Date.now(),
  };
  try {
    window.localStorage.setItem(
      AUTH_SHELL_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function clearAuthShellSnapshot(): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(AUTH_SHELL_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup errors
  }
}

/**
 * Constructs a lightweight shell `User`-compatible projection from `AuthShellSnapshot`
 * so returning readers render the warm cached app shell in <50ms while Firebase Auth
 * verifies live credentials in the background.
 */
export function createOptimisticShellUser(
  snapshot: AuthShellSnapshot,
  getLiveUser?: () => User | null | undefined,
): User {
  const shellUser = {
    uid: snapshot.uid,
    email: snapshot.email,
    displayName: snapshot.displayName,
    photoURL: snapshot.photoURL,
    emailVerified: snapshot.emailVerified,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    refreshToken: '',
    tenantId: null,
    phoneNumber: null,
    providerId: 'firebase',
    delete: async () => {},
    getIdToken: async (forceRefresh?: boolean): Promise<string> => {
      if (!forceRefresh) {
        const cached = getCachedIdToken(snapshot.uid);
        if (cached) {
          return cached;
        }
      }
      await waitForLiveAuthResolution(2000);
      const liveUser = getLiveUser?.();
      if (liveUser && typeof liveUser.getIdToken === 'function') {
        return liveUser.getIdToken(forceRefresh);
      }
      return getCachedIdToken(snapshot.uid) ?? '';
    },
    getIdTokenResult: async () => {
      throw new Error('getIdTokenResult requires live Firebase Auth session');
    },
    reload: async () => {},
    toJSON: () => ({
      uid: snapshot.uid,
      email: snapshot.email,
      displayName: snapshot.displayName,
      photoURL: snapshot.photoURL,
      emailVerified: snapshot.emailVerified,
    }),
  } as User;

  return shellUser;
}
