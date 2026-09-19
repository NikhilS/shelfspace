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
  auth: {
    currentUser: {
      getIdToken: vi.fn().mockResolvedValue('mock-token'),
      uid: 'user123',
    },
  },
  handleFirestoreError: vi.fn(),
  OperationType: {GET: 'GET', LIST: 'LIST'},
}));

const mockTrpcLibraryQuery = vi.fn();
const mockTrpcUseQuery = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    library: {
      get: {
        useQuery: (...args: unknown[]) => mockTrpcLibraryQuery(...args),
      },
    },
    book: {
      list: {
        useQuery: (...args: unknown[]) => mockTrpcUseQuery(...args),
      },
    },
  },
  trpcVanilla: {
    book: {
      list: {
        query: vi.fn(),
      },
    },
  },
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

    mockTrpcLibraryQuery.mockImplementation((input: {libraryId?: string}) => ({
      data: input?.libraryId
        ? {
            id: input.libraryId,
            name: 'Test Library',
            ownerId: 'user123',
            callerRole: 'owner',
          }
        : null,
      isLoading: false,
    }));
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
        id: 'book-42',
        title: 'Neuromancer',
        author: 'William Gibson',
        primaryGenre: 'Cyberpunk',
        addedAt: '2024-01-01',
      };

      queryClient.setQueryData(['library', 'lib-42'], {
        id: 'lib-42',
        ...cachedLibData,
      });
      queryClient.setQueryData(['books', 'lib-42'], [cachedBookData]);

      mockGetDocFromCache.mockResolvedValueOnce({
        id: 'lib-42',
        exists: () => true,
        data: () => cachedLibData,
      });

      mockTrpcLibraryQuery.mockReturnValue({
        data: {
          id: 'lib-42',
          ...cachedLibData,
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
      });

      mockTrpcUseQuery.mockReturnValue({
        data: {books: [cachedBookData]},
        isLoading: false,
        isFetching: false,
        isStale: false,
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

      let libListenerCb: ((snap: unknown) => void) | null = null;

      mockOnSnapshot.mockImplementation((_ref, opts, cb) => {
        const callback = typeof opts === 'function' ? opts : cb;
        libListenerCb = callback;
        return () => {};
      });

      mockTrpcLibraryQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isStale: true,
      });

      mockTrpcUseQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isStale: true,
      });

      const {result, rerender} = renderHook(
        () => useLibraryData('lib-miss', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isBooksLoading).toBe(true);

      // Network arrives
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
      });

      mockTrpcLibraryQuery.mockReturnValue({
        data: {
          id: 'lib-miss',
          name: 'Network Library',
          ownerId: 'user123',
          bookCount: 0,
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
      });

      mockTrpcUseQuery.mockReturnValue({
        data: {
          books: [],
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
      });

      rerender();

      await waitFor(() => {
        expect(result.current.library?.name).toBe('Network Library');
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isBooksLoading).toBe(false);
      });
    });
  });

  describe('Stage 2: Network Delta Reconciliation', () => {
    it('seamlessly updates cached data when tRPC query updates', async () => {
      mockTrpcUseQuery.mockReturnValue({
        data: {
          books: [
            {
              id: 'b1',
              title: 'Book 1 Updated from Server',
            },
            {
              id: 'b2',
              title: 'Book 2 New from Server',
            },
          ],
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
      });

      const {result} = renderHook(
        () => useLibraryData('lib-swr', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      await waitFor(() => {
        expect(result.current.books).toHaveLength(2);
        expect(result.current.books[0].title).toBe(
          'Book 1 Updated from Server',
        );
        expect(result.current.books[1].title).toBe('Book 2 New from Server');
      });
    });

    it('derives books from queryClient cache when tRPC is loading or returns undefined', async () => {
      const cachedBook = {
        id: 'book-cache-1',
        title: 'Foundation',
        author: 'Isaac Asimov',
        primaryGenre: 'Sci-Fi',
      };
      queryClient.setQueryData(['books', 'lib-live'], [cachedBook]);

      mockTrpcUseQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isFetching: false,
        isStale: false,
      });

      const {result} = renderHook(
        () => useLibraryData('lib-live', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      await waitFor(() => {
        expect(result.current.books).toHaveLength(1);
        expect(result.current.books[0].id).toBe('book-cache-1');
        expect(result.current.books[0].title).toBe('Foundation');
        expect(result.current.isBooksLoading).toBe(false);
      });

      expect(queryClient.getQueryData(['books', 'lib-live'])).toHaveLength(1);
    });
  });
});
