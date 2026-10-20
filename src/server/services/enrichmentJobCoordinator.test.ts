import {describe, it, expect, vi, beforeEach} from 'vitest';
import {enrichmentJobCoordinator} from './enrichmentJobCoordinator';
import {EnrichmentService} from './enrichmentService';

vi.mock('./library', () => ({
  LibraryService: {
    verifyLibraryAccess: vi.fn().mockResolvedValue(true),
  },
}));

describe('EnrichmentJobCoordinatorService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('processes queued books in micro-batches and transitions states from queued to completed/skipped', async () => {
    const triggerSpy = vi
      .spyOn(EnrichmentService, 'triggerBatchEnrichment')
      .mockImplementation(async (_uid, _email, input, options) => {
        for (const id of input.bookIds) {
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: id === 'b3' ? 'skipped' : 'completed',
            winningProviders:
              id === 'b3' ? undefined : {coverImage: 'open_library'},
            updatedFields: id === 'b3' ? undefined : ['coverUrl'],
          });
        }
        return {
          status: 'ok',
          enrichmentType: input.enrichmentType,
          processedCount: input.bookIds.filter(id => id !== 'b3').length,
          results: input.bookIds
            .filter(id => id !== 'b3')
            .map(id => ({
              id,
              coverUrl: `https://covers.openlibrary.org/${id}.jpg`,
            })),
        };
      });

    const completedPromise = new Promise<void>(resolve => {
      const unsub = enrichmentJobCoordinator.subscribeToLibrary(
        'lib_test_1',
        evt => {
          if (evt.type === 'job:completed') {
            unsub();
            resolve();
          }
        },
      );
    });

    const initialSnap = await enrichmentJobCoordinator.startJob(
      'uid_1',
      'user@example.com',
      {
        libraryId: 'lib_test_1',
        enrichmentType: 'coverImage',
        bookIds: [
          'b1',
          'b2',
          'b3',
          'b4',
          'b5',
          'b6',
          'b7',
          'b8',
          'b9',
          'b10',
          'b11',
          'b12',
        ],
        overwrite: false,
      },
      {skipAccessCheck: true},
    );

    expect(initialSnap.totalBooks).toBe(12);
    expect(typeof initialSnap.providerTelemetry.totalInFlight).toBe('number');
    expect(initialSnap.providerTelemetry.maxGlobalConcurrent).toBe(24);

    await completedPromise;

    // 12 books with MICRO_BATCH_COMMIT_SIZE = 10 should run 2 micro-batches (10 + 2)
    expect(triggerSpy).toHaveBeenCalledTimes(2);

    const finalSnap = enrichmentJobCoordinator.getJobStatus('lib_test_1');
    expect(finalSnap).not.toBeNull();
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(11);
    expect(finalSnap?.skippedBooks).toBe(1);
    expect(finalSnap?.perBookStates['b1']?.stage).toBe('completed');
    expect(finalSnap?.perBookStates['b3']?.stage).toBe('skipped');
  });

  it('uses larger AI_MICRO_BATCH_COMMIT_SIZE (30) for structured AI enrichment flows', async () => {
    const triggerSpy = vi
      .spyOn(EnrichmentService, 'triggerBatchEnrichment')
      .mockImplementation(async (_uid, _email, input, options) => {
        for (const id of input.bookIds) {
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: 'completed',
            winningProviders: {geo: 'gemini_structured'},
            updatedFields: ['geoMetadata'],
          });
        }
        return {
          status: 'ok',
          enrichmentType: input.enrichmentType,
          processedCount: input.bookIds.length,
          results: input.bookIds.map(id => ({id})),
        };
      });

    const completedPromise = new Promise<void>(resolve => {
      const unsub = enrichmentJobCoordinator.subscribeToLibrary(
        'lib_test_ai',
        evt => {
          if (evt.type === 'job:completed') {
            unsub();
            resolve();
          }
        },
      );
    });

    const bookIds = Array.from({length: 35}, (_, i) => `ai_book_${i + 1}`);
    await enrichmentJobCoordinator.startJob(
      'uid_1',
      'user@example.com',
      {
        libraryId: 'lib_test_ai',
        enrichmentType: 'geo',
        bookIds,
        overwrite: false,
      },
      {skipAccessCheck: true},
    );

    await completedPromise;

    // 35 books with AI_MICRO_BATCH_COMMIT_SIZE = 30 should run 2 micro-batches (30 + 5)
    expect(triggerSpy).toHaveBeenCalledTimes(2);
    expect(triggerSpy.mock.calls[0][2].bookIds).toHaveLength(30);
    expect(triggerSpy.mock.calls[1][2].bookIds).toHaveLength(5);
  });

  it('preempts and cancels a running job when a different enrichmentType is started on the same library', async () => {
    let firstJobSignal: AbortSignal | undefined;

    vi.spyOn(EnrichmentService, 'triggerBatchEnrichment').mockImplementation(
      async (_uid, _email, input, options) => {
        if (input.enrichmentType === 'coverImage') {
          firstJobSignal = options?.callbacks?.signal;
          await new Promise(resolve => setTimeout(resolve, 60));
          return {
            status: 'success',
            enrichmentType: 'coverImage',
            processedCount: 0,
            results: [],
          };
        }
        for (const id of input.bookIds) {
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: 'completed',
            winningProviders: {genre: 'gemini_structured'},
            updatedFields: ['genre'],
          });
        }
        return {
          status: 'success',
          enrichmentType: 'genre',
          processedCount: input.bookIds.length,
          results: input.bookIds.map(id => ({id, primaryGenre: 'Fiction'})),
        };
      },
    );

    const firstSnap = await enrichmentJobCoordinator.startJob(
      'uid_1',
      'user@example.com',
      {
        libraryId: 'lib_preempt',
        enrichmentType: 'coverImage',
        bookIds: ['c1', 'c2'],
      },
      {skipAccessCheck: true},
    );

    expect(firstSnap.status).toBe('running');

    const secondCompleted = new Promise<void>(resolve => {
      const unsub = enrichmentJobCoordinator.subscribeToLibrary(
        'lib_preempt',
        evt => {
          if (
            evt.type === 'job:completed' &&
            evt.payload.enrichmentType === 'genre'
          ) {
            unsub();
            resolve();
          }
        },
      );
    });

    const secondSnap = await enrichmentJobCoordinator.startJob(
      'uid_1',
      'user@example.com',
      {
        libraryId: 'lib_preempt',
        enrichmentType: 'genre',
        bookIds: ['g1', 'g2', 'g3'],
      },
      {skipAccessCheck: true},
    );

    expect(firstJobSignal?.aborted).toBe(true);
    expect(secondSnap.enrichmentType).toBe('genre');
    expect(secondSnap.totalBooks).toBe(3);

    await secondCompleted;

    const finalSnap = enrichmentJobCoordinator.getJobStatus('lib_preempt');
    expect(finalSnap?.jobId).toBe(secondSnap.jobId);
    expect(finalSnap?.enrichmentType).toBe('genre');
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(3);
  });
});
