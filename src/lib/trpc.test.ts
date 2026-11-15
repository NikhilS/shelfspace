import {describe, it, expect, beforeEach, vi} from 'vitest';
import {getAuthHeaders, isSlowLaneProcedure} from './trpc';
import {primeCachedIdToken, resetLiveAuthGateForTests} from './authTokenCache';

vi.mock('../firebase', () => ({
  auth: {
    currentUser: null,
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      user: {uid: 'u-1', getIdToken: vi.fn().mockResolvedValue('fallback-jwt')},
      isOptimisticShell: false,
    }),
  },
}));

describe('trpc transport & auth header helpers', () => {
  beforeEach(() => {
    resetLiveAuthGateForTests();
  });

  it('classifies Fast Lane vs Slow Lane procedures accurately', () => {
    expect(isSlowLaneProcedure('auth.getPermissions')).toBe(false);
    expect(isSlowLaneProcedure('library.list')).toBe(false);
    expect(isSlowLaneProcedure('book.list')).toBe(false);
    expect(isSlowLaneProcedure('book.updateStatus')).toBe(false);
    expect(isSlowLaneProcedure('readingTracker.getShelf')).toBe(false);
    expect(isSlowLaneProcedure('readingTracker.getUnreadLibraryBooks')).toBe(
      false,
    );
    expect(isSlowLaneProcedure('readingTracker.trackBook')).toBe(false);

    expect(isSlowLaneProcedure('gemini.getPickOfTheDay')).toBe(true);
    expect(isSlowLaneProcedure('metadata.searchCatalog')).toBe(true);
    expect(isSlowLaneProcedure('enrichment.startJob')).toBe(true);
    expect(isSlowLaneProcedure('readingTracker.getRecommendations')).toBe(true);
    expect(isSlowLaneProcedure('readingTracker.searchUnified')).toBe(true);
  });

  it('returns cached JWT header synchronously without invoking async getIdToken when primed', async () => {
    primeCachedIdToken('cached-fast-jwt', 'u-1', Date.now() + 300_000);
    const headers = await getAuthHeaders();
    expect(headers).toEqual({Authorization: 'Bearer cached-fast-jwt'});
  });

  it('falls back to user.getIdToken and primes cache on cold lookup', async () => {
    const headers = await getAuthHeaders();
    expect(headers).toEqual({Authorization: 'Bearer fallback-jwt'});
  });
});
