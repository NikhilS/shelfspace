import {describe, it, expect, beforeEach, vi} from 'vitest';
import {
  AUTH_SHELL_STORAGE_KEY,
  clearAuthShellSnapshot,
  clearCachedIdToken,
  createOptimisticShellUser,
  decodeJwtExpirationMs,
  getCachedIdToken,
  markLiveAuthResolved,
  primeCachedIdToken,
  readAuthShellSnapshot,
  resetLiveAuthGateForTests,
  waitForLiveAuthResolution,
  writeAuthShellSnapshot,
} from './authTokenCache';

function buildUnsignedJwt(expSeconds: number): string {
  const header = Buffer.from(
    JSON.stringify({alg: 'RS256', typ: 'JWT'}),
  ).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({sub: 'user-1', exp: expSeconds}),
  ).toString('base64url');
  return `${header}.${payload}.sig`;
}

describe('authTokenCache', () => {
  beforeEach(() => {
    resetLiveAuthGateForTests();
    window.localStorage.clear();
  });

  it('decodes JWT exp claims and serves synchronous cached tokens until safety window', () => {
    const futureExpSec = Math.floor((Date.now() + 300_000) / 1000);
    const jwt = buildUnsignedJwt(futureExpSec);

    expect(decodeJwtExpirationMs(jwt)).toBe(futureExpSec * 1000);

    primeCachedIdToken(jwt, 'user-1');
    expect(getCachedIdToken('user-1')).toBe(jwt);
    expect(getCachedIdToken('different-user')).toBeNull();

    // Near-expired token (< 30s left) must return null so caller refreshes
    const expiringSec = Math.floor((Date.now() + 10_000) / 1000);
    primeCachedIdToken(buildUnsignedJwt(expiringSec), 'user-1');
    expect(getCachedIdToken('user-1')).toBeNull();

    clearCachedIdToken();
    expect(getCachedIdToken('user-1')).toBeNull();
  });

  it('persists, reads, expires, and clears AuthShellSnapshot in localStorage', () => {
    expect(readAuthShellSnapshot()).toBeNull();

    writeAuthShellSnapshot({
      uid: 'u-archivist',
      email: 'reader@example.com',
      displayName: 'Archivist',
      photoURL: 'https://example.com/avatar.png',
      emailVerified: true,
    });

    const snapshot = readAuthShellSnapshot();
    expect(snapshot).toMatchObject({
      uid: 'u-archivist',
      email: 'reader@example.com',
      displayName: 'Archivist',
      photoURL: 'https://example.com/avatar.png',
      emailVerified: true,
    });

    const shellUser = createOptimisticShellUser(snapshot!);
    expect(shellUser.uid).toBe('u-archivist');
    expect(shellUser.emailVerified).toBe(true);

    // Stale snapshots older than 14 days are evicted automatically
    window.localStorage.setItem(
      AUTH_SHELL_STORAGE_KEY,
      JSON.stringify({
        ...snapshot,
        updatedAtMs: Date.now() - 1000 * 60 * 60 * 24 * 20,
      }),
    );
    expect(readAuthShellSnapshot()).toBeNull();

    clearAuthShellSnapshot();
    expect(readAuthShellSnapshot()).toBeNull();
  });

  it('resolves waitForLiveAuthResolution immediately when markLiveAuthResolved is signaled', async () => {
    const resolvedOrder: string[] = [];
    const waitPromise = waitForLiveAuthResolution(5000).then(() => {
      resolvedOrder.push('resolved');
    });

    const timer = vi.fn(() => {
      markLiveAuthResolved();
    });
    timer();

    await waitPromise;
    expect(resolvedOrder).toEqual(['resolved']);
  });
});
