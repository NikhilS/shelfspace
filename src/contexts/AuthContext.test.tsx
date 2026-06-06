// top of file
import {render, screen, waitFor} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import React from 'react';
import {AuthProvider, useAuth} from './AuthContext';
import {onAuthStateChanged} from 'firebase/auth';
import {getDoc, setDoc} from 'firebase/firestore';

// Mock dependencies
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  onAuthStateChanged: vi.fn(),
  signInWithPopup: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db, ...paths) => paths.join('/')),
  setDoc: vi.fn(),
  getDoc: vi.fn(),
  collection: vi.fn((_db, ...paths) => paths.join('/')),
  getDocs: vi.fn(),
  serverTimestamp: vi.fn(() => 'server-time'),
}));

vi.mock('../firebase', () => ({
  auth: {},
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {
    CREATE: 'create',
    GET: 'get',
  },
}));

const TestComponent = () => {
  const {user, isAuthReady} = useAuth();
  if (!isAuthReady)
    return <div data-testid="auth-loading">Loading Auth...</div>;
  if (!user) return <div data-testid="no-user">No User</div>;
  return <div data-testid="user">User: {user.uid}</div>;
};

describe('AuthContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders loading state initially', () => {
    // Hang onAuthStateChanged so it stays loading
    vi.mocked(onAuthStateChanged).mockImplementation(() => {
      return () => {};
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    expect(screen.getByTestId('auth-loading')).toBeInTheDocument();
  });

  it('provides user when authenticated', async () => {
    vi.mocked(onAuthStateChanged).mockImplementation(((
      _auth: any,
      callback: any,
    ) => {
      const cb =
        typeof callback === 'function'
          ? callback
          : callback.next?.bind(callback);
      cb?.({
        uid: '123',
        email: 'test@example.com',
        emailVerified: true,
      } as any);
      return () => {};
    }) as any);

    vi.mocked(getDoc).mockImplementation(async (ref: any) => {
      // Simulate that both allowlist and user documents exist
      return {
        exists: () => true,
        data: () => ({role: 'user'}),
      } as unknown as import('firebase/firestore').DocumentSnapshot;
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toBeInTheDocument();
    });
    expect(screen.getByText('User: 123')).toBeInTheDocument();
  });

  it('creates user doc if it does not exist', async () => {
    vi.mocked(onAuthStateChanged).mockImplementation(((
      _auth: any,
      callback: any,
    ) => {
      const cb =
        typeof callback === 'function'
          ? callback
          : callback.next?.bind(callback);
      cb?.({
        uid: 'user456',
        email: 'new@example.com',
        displayName: 'New User',
        photoURL: 'http://example.com/photo.jpg',
        emailVerified: true,
      } as any);
      return () => {};
    }) as any);

    vi.mocked(getDoc).mockImplementation(async (ref: any) => {
      if (ref === 'appSettings/allowlist/users/new@example.com') {
        return {
          exists: () => true,
          data: () => ({role: 'user'}),
        } as unknown as import('firebase/firestore').DocumentSnapshot;
      }
      return {
        exists: () => false,
        data: () => ({}),
      } as unknown as import('firebase/firestore').DocumentSnapshot;
    });

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('user')).toBeInTheDocument();
    });

    expect(setDoc).toHaveBeenCalledWith('users/user456', {
      uid: 'user456',
      email: 'new@example.com',
      displayName: 'New User',
      photoURL: 'http://example.com/photo.jpg',
      createdAt: 'server-time',
    });
  });

  it('handles user sign out', async () => {
    vi.mocked(onAuthStateChanged).mockImplementation(((
      _auth: any,
      callback: any,
    ) => {
      const cb =
        typeof callback === 'function'
          ? callback
          : callback.next?.bind(callback);
      cb?.(null);
      return () => {};
    }) as any);

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('no-user')).toBeInTheDocument();
    });
  });

  it('throws an error if useAuth is used outside of AuthProvider', () => {
    // Prevent console.error from cluttering the test output
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(() => {
      render(<TestComponent />);
    }).toThrow('useAuth must be used within an AuthProvider');

    consoleSpy.mockRestore();
  });
});
