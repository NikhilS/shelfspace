import {renderHook, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {useBulkEnrichment} from './useBulkEnrichment';
import {Book} from '../types';
import {trpcVanilla} from '../lib/trpc';
import {useEntityCacheStore} from '../stores/entityCacheStore';

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
    book: {
      syncChanges: {
        query: vi.fn(),
      },
    },
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
    useEntityCacheStore.getState().clearAllEntities();
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
        metadataField: 'geo',
        filterPredicate: b => !b.geoMetadata,
        autoTrigger: false,
      }),
    );

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
        metadataField: 'geo',
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
        providerKey: 'coverImage',
        metadataField: 'coverImage',
        filterPredicate: () => true,
        autoTrigger: false,
        overwrite: false,
        ignoreUnsupportedStatus: true,
      }),
    );

    expect(result.current.booksToBackfill.map(b => b.id)).toEqual(['b1', 'b2']);
  });

  it('dispatches to trpcVanilla.enrichment.trigger.mutate during triggerBackfill and updates useEntityCacheStore', async () => {
    const books: Book[] = [
      {
        ...baseBook,
        id: 'b10',
        title: 'Novel',
      },
    ];
    useEntityCacheStore.getState().hydrateLibraryBooks('lib1', books);

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
        metadataField: 'temporal',
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
    expect(
      useEntityCacheStore.getState().booksByKey['lib1:b10']?.temporalMetadata,
    ).toEqual({startYear: 1920});
    expect(mockBookListInvalidate).toHaveBeenCalledWith({libraryId: 'lib1'});
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

  it('streams SSE over Authorization Bearer fetch, patches entity store on batch:committed, reconciles cross-replica job:snapshot via syncChanges, and falls back to polling on disconnect', async () => {
    vi.useFakeTimers();

    const encoder = new TextEncoder();
    let streamController: ReadableStreamDefaultController<Uint8Array> | null =
      null;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      },
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    });
    vi.stubGlobal('fetch', fetchMock);

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
      status: 'completed',
      totalBooks: 2,
      completedBooks: 2,
      failedBooks: 0,
      skippedBooks: 0,
    });

    vi.mocked(trpcVanilla.book.syncChanges.query).mockResolvedValue({
      upsertedBooks: [
        {
          id: 'b2',
          title: 'Book 2',
          author: 'Author 1',
          addedBy: 'user-1',
          addedAt: '2026-01-01T00:00:00.000Z',
          primaryGenre: 'History',
        },
      ],
      deletedBookIds: [],
      readingStates: {},
      syncCursorMs: Date.now() + 1000,
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
    useEntityCacheStore.getState().hydrateLibraryBooks('lib1', books);

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(calledUrl).toBe('/api/enrichment/stream?libraryId=lib1');
    expect(calledUrl).not.toContain('token=');
    expect(calledInit.headers).toEqual({
      Authorization: 'Bearer mock-jwt-token',
      Accept: 'text/event-stream',
    });

    // Advance timers by 3 seconds while Bearer SSE stream is open: polling should NOT fire
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(mockGetJobStatusQuery).not.toHaveBeenCalled();

    // Push batch:committed frame -> patches setData + useEntityCacheStore, does NOT invalidate
    await act(async () => {
      streamController?.enqueue(
        encoder.encode(
          `event: batch:committed\ndata: ${JSON.stringify({
            jobId: 'job-sse-1',
            results: [{id: 'b1', primaryGenre: 'Sci-Fi'}],
            completedBooks: 1,
            totalBooks: 2,
          })}\n\n`,
        ),
      );
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(mockBookListSetData).toHaveBeenCalledTimes(1);
    expect(
      useEntityCacheStore.getState().booksByKey['lib1:b1']?.primaryGenre,
    ).toBe('Sci-Fi');
    expect(mockBookListInvalidate).not.toHaveBeenCalled();

    // Push cross-replica job:snapshot frame where completedBooks increased to 2 without local batch:committed
    await act(async () => {
      streamController?.enqueue(
        encoder.encode(
          `event: job:snapshot\ndata: ${JSON.stringify({
            jobId: 'job-sse-1',
            status: 'running',
            completedBooks: 2,
            totalBooks: 2,
          })}\n\n`,
        ),
      );
      await vi.advanceTimersByTimeAsync(10);
    });

    expect(trpcVanilla.book.syncChanges.query).toHaveBeenCalledTimes(1);
    expect(
      useEntityCacheStore.getState().booksByKey['lib1:b2']?.primaryGenre,
    ).toBe('History');

    // Simulate stream closing mid-job (e.g., container recycle) -> fallback polling settles job
    await act(async () => {
      streamController?.close();
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(mockGetJobStatusQuery).toHaveBeenCalledTimes(1);
    expect(mockBookListInvalidate).toHaveBeenCalledTimes(1);
    expect(result.current.isBackfilling).toBe(false);

    delete enrichmentClient.startJob;
    delete enrichmentClient.getJobStatus;
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('auto-reattaches on mount when autoReattach is enabled and an active server job exists', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: new ReadableStream<Uint8Array>({
        start() {
          // Keep stream open while verifying immediate mount reattachment state
        },
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const firebaseModule = (await import('../firebase')) as unknown as {
      auth?: {currentUser?: {getIdToken?: () => Promise<string>}};
    };
    firebaseModule.auth = {
      currentUser: {
        getIdToken: vi.fn().mockResolvedValue('mock-jwt-token'),
      },
    };

    const mockGetJobStatusQuery = vi.fn().mockResolvedValue({
      jobId: 'job-existing-99',
      enrichmentType: 'coverImage',
      status: 'running',
      totalBooks: 25,
      completedBooks: 12,
      failedBooks: 1,
      skippedBooks: 2,
      activeWave: {
        waveNumber: 2,
        totalWaves: 3,
        tier: 'catalog',
        remainingInWave: 10,
      },
      perBookStates: {
        b1: {bookId: 'b1', stage: 'completed', updatedAt: Date.now()},
      },
    });

    const enrichmentClient = trpcVanilla.enrichment as unknown as {
      getJobStatus?: {query: typeof mockGetJobStatusQuery};
    };
    enrichmentClient.getJobStatus = {query: mockGetJobStatusQuery};

    const {result, unmount} = renderHook(() =>
      useBulkEnrichment({
        books: [baseBook],
        isBooksLoading: false,
        libraryId: 'lib-reattach',
        providerKey: 'geo',
        metadataField: 'geo',
        filterPredicate: () => false,
        autoTrigger: false,
        autoReattach: true,
        reattachAnyType: true,
      }),
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockGetJobStatusQuery).toHaveBeenCalledWith({
      libraryId: 'lib-reattach',
    });
    expect(result.current.isBackfilling).toBe(true);
    expect(result.current.activeJobId).toBe('job-existing-99');
    expect(result.current.activeEnrichmentType).toBe('coverImage');
    expect(result.current.progress).toEqual({
      completed: 12,
      failed: 3,
      total: 25,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/enrichment/stream?libraryId=lib-reattach',
      expect.objectContaining({method: 'GET'}),
    );

    unmount();
    delete enrichmentClient.getJobStatus;
    vi.unstubAllGlobals();
  });
});
