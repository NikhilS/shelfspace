import {describe, it, expect, vi, beforeEach} from 'vitest';
import {renderHook, waitFor} from '@testing-library/react';
import React from 'react';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {useLibraryData, mapDocToBook} from './useLibraryData';

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

const mockTrpcLibraryQuery = vi.fn();
const mockTrpcBooksQuery = vi.fn();

const mockSetBookListData = vi.fn();
const mockSetLibraryGetData = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {
          getData: vi.fn(),
          setData: mockSetBookListData,
        },
      },
      library: {
        get: {
          getData: vi.fn(),
          setData: mockSetLibraryGetData,
        },
        list: {
          getData: vi.fn(),
        },
      },
    }),
    library: {
      get: {
        useQuery: (...args: unknown[]): unknown =>
          mockTrpcLibraryQuery(...args),
      },
    },
    book: {
      list: {
        useQuery: (...args: unknown[]): unknown => mockTrpcBooksQuery(...args),
      },
    },
  },
  trpcVanilla: {
    book: {
      list: {
        query: vi.fn(),
      },
      syncChanges: {
        query: vi.fn(),
      },
    },
  },
}));

describe('Declarative TanStack React Query (useLibraryData)', () => {
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

    mockTrpcLibraryQuery.mockReturnValue({
      data: {
        id: 'lib-1',
        name: 'Test Library',
        ownerId: 'user123',
        callerRole: 'owner',
      },
      isLoading: false,
      isFetching: false,
      isStale: false,
      isError: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });

    mockTrpcBooksQuery.mockReturnValue({
      data: {
        books: [
          {
            id: 'book-1',
            title: 'Dune',
            author: 'Frank Herbert',
            primaryGenre: 'Science Fiction',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      isStale: false,
      isError: false,
      error: null,
      refetch: vi.fn().mockResolvedValue({}),
    });
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

  describe('Declarative Data Loading', () => {
    it('returns normalized library and book data directly from declarative queries', async () => {
      const {result} = renderHook(
        () => useLibraryData('lib-1', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      await waitFor(() => {
        expect(result.current.library).toEqual({
          id: 'lib-1',
          name: 'Test Library',
          ownerId: 'user123',
          callerRole: 'owner',
        });
        expect(result.current.books).toHaveLength(1);
        expect(result.current.books[0].title).toBe('Dune');
        expect(result.current.isLoading).toBe(false);
        expect(result.current.isBooksLoading).toBe(false);
        expect(result.current.isCachedFirstPaint).toBe(true);
      });
    });

    it('handles raw array books format as well as {books: []} wrapper', async () => {
      mockTrpcBooksQuery.mockReturnValue({
        data: [
          {
            id: 'book-2',
            title: 'Hyperion',
            author: 'Dan Simmons',
          },
        ],
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const {result} = renderHook(
        () => useLibraryData('lib-1', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      await waitFor(() => {
        expect(result.current.books).toHaveLength(1);
        expect(result.current.books[0].title).toBe('Hyperion');
      });
    });

    it('accurately represents loading and syncing states', () => {
      mockTrpcLibraryQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isStale: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      mockTrpcBooksQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        isFetching: true,
        isStale: true,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      const {result} = renderHook(
        () => useLibraryData('lib-1', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.isBooksLoading).toBe(true);
      expect(result.current.isSyncing).toBe(false);
      expect(result.current.library).toBeNull();
      expect(result.current.books).toEqual([]);
    });

    it('navigates away when library query encounters an error', async () => {
      mockTrpcLibraryQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: true,
        error: new Error('Unauthorized'),
        refetch: vi.fn(),
      });

      renderHook(() => useLibraryData('lib-err', 'user123', navigate), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(navigate).toHaveBeenCalledWith('/');
      });
    });

    it('provides a unified refetch function', async () => {
      const mockLibRefetch = vi.fn().mockResolvedValue({});
      const mockBooksRefetch = vi.fn().mockResolvedValue({});

      mockTrpcLibraryQuery.mockReturnValue({
        data: {id: 'lib-1', name: 'Test'},
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: mockLibRefetch,
      });

      mockTrpcBooksQuery.mockReturnValue({
        data: {books: []},
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: mockBooksRefetch,
      });

      const {result} = renderHook(
        () => useLibraryData('lib-1', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      await result.current.refetch();

      expect(mockLibRefetch).toHaveBeenCalled();
      expect(mockBooksRefetch).toHaveBeenCalled();
    });

    it('automatically drains remaining nextCursor pages and reconciles library.bookCount', async () => {
      const {trpcVanilla} = await import('../lib/trpc');
      const mockVanillaList = vi.mocked(trpcVanilla.book.list.query);

      mockTrpcLibraryQuery.mockReturnValue({
        data: {
          id: 'lib-defcol',
          name: 'Defcol',
          ownerId: 'user123',
          callerRole: 'owner',
          bookCount: 1000,
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      mockTrpcBooksQuery.mockReturnValue({
        data: {
          books: [
            {id: 'book-1', title: 'Book 1', author: 'Author 1'},
            {id: 'book-2', title: 'Book 2', author: 'Author 2'},
          ],
          nextCursor: 'book-2',
          totalCount: 3,
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      mockVanillaList.mockResolvedValueOnce({
        books: [{id: 'book-3', title: 'Book 3', author: 'Author 3'}],
        nextCursor: undefined,
      } as unknown as Awaited<ReturnType<typeof trpcVanilla.book.list.query>>);

      const {result} = renderHook(
        () => useLibraryData('lib-defcol', 'user123', navigate),
        {wrapper: createWrapper()},
      );

      await waitFor(() => {
        expect(result.current.books).toHaveLength(3);
        expect(result.current.isPaginating).toBe(false);
        expect(result.current.library?.bookCount).toBe(3);
      });

      expect(mockVanillaList).toHaveBeenCalledWith({
        libraryId: 'lib-defcol',
        cursor: 'book-2',
        limit: 1000,
      });
    });

    it('deduplicates concurrent background cursor drains across multiple mounted hooks', async () => {
      const {trpcVanilla} = await import('../lib/trpc');
      const mockVanillaList = vi.mocked(trpcVanilla.book.list.query);

      mockTrpcLibraryQuery.mockReturnValue({
        data: {
          id: 'lib-shared-drain',
          name: 'Shared Drain Library',
          ownerId: 'user123',
          callerRole: 'owner',
          bookCount: 1000,
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      mockTrpcBooksQuery.mockReturnValue({
        data: {
          books: [
            {id: 'book-1', title: 'Book 1', author: 'Author 1'},
            {id: 'book-2', title: 'Book 2', author: 'Author 2'},
          ],
          nextCursor: 'cursor-page-2',
          totalCount: 3,
        },
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      mockVanillaList.mockResolvedValue({
        books: [{id: 'book-3', title: 'Book 3', author: 'Author 3'}],
        nextCursor: undefined,
        totalCount: 3,
      } as unknown as Awaited<ReturnType<typeof trpcVanilla.book.list.query>>);

      const wrapper = createWrapper();
      const hookA = renderHook(
        () => useLibraryData('lib-shared-drain', 'user123', navigate),
        {wrapper},
      );
      const hookB = renderHook(
        () => useLibraryData('lib-shared-drain', 'user123', navigate),
        {wrapper},
      );

      await waitFor(() => {
        expect(hookA.result.current.books).toHaveLength(3);
        expect(hookB.result.current.books).toHaveLength(3);
        expect(hookA.result.current.isPaginating).toBe(false);
        expect(hookB.result.current.isPaginating).toBe(false);
      });

      expect(mockVanillaList).toHaveBeenCalledTimes(1);
    });

    it('reconciles warm cached libraries via incremental book.syncChanges deltas', async () => {
      const {resetWarmSyncStateForTests} = await import('./useLibraryData');
      resetWarmSyncStateForTests();
      const {trpcVanilla} = await import('../lib/trpc');
      const mockSyncChanges = vi.mocked(trpcVanilla.book.syncChanges.query);

      const initialBookList = {
        books: [
          {
            id: 'book-1',
            title: 'Dune',
            author: 'Frank Herbert',
            isbn: '9780441172719',
            updatedAt: '2026-11-15T10:00:00.000Z',
            readingStatus: 'unset',
          },
          {
            id: 'book-deleted',
            title: 'Old Volume',
            author: 'Anon',
            updatedAt: '2026-11-14T10:00:00.000Z',
          },
        ],
        totalCount: 2,
      };

      mockTrpcBooksQuery.mockReturnValue({
        data: initialBookList,
        isLoading: false,
        isFetching: false,
        isStale: false,
        isError: false,
        error: null,
        refetch: vi.fn(),
      });

      mockSyncChanges.mockResolvedValueOnce({
        upsertedBooks: [
          {
            id: 'book-new',
            title: 'Children of Dune',
            author: 'Frank Herbert',
            updatedAt: '2026-11-15T11:00:00.000Z',
          },
        ],
        deletedBookIds: ['book-deleted'],
        readingStates: {
          'isbn:9780441172719': {
            status: 'reading',
            rating: 5,
          },
        },
        syncCursorMs: Date.parse('2026-11-15T11:00:00.000Z'),
        totalCount: 2,
      } as unknown as Awaited<
        ReturnType<typeof trpcVanilla.book.syncChanges.query>
      >);

      renderHook(() => useLibraryData('lib-warm', 'user123', navigate), {
        wrapper: createWrapper(),
      });

      await waitFor(() => {
        expect(mockSyncChanges).toHaveBeenCalledWith({
          libraryId: 'lib-warm',
          sinceUpdatedAtMs: Date.parse('2026-11-15T10:00:00.000Z'),
          knownCount: 2,
        });
        expect(mockSetBookListData).toHaveBeenCalled();
      });

      const updater = mockSetBookListData.mock.calls[0]?.[1] as (
        old: typeof initialBookList,
      ) => typeof initialBookList;
      const reconciled = updater(initialBookList);
      expect(reconciled.books.map(b => b.id)).toEqual(['book-new', 'book-1']);
      expect(reconciled.books[1]).toMatchObject({
        id: 'book-1',
        readingStatus: 'reading',
        userRating: 5,
      });
    });
  });
});
