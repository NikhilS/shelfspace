import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as firestore from 'firebase/firestore';

// Mock dependencies before importing the module we want to test
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(),
}));

// Provide a mock auth state
let mockCurrentUser: Record<string, unknown> | null = null;

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({
    get currentUser() {
      return mockCurrentUser;
    },
  })),
}));

vi.mock('firebase/firestore', () => ({
  initializeFirestore: vi.fn(),
  persistentLocalCache: vi.fn(() => 'mock-local-cache'),
  persistentMultipleTabManager: vi.fn(() => 'mock-tab-manager'),
  getDocFromServer: vi.fn(),
  doc: vi.fn(),
}));

vi.mock('../firebase-applet-config.json', () => ({
  default: {
    projectId: 'test-project',
    firestoreDatabaseId: 'test-database-id',
  },
}));

describe('firebase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCurrentUser = null;
  });

  it('initializes Firestore correctly', async () => {
    vi.resetModules();
    const firebaseModule = await import('./firebase');

    expect(firestore.initializeFirestore).toHaveBeenCalledWith(
      firebaseModule.app,
      {
        localCache: 'mock-local-cache',
      },
      'test-database-id',
    );
  });

  it('handles offline connection scenario', async () => {
    // Setup the mock for getDocFromServer to throw an "offline" error
    const offlineError = new Error('the client is offline');
    vi.spyOn(firestore, 'getDocFromServer').mockRejectedValueOnce(offlineError);

    // We want to suppress the expected console.error during the test run
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Re-import module to trigger testConnection call
    vi.resetModules();
    await import('./firebase');

    // Allow promises to resolve
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(consoleSpy).toHaveBeenCalledWith(
      'Please check your Firebase configuration. The client is offline.',
    );

    consoleSpy.mockRestore();
  });

  it('handles generic error on connection scenario', async () => {
    // Setup the mock for getDocFromServer to throw a generic error
    const genericError = new Error('generic error');
    vi.spyOn(firestore, 'getDocFromServer').mockRejectedValueOnce(genericError);

    // We want to ensure no console.error happens for other errors
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    // Re-import module to trigger testConnection call
    vi.resetModules();
    await import('./firebase');

    // Allow promises to resolve
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(consoleSpy).not.toHaveBeenCalledWith(
      'Please check your Firebase configuration. The client is offline.',
    );
    // Specifically we're checking it was not logged

    consoleSpy.mockRestore();
  });

  describe('handleFirestoreError', () => {
    it('throws error with detailed auth and operation info', async () => {
      vi.resetModules();
      const {handleFirestoreError, OperationType} = await import('./firebase');

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      mockCurrentUser = {
        uid: 'user123',
        email: 'test@example.com',
        emailVerified: true,
        isAnonymous: false,
        tenantId: null,
        providerData: [
          {
            providerId: 'google.com',
            displayName: 'Test User',
            email: 'test@example.com',
            photoURL: 'url',
          },
        ],
      };

      const testError = new Error('Missing or insufficient permissions.');

      try {
        handleFirestoreError(testError, OperationType.GET, 'libraries/123');
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain('Missing or insufficient permissions.');
        expect(err.message).toContain('user123');
        expect(err.message).toContain('libraries/123');
        expect(err.message).toContain('google.com');
      }

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles non-Error objects', async () => {
      vi.resetModules();
      const {handleFirestoreError, OperationType} = await import('./firebase');

      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});

      try {
        handleFirestoreError({weird: 'error'}, OperationType.WRITE, 'users');
      } catch (e) {
        const err = e as Error;
        expect(err.message).toContain('[object Object]');
      }

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
