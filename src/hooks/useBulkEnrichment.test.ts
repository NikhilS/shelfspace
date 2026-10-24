import {renderHook, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {useBulkEnrichment} from './useBulkEnrichment';
import {Book} from '../types';
import {trpcVanilla} from '../lib/trpc';

const mockBookListSetData = vi.fn();
const mockBookListInvalidate = vi.fn();

vi.mock('../lib/trpc', () => ({
  trpc: {
    useUtils: () => ({
      book: {
        list: {
          setData: mockBookListSetData,
          invalidate: mockBookListInvalidate,
        },
      },
    }),
  },
  trpcVanilla: {
    enrichment: {
      trigger: {
        mutate: vi.fn(),
      },
    },
  },
}));

vi.mock('../stores/authStore', () => ({
  useAuth: () => ({
    user: {uid: 'test-user-123'},
  }),
}));

vi.mock('../firebase', () => ({
  db: {},
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

describe('useBulkEnrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseBook: Book = {
    id: 'b1',
    title: 'Book 1',
    author: 'Author 1',
    addedBy: 'user-1',
    addedAt: {toDate: () => new Date(), toMillis: () => Date.now()},
  };

  it('filters out books that have status "unsupported" when overwrite is false', () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b1',
        title: 'Unsupported Book',
        enrichmentStatus: {geo: 'unsupported'},
      },
      {
        ...baseBook,
        id: 'b2',
        title: 'New Book',
      },
    ];

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'geo',
        metadataField: 'geoMetadata',
        filterPredicate: b => !b.geoMetadata,
        autoTrigger: false,
      }),
    );

    // Only b2 should be queued for backfill, b1 is skipped due to tombstone
    expect(result.current.booksToBackfill.map(b => b.id)).toEqual(['b2']);
  });

  it('includes unsupported books when overwrite is true', () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b1',
        title: 'Unsupported Book',
        enrichmentStatus: {geo: 'unsupported'},
      },
      {
        ...baseBook,
        id: 'b2',
        title: 'New Book',
      },
    ];

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'geo',
        metadataField: 'geoMetadata',
        filterPredicate: b => !b.geoMetadata,
        autoTrigger: false,
        overwrite: true,
      }),
    );

    expect(result.current.booksToBackfill.map(b => b.id)).toEqual(['b1', 'b2']);
  });

  it('includes unsupported books when ignoreUnsupportedStatus is true (manual Shelf Care selection)', () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b1',
        title: 'Previously Unsupported Cover Book',
        enrichmentStatus: {coverImage: 'unsupported'},
      },
      {
        ...baseBook,
        id: 'b2',
        title: 'Fresh Missing Cover Book',
      },
    ];

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'coverUrl',
        metadataField: 'coverUrl',
        filterPredicate: () => true,
        autoTrigger: false,
        overwrite: false,
        ignoreUnsupportedStatus: true,
      }),
    );

    expect(result.current.booksToBackfill.map(b => b.id)).toEqual(['b1', 'b2']);
  });

  it('dispatches to trpcVanilla.enrichment.trigger.mutate during triggerBackfill', async () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b10',
        title: 'Novel',
      },
    ];

    vi.mocked(trpcVanilla.enrichment.trigger.mutate).mockResolvedValueOnce({
      status: 'success',
      enrichmentType: 'temporal',
      processedCount: 1,
      results: [{id: 'b10', temporalMetadata: {startYear: 1920}}],
    });

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'temporal',
        metadataField: 'temporalMetadata',
        filterPredicate: b => !b.temporalMetadata,
        autoTrigger: false,
      }),
    );

    await act(async () => {
      await result.current.triggerBackfill();
    });

    expect(trpcVanilla.enrichment.trigger.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib1',
        bookIds: ['b10'],
        enrichmentType: 'temporal',
        overwrite: false,
      }),
    );
    expect(mockBookListSetData).toHaveBeenCalledWith(
      {libraryId: 'lib1'},
      expect.any(Function),
    );
    expect(mockBookListInvalidate).toHaveBeenCalledWith({libraryId: 'lib1'});
  });

  it('correctly maps primaryGenre to genre and calls trpc enrichment mutation', async () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b20',
        title: 'Sci-Fi Novel',
      },
    ];

    vi.mocked(trpcVanilla.enrichment.trigger.mutate).mockResolvedValueOnce({
      status: 'success',
      enrichmentType: 'genre',
      processedCount: 1,
      results: [{id: 'b20', primaryGenre: 'Science Fiction'}],
    });

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'primaryGenre',
        metadataField: 'primaryGenre',
        filterPredicate: b => !b.primaryGenre,
        autoTrigger: false,
      }),
    );

    await act(async () => {
      await result.current.triggerBackfill();
    });

    expect(trpcVanilla.enrichment.trigger.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        libraryId: 'lib1',
        bookIds: ['b20'],
        enrichmentType: 'genre',
        overwrite: false,
      }),
    );
  });

  it('allows enrichments to be cancelled/stopped via cancelEnrichment', async () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b30',
        title: 'Cancelable Book',
      },
    ];

    let resolveMutate: (val: unknown) => void;
    const mutatePromise = new Promise(resolve => {
      resolveMutate = resolve;
    });

    vi.mocked(trpcVanilla.enrichment.trigger.mutate).mockReturnValueOnce(
      mutatePromise as ReturnType<typeof trpcVanilla.enrichment.trigger.mutate>,
    );

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'genre',
        metadataField: 'genre',
        filterPredicate: () => true,
        autoTrigger: false,
      }),
    );

    let backfillPromise: Promise<void>;
    act(() => {
      backfillPromise = result.current.triggerBackfill();
    });

    expect(result.current.isBackfilling).toBe(true);

    await act(async () => {
      await result.current.cancelEnrichment();
    });

    expect(result.current.isBackfilling).toBe(false);

    // Resolve in-flight mutation
    resolveMutate!({
      status: 'success',
      enrichmentType: 'genre',
      processedCount: 1,
      results: [{id: 'b30', primaryGenre: 'Mystery'}],
    });

    await act(async () => {
      await backfillPromise;
    });

    expect(result.current.isBackfilling).toBe(false);
  });

  it('patches cache in-place on SSE batch:committed without invalidating until job:completed, and skips polling while SSE is healthy', async () => {
    vi.useFakeTimers();

    const listeners: Record<string, Array<(evt: MessageEvent) => void>> = {};

    class MockEventSource {
      static instances: MockEventSource[] = [];
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      close = vi.fn();
      constructor(readonly url: string) {
        MockEventSource.instances.push(this);
      }
      addEventListener(type: string, cb: (evt: MessageEvent) => void) {
        if (!listeners[type]) {
          listeners[type] = [];
        }
        listeners[type].push(cb);
      }
    }

    vi.stubGlobal('EventSource', MockEventSource);

    const firebaseModule = (await import('../firebase')) as unknown as {
      auth?: {currentUser?: {getIdToken?: () => Promise<string>}};
    };
    firebaseModule.auth = {
      currentUser: {
        getIdToken: vi.fn().mockResolvedValue('mock-jwt-token'),
      },
    };

    const mockStartJobMutate = vi.fn().mockResolvedValue({
      jobId: 'job-sse-1',
      status: 'running',
      totalBooks: 2,
      completedBooks: 0,
      failedBooks: 0,
      skippedBooks: 0,
    });
    const mockGetJobStatusQuery = vi.fn().mockResolvedValue({
      jobId: 'job-sse-1',
      status: 'running',
      totalBooks: 2,
      completedBooks: 1,
      failedBooks: 0,
      skippedBooks: 0,
    });

    const enrichmentClient = trpcVanilla.enrichment as unknown as {
      startJob?: {mutate: typeof mockStartJobMutate};
      getJobStatus?: {query: typeof mockGetJobStatusQuery};
    };
    enrichmentClient.startJob = {mutate: mockStartJobMutate};
    enrichmentClient.getJobStatus = {query: mockGetJobStatusQuery};

    const books: Book[] = [
      {...baseBook, id: 'b1', title: 'Book 1'},
      {...baseBook, id: 'b2', title: 'Book 2'},
    ];

    const {result} = renderHook(() =>
      useBulkEnrichment({
        books,
        isBooksLoading: false,
        libraryId: 'lib1',
        providerKey: 'genre',
        metadataField: 'genre',
        filterPredicate: b => !b.primaryGenre,
        autoTrigger: false,
      }),
    );

    await act(async () => {
      await result.current.triggerBackfill();
    });

    expect(mockStartJobMutate).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances).toHaveLength(1);

    // Advance timers by 3 seconds while SSE is healthy: polling should NOT fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockGetJobStatusQuery).not.toHaveBeenCalled();

    // Emit batch:committed with updated book payload -> patches setData, does NOT invalidate
    act(() => {
      for (const cb of listeners['batch:committed'] || []) {
        cb({
          data: JSON.stringify({
            jobId: 'job-sse-1',
            results: [{id: 'b1', primaryGenre: 'Sci-Fi'}],
            completedBooks: 1,
            totalBooks: 2,
          }),
        } as MessageEvent);
      }
    });

    expect(mockBookListSetData).toHaveBeenCalledTimes(1);
    expect(mockBookListInvalidate).not.toHaveBeenCalled();

    // Simulate SSE disconnect -> fallback polling should activate on next tick
    act(() => {
      MockEventSource.instances[0]?.onerror?.();
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(mockGetJobStatusQuery).toHaveBeenCalledTimes(1);

    // Emit job:completed -> performs final authoritative invalidation
    act(() => {
      for (const cb of listeners['job:completed'] || []) {
        cb({
          data: JSON.stringify({
            jobId: 'job-sse-1',
            status: 'completed',
            completedBooks: 2,
            failedBooks: 0,
            skippedBooks: 0,
            totalBooks: 2,
          }),
        } as MessageEvent);
      }
    });

    expect(mockBookListInvalidate).toHaveBeenCalledTimes(1);
    expect(result.current.isBackfilling).toBe(false);

    delete enrichmentClient.startJob;
    delete enrichmentClient.getJobStatus;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
