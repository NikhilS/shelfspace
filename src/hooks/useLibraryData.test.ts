import {describe, it, expect, vi, beforeEach} from 'vitest';
import {renderHook, waitFor, act} from '@testing-library/react';
import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useLibraryData, mapDocToBook} from './useLibraryData';
import {DebugTelemetryEngine} from '../lib/telemetry';

// Mock authStore
vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'user123', email: 'user@example.com'},
  }),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// Mock firebase
vi.mock('../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {GET: 'GET', LIST: 'LIST'},
}));

let mockGetDocFromCache: ReturnType<typeof vi.fn>;
let mockGetDocsFromCache: ReturnType<typeof vi.fn>;
let mockOnSnapshot: ReturnType<typeof vi.fn>;
let mockUpdateDoc: ReturnType<typeof vi.fn>;

vi.mock('firebase/firestore', () => {
  return {
    doc: vi.fn((_db, ...parts) => ({
      path: parts.join('/'),
      id: parts[parts.length - 1],
    })),
    collection: vi.fn((_db, ...parts) => ({path: parts.join('/')})),
    query: vi.fn(ref => ref),
    orderBy: vi.fn(),
    serverTimestamp: vi.fn(() => 'MOCK_TIMESTAMP'),
    updateDoc: vi.fn((...args) => mockUpdateDoc(...args)),
    getDocFromCache: vi.fn((...args) => mockGetDocFromCache(...args)),
    getDocsFromCache: vi.fn((...args) => mockGetDocsFromCache(...args)),
    onSnapshot: vi.fn((...args) => mockOnSnapshot(...args)),
  };
});

