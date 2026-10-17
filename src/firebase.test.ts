import {describe, it, expect, vi, beforeEach} from 'vitest';
import * as firebaseApp from 'firebase/app';
import * as firebaseAuth from 'firebase/auth';

vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({name: '[DEFAULT]'})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  connectAuthEmulator: vi.fn(),
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
  });

  it('initializes Firebase App and Auth without client Firestore or Storage SDKs', async () => {
    vi.resetModules();
    const firebaseModule = await import('./firebase');

    expect(firebaseApp.initializeApp).toHaveBeenCalled();
    expect(firebaseAuth.getAuth).toHaveBeenCalledWith(firebaseModule.app);
    expect('db' in firebaseModule).toBe(false);
    expect('storage' in firebaseModule).toBe(false);
  });
});
