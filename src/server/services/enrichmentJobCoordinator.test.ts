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
          status: 'success',
          enrichmentType: input.enrichmentType ?? 'coverImage',
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
          status: 'success',
          enrichmentType: input.enrichmentType ?? 'geo',
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

  it('runs a multi-tier Horizontal Wave Sieve (Decision -> Catalog -> Generative) and creates downstream batches strictly from escalated residuals', async () => {
    const escalatedFromWave0 = new Set(
      Array.from({length: 12}, (_, i) => `s_book_${i + 1}`),
    );
    const escalatedFromWave1 = new Set(['s_book_1', 's_book_2', 's_book_3']);

    const triggerSpy = vi
      .spyOn(EnrichmentService, 'triggerBatchEnrichment')
      .mockImplementation(async (_uid, _email, input, options) => {
        const stageIdx = options?.stageIndex ?? 0;

        if (stageIdx === 0) {
          const escalatedBooks = input.bookIds
            .filter(id => escalatedFromWave0.has(id))
            .map(bookId => ({
              bookId,
              state: {enrichedBook: {title: `Title ${bookId}`}},
            }));
          for (const id of input.bookIds) {
            if (escalatedFromWave0.has(id)) {
              options?.callbacks?.onBookProgress?.({
                bookId: id,
                stage: 'evaluating_decisions',
              });
            } else {
              // Pruned standalone book in Wave 0
              options?.callbacks?.onBookProgress?.({
                bookId: id,
                stage: 'skipped',
              });
            }
          }
          return {
            status: 'success',
            enrichmentType: 'series',
            processedCount: 0,
            results: [],
            escalatedBooks,
            prunedCount: input.bookIds.length - escalatedBooks.length,
          };
        }

        if (stageIdx === 1) {
          const escalatedBooks = input.bookIds
            .filter(id => escalatedFromWave1.has(id))
            .map(bookId => ({
              bookId,
              state: {bonusCatalog: {publishedDate: '2020'}},
            }));
          const resolvedIds = input.bookIds.filter(
            id => !escalatedFromWave1.has(id),
          );
          for (const id of input.bookIds) {
            if (escalatedFromWave1.has(id)) {
              options?.callbacks?.onBookProgress?.({
                bookId: id,
                stage: 'fetching_catalog',
              });
            } else {
              options?.callbacks?.onBookProgress?.({
                bookId: id,
                stage: 'completed',
                winningProviders: {series: 'open_library'},
                updatedFields: ['series'],
              });
            }
          }
          return {
            status: 'success',
            enrichmentType: 'series',
            processedCount: resolvedIds.length,
            results: resolvedIds.map(id => ({id, series: 'Culture #1'})),
            escalatedBooks,
          };
        }

        for (const id of input.bookIds) {
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: 'completed',
            winningProviders: {series: 'gemini_generative'},
            updatedFields: ['series'],
          });
        }
        return {
          status: 'success',
          enrichmentType: 'series',
          processedCount: input.bookIds.length,
          results: input.bookIds.map(id => ({id, series: 'hainish #1'})),
          escalatedBooks: [],
        };
      });

    const committedWaves: Array<{
      waveNumber?: number;
      tier?: string;
      skippedBooks: number;
      completedBooks: number;
    }> = [];

    const completedPromise = new Promise<void>(resolve => {
      const unsub = enrichmentJobCoordinator.subscribeToLibrary(
        'lib_sieve',
        evt => {
          if (evt.type === 'batch:committed') {
            committedWaves.push({
              waveNumber: evt.payload.activeWave?.waveNumber,
              tier: evt.payload.activeWave?.tier,
              skippedBooks: evt.payload.skippedBooks,
              completedBooks: evt.payload.completedBooks,
            });
          } else if (evt.type === 'job:completed') {
            unsub();
            resolve();
          }
        },
      );
    });

    const bookIds = Array.from({length: 35}, (_, i) => `s_book_${i + 1}`);
    await enrichmentJobCoordinator.startJob(
      'uid_1',
      'user@example.com',
      {
        libraryId: 'lib_sieve',
        enrichmentType: 'series',
        bookIds,
        overwrite: false,
      },
      {skipAccessCheck: true},
    );

    await completedPromise;

    // Wave 0 (decision, batch 30): 30 + 5 = 2 calls
    // Wave 1 (catalog, batch 10): 12 residuals -> 10 + 2 = 2 calls
    // Wave 2 (generative, batch 20): 3 residuals -> 3 = 1 call
    // Total = 5 calls across 3 horizontal waves
    expect(triggerSpy).toHaveBeenCalledTimes(5);
    expect(triggerSpy.mock.calls[0][2].bookIds).toHaveLength(30);
    expect(triggerSpy.mock.calls[0][3]?.stageIndex).toBe(0);
    expect(triggerSpy.mock.calls[1][2].bookIds).toHaveLength(5);
    expect(triggerSpy.mock.calls[1][3]?.stageIndex).toBe(0);
    expect(triggerSpy.mock.calls[2][2].bookIds).toHaveLength(10);
    expect(triggerSpy.mock.calls[2][3]?.stageIndex).toBe(1);
    expect(triggerSpy.mock.calls[3][2].bookIds).toHaveLength(2);
    expect(triggerSpy.mock.calls[3][3]?.stageIndex).toBe(1);
    expect(triggerSpy.mock.calls[4][2].bookIds).toHaveLength(3);
    expect(triggerSpy.mock.calls[4][3]?.stageIndex).toBe(2);

    // After Wave 0 finishes (committedWaves[1]), only the 23 pruned standalone books
    // should be counted as skipped; the 12 escalated books must NOT be marked skipped
    expect(committedWaves[1]?.waveNumber).toBe(1);
    expect(committedWaves[1]?.tier).toBe('decision');
    expect(committedWaves[1]?.skippedBooks).toBe(23);

    const finalSnap = enrichmentJobCoordinator.getJobStatus('lib_sieve');
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(12); // 9 catalog + 3 generative
    expect(finalSnap?.skippedBooks).toBe(23); // 23 standalone pruned in Wave 0
    expect(finalSnap?.activeWave).toBeUndefined();
  });
});