describe('Phase 4: Zero-Latency Offline-First Hydration (useLibraryData)', () => {
  let queryClient: QueryClient;
  const navigate = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          gcTime: 1000 * 60 * 60,
          staleTime: 1000 * 60 * 5,
        },
      },
    });

    mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
    mockGetDocFromCache = vi.fn().mockRejectedValue(new Error('Cache miss'));
    mockGetDocsFromCache = vi.fn().mockRejectedValue(new Error('Cache miss'));
    mockOnSnapshot = vi.fn(() => () => {});
  });

  const createWrapper = () => {
    return ({children}: {children: React.ReactNode}) =>
      React.createElement(QueryClientProvider, {client: queryClient}, children);
  };

  describe('mapDocToBook', () => {
    it('correctly maps raw snapshot fields to Book model', () => {
      const mockDoc = {
        id: 'book-1',
        data: () => ({
          title: 'Dune',
          author: 'Frank Herbert',
          primaryGenre: 'Science Fiction',
          subgenres: ['Space Opera'],
          isCustomPrimary: true,
          temporalMetadata: {
            startYear: 1965,
          },
        }),
      };

      const book = mapDocToBook(mockDoc);
      expect(book.id).toBe('book-1');
      expect(book.title).toBe('Dune');
      expect(book.primaryGenre).toBe('Science Fiction');
      expect(book.subgenres).toEqual(['Space Opera']);
      expect(book.isCustomPrimary).toBe(true);
      expect(book.temporalMetadata?.endYear).toBe(1965);
    });

    it('sanitizes out-of-range temporal metadata', () => {
      const mockDoc = {
        id: 'book-invalid-year',
        data: () => ({
          title: 'Ancient Tales',
          temporalMetadata: {
            startYear: 99999,
          },
        }),
      };

      const book = mapDocToBook(mockDoc);
      expect(book.temporalMetadata).toBeUndefined();
    });
  });

  describe('Stage 1: Synchronous / Immediate IndexedDB Cache Paint', () => {
    it('hydrates library and books immediately from cache before network responds', async () => {
      const cachedLibData = {
        name: 'Sci-Fi Collection',
        ownerId: 'user123',
        bookCount: 1,
      };

      const cachedBookData = {
        title: 'Neuromancer',
        author: 'William Gibson',
        primaryGenre: 'Cyberpunk',
        addedAt: '2024-01-01',
      };

      mockGetDocFromCache.mockResolvedValueOnce({
        id: 'lib-42',
        exists: () => true,
        data: () => cachedLibData,
      });

      mockGetDocsFromCache.mockResolvedValueOnce({
        empty: false,
        size: 1,
        docs: [
          {
            id: 'book-42',
            data: () => cachedBookData,
          },
        ],
      });

      const {result} = renderHook(
        () => useLibraryData('lib-42', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      // Verify Stage 1 hydration
      await waitFor(() => {
        expect(result.current.library).toEqual({
          id: 'lib-42',
          ...cachedLibData,
        });
        expect(result.current.books).toHaveLength(1);
        expect(result.current.books[0].title).toBe('Neuromancer');
        expect(result.current.isCachedFirstPaint).toBe(true);
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isBooksLoading).toBe(false);
      });

      // Verify queryClient cache was seeded
      expect(queryClient.getQueryData(['library', 'lib-42'])).toBeDefined();
      expect(queryClient.getQueryData(['books', 'lib-42'])).toHaveLength(1);
    });

    it('falls back smoothly to network when cache misses', async () => {
      mockGetDocFromCache.mockRejectedValueOnce(new Error('IndexedDB miss'));
      mockGetDocsFromCache.mockRejectedValueOnce(new Error('IndexedDB miss'));

      let libListenerCb: ((snap: unknown) => void) | null = null;
      let booksListenerCb: ((snap: unknown) => void) | null = null;

      mockOnSnapshot.mockImplementation((ref, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (ref.path?.includes('books')) {
          booksListenerCb = callback;
        } else {
          libListenerCb = callback;
        }
        return () => {};
      });

      const {result} = renderHook(
        () => useLibraryData('lib-miss', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isBooksLoading).toBe(true);

      // Stage 2 network arrives
      act(() => {
        if (libListenerCb) {
          libListenerCb({
            id: 'lib-miss',
            exists: () => true,
            data: () => ({
              name: 'Network Library',
              ownerId: 'user123',
              bookCount: 0,
            }),
            metadata: {fromCache: false},
          });
        }
        if (booksListenerCb) {
          booksListenerCb({
            size: 0,
            docs: [],
            metadata: {hasPendingWrites: false, fromCache: false},
          });
        }
      });

      await waitFor(() => {
        expect(result.current.library?.name).toBe('Network Library');
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isBooksLoading).toBe(false);
      });
    });
  });

  describe('Stage 2: Network onSnapshot Delta Reconciliation', () => {
    it('seamlessly updates cached data when server delta arrives', async () => {
      // 1. Initial cached state
      queryClient.setQueryData(['library', 'lib-swr'], {
        id: 'lib-swr',
        name: 'Initial Cached Lib',
        ownerId: 'user123',
        bookCount: 1,
      });
      queryClient.setQueryData(
        ['books', 'lib-swr'],
        [
          {
            id: 'b1',
            title: 'Book 1 Cached',
            subgenres: [],
            isCustomPrimary: false,
          },
        ],
      );

      let booksListenerCb: ((snap: unknown) => void) | null = null;
      mockOnSnapshot.mockImplementation((ref, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        if (ref.path?.includes('books')) {
          booksListenerCb = callback;
        }
        return () => {};
      });

      const {result} = renderHook(
        () => useLibraryData('lib-swr', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      expect(result.current.books).toHaveLength(1);
      expect(result.current.books[0].title).toBe('Book 1 Cached');
      expect(result.current.isCachedFirstPaint).toBe(true);

      // 2. Server delivers updated list with 2 books
      act(() => {
        if (booksListenerCb) {
          booksListenerCb({
            size: 2,
            metadata: {hasPendingWrites: false, fromCache: false},
            docs: [
              {
                id: 'b1',
                data: () => ({title: 'Book 1 Updated from Server'}),
              },
              {
                id: 'b2',
                data: () => ({title: 'Book 2 New from Server'}),
              },
            ],
          });
        }
      });

      await waitFor(() => {
        expect(result.current.books).toHaveLength(2);
        expect(result.current.books[0].title).toBe(
          'Book 1 Updated from Server',
        );
        expect(result.current.books[1].title).toBe('Book 2 New from Server');
      });
    });
  });
});
