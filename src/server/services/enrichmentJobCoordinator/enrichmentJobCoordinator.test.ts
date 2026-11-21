import {beforeEach, describe, expect, it, vi} from 'vitest';
import {createFakeFirestore} from '../../testing/fakeFirestore';
import {EnrichmentService} from '../enrichmentService';
import * as adminModule from '../firebaseAdmin';
import {
  enrichmentJobCoordinator,
  EnrichmentJobCoordinatorService,
  type EnrichmentSseEvent,
} from './index';

vi.mock('../library', () => ({
  LibraryService: {
    verifyLibraryAccess: vi.fn().mockResolvedValue(true),
  },
}));

describe('EnrichmentJobCoordinatorService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    enrichmentJobCoordinator.clearLocalJobsForTesting();
    const {db} = createFakeFirestore();
    vi.spyOn(adminModule, 'getAdminDb').mockReturnValue(db);
  });

  it('processes queued books in micro-batches, persists job ledger in Firestore, and transitions states from queued to completed/skipped', async () => {
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
    expect(initialSnap.leaseOwnerId).toBe(enrichmentJobCoordinator.workerId);
    expect(typeof initialSnap.leaseExpiresAtMs).toBe('number');
    expect(typeof initialSnap.providerTelemetry.totalInFlight).toBe('number');
    expect(initialSnap.providerTelemetry.maxGlobalConcurrent).toBe(24);

    await completedPromise;

    expect(triggerSpy).toHaveBeenCalledTimes(2);

    // Simulate a different stateless Cloud Run replica with empty local RAM reading job status from Firestore
    enrichmentJobCoordinator.clearLocalJobsForTesting();
    const finalSnap = await enrichmentJobCoordinator.getJobStatus('lib_test_1');
    expect(finalSnap).not.toBeNull();
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(11);
    expect(finalSnap?.skippedBooks).toBe(1);
    expect(finalSnap?.perBookStates['b1']?.stage).toBe('completed');
    expect(finalSnap?.perBookStates['b3']?.stage).toBe('skipped');
  });

  it('supports cross-replica cooperative cancellation via Firestore cancelRequested flag', async () => {
    vi.spyOn(EnrichmentService, 'triggerBatchEnrichment').mockImplementation(
      async (_uid, _email, input, options) => {
        for (const id of input.bookIds) {
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: 'completed',
            winningProviders: {coverImage: 'open_library'},
            updatedFields: ['coverUrl'],
          });
        }
        const db = adminModule.getAdminDb();
        const snap = await db
          .collection('libraries')
          .doc(input.libraryId)
          .collection('jobs')
          .limit(1)
          .get();
        if (!snap.empty) {
          await snap.docs[0].ref.update({
            cancelRequested: true,
            status: 'cancelled',
          });
        }
        return {
          status: 'success',
          enrichmentType: 'coverImage',
          processedCount: input.bookIds.length,
          results: input.bookIds.map(id => ({id})),
        };
      },
    );

    const completedPromise = new Promise<void>(resolve => {
      const unsub = enrichmentJobCoordinator.subscribeToLibrary(
        'lib_cross_cancel',
        evt => {
          if (evt.type === 'job:completed') {
            unsub();
            resolve();
          }
        },
      );
    });

    const bookIds = Array.from({length: 25}, (_, idx) => `c_${idx + 1}`);
    await enrichmentJobCoordinator.startJob(
      'uid_1',
      'user@example.com',
      {
        libraryId: 'lib_cross_cancel',
        enrichmentType: 'coverImage',
        bookIds,
      },
      {skipAccessCheck: true},
    );

    await completedPromise;

    const finalSnap =
      await enrichmentJobCoordinator.getJobStatus('lib_cross_cancel');
    expect(finalSnap?.status).toBe('cancelled');
    expect(finalSnap?.cancelRequested).toBe(true);
    expect(finalSnap?.completedBooks).toBe(10);
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

    const finalSnap =
      await enrichmentJobCoordinator.getJobStatus('lib_preempt');
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

    expect(committedWaves[1]?.waveNumber).toBe(1);
    expect(committedWaves[1]?.tier).toBe('decision');
    expect(committedWaves[1]?.skippedBooks).toBe(23);

    const finalSnap = await enrichmentJobCoordinator.getJobStatus('lib_sieve');
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(12);
    expect(finalSnap?.skippedBooks).toBe(23);
    expect(finalSnap?.activeWave).toBeUndefined();
  });

  it('relays Firestore onSnapshot job updates across independent worker replicas and auto-resumes expired worker leases', async () => {
    const replicaA = new EnrichmentJobCoordinatorService('worker_replica_a');
    const replicaB = new EnrichmentJobCoordinatorService('worker_replica_b');

    let stallReplicaAOnSecondBatch: (() => void) | null = null;
    const processedByBook = new Map<string, number>();

    vi.spyOn(EnrichmentService, 'triggerBatchEnrichment').mockImplementation(
      async (uid, _email, input, options) => {
        // Stall Replica A when it attempts the second micro-batch (b11..b15)
        if (uid === 'uid_replica_a' && input.bookIds.includes('b11')) {
          await new Promise<void>(resolve => {
            stallReplicaAOnSecondBatch = resolve;
            options?.callbacks?.signal?.addEventListener(
              'abort',
              () => resolve(),
              {once: true},
            );
          });
          if (options?.callbacks?.signal?.aborted) {
            return {
              status: 'success',
              enrichmentType: 'coverImage',
              processedCount: 0,
              results: [],
            };
          }
        }

        for (const id of input.bookIds) {
          processedByBook.set(id, (processedByBook.get(id) ?? 0) + 1);
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: 'completed',
            winningProviders: {coverImage: 'open_library'},
            updatedFields: ['coverUrl'],
          });
        }

        return {
          status: 'success',
          enrichmentType: 'coverImage',
          processedCount: input.bookIds.length,
          results: input.bookIds.map(id => ({id})),
        };
      },
    );

    const replicaBEvents: EnrichmentSseEvent[] = [];
    const replicaBCompleted = new Promise<void>(resolve => {
      const unsub = replicaB.subscribeToLibrary('lib_lease_takeover', evt => {
        replicaBEvents.push(evt);
        if (evt.type === 'job:completed') {
          unsub();
          resolve();
        }
      });
    });

    const allBookIds = Array.from({length: 15}, (_, i) => `b${i + 1}`);
    const started = await replicaA.startJob(
      'uid_replica_a',
      'reader@example.com',
      {
        libraryId: 'lib_lease_takeover',
        enrichmentType: 'coverImage',
        bookIds: allBookIds,
      },
      {skipAccessCheck: true},
    );

    // Wait until Replica A finishes batch 1 (b1..b10) and stalls on batch 2
    await vi.waitFor(() => {
      expect(stallReplicaAOnSecondBatch).not.toBeNull();
    });

    // Verify Replica B received live job:snapshot over Firestore onSnapshot from Replica A's batch 1 commit
    await vi.waitFor(() => {
      expect(
        replicaBEvents.some(
          e => e.type === 'job:snapshot' && e.payload.completedBooks === 10,
        ),
      ).toBe(true);
    });

    // Simulate Replica A's 45s lease expiring in Firestore (e.g., container evicted)
    const db = adminModule.getAdminDb();
    await db
      .collection('libraries')
      .doc('lib_lease_takeover')
      .collection('jobs')
      .doc(started.jobId)
      .update({
        leaseExpiresAtMs: Date.now() - 5_000,
      });

    // Replica B checks job status -> automatically claims expired lease and resumes remaining 5 books (b11..b15)
    const claimedStatus = await replicaB.getJobStatus('lib_lease_takeover');
    expect(claimedStatus?.status).toBe('running');
    expect(claimedStatus?.leaseOwnerId).toBe('worker_replica_b');

    // Unblock stalled Replica A so we verify lease fencing prevents duplicate execution or clobbering
    (stallReplicaAOnSecondBatch as (() => void) | null)?.();

    await replicaBCompleted;

    const finalSnap = await replicaB.getJobStatus('lib_lease_takeover');
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(15);
    expect(finalSnap?.totalBooks).toBe(15);
    for (const id of allBookIds) {
      expect(processedByBook.get(id)).toBe(1);
    }

    replicaA.clearLocalJobsForTesting();
    replicaB.clearLocalJobsForTesting();
  });

  it('merges incoming books into a healthy remote lease instead of spawning a duplicate worker loop', async () => {
    const replicaA = new EnrichmentJobCoordinatorService('worker_healthy_a');
    const replicaB = new EnrichmentJobCoordinatorService('worker_healthy_b');

    let unblockReplicaA: (() => void) | null = null;
    const executedWorkers = new Set<string>();
    const processedBookIds: string[] = [];

    vi.spyOn(EnrichmentService, 'triggerBatchEnrichment').mockImplementation(
      async (uid, _email, input, options) => {
        executedWorkers.add(uid);
        if (input.bookIds.includes('b1') && !unblockReplicaA) {
          await new Promise<void>(resolve => {
            unblockReplicaA = resolve;
          });
        }
        for (const id of input.bookIds) {
          processedBookIds.push(id);
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: 'completed',
            winningProviders: {coverImage: 'open_library'},
            updatedFields: ['coverUrl'],
          });
        }
        return {
          status: 'success',
          enrichmentType: 'coverImage',
          processedCount: input.bookIds.length,
          results: input.bookIds.map(id => ({id})),
        };
      },
    );

    const donePromise = new Promise<void>(resolve => {
      const unsub = replicaA.subscribeToLibrary('lib_healthy_join', evt => {
        if (evt.type === 'job:completed') {
          unsub();
          resolve();
        }
      });
    });

    const firstSnap = await replicaA.startJob(
      'uid_worker_a',
      'a@example.com',
      {
        libraryId: 'lib_healthy_join',
        enrichmentType: 'coverImage',
        bookIds: ['b1', 'b2'],
      },
      {skipAccessCheck: true},
    );

    await vi.waitFor(() => {
      expect(unblockReplicaA).not.toBeNull();
    });

    // Replica B receives startJob with overlapping + new book ('b2', 'b3') while Replica A's lease is healthy
    const joinedSnap = await replicaB.startJob(
      'uid_worker_b',
      'b@example.com',
      {
        libraryId: 'lib_healthy_join',
        enrichmentType: 'coverImage',
        bookIds: ['b2', 'b3'],
      },
      {skipAccessCheck: true},
    );

    expect(joinedSnap.jobId).toBe(firstSnap.jobId);
    expect(joinedSnap.leaseOwnerId).toBe('worker_healthy_a');
    expect(joinedSnap.totalBooks).toBe(3);

    (unblockReplicaA as (() => void) | null)?.();
    await donePromise;

    // Only Replica A ran the worker loop, and it absorbed 'b3' from Firestore seamlessly!
    expect(Array.from(executedWorkers)).toEqual(['uid_worker_a']);
    expect(processedBookIds.sort()).toEqual(['b1', 'b2', 'b3']);

    const finalSnap = await replicaB.getJobStatus('lib_healthy_join');
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(3);
    expect(finalSnap?.totalBooks).toBe(3);

    replicaA.clearLocalJobsForTesting();
    replicaB.clearLocalJobsForTesting();
  });

  it('preserves exact completedBooks across lease takeover on >500-book libraries when perBookStates trims older entries', async () => {
    const replicaB = new EnrichmentJobCoordinatorService('worker_large_b');
    const db = adminModule.getAdminDb();

    // Seed an expired remote job where 600 of 610 books completed,
    // and perBookStates was trimmed to the 500 most recent (490 completed + 10 queued).
    const now = Date.now();
    const states: Record<
      string,
      {bookId: string; stage: 'completed' | 'queued'; updatedAt: number}
    > = {};
    for (let i = 111; i <= 600; i++) {
      states[`book_${i}`] = {
        bookId: `book_${i}`,
        stage: 'completed',
        updatedAt: now - 10_000,
      };
    }
    const remainingIds: string[] = [];
    for (let i = 601; i <= 610; i++) {
      const id = `book_${i}`;
      remainingIds.push(id);
      states[id] = {
        bookId: id,
        stage: 'queued',
        updatedAt: now - 5_000,
      };
    }

    await db
      .collection('libraries')
      .doc('lib_large_610')
      .collection('jobs')
      .doc('job_large_610')
      .set({
        id: 'job_large_610',
        libraryId: 'lib_large_610',
        ownerUid: 'uid_1',
        leaseOwnerId: 'worker_dead_a',
        leaseExpiresAtMs: now - 5_000,
        enrichmentType: 'coverImage',
        status: 'running',
        totalBooks: 610,
        completedBooks: 600,
        failedBooks: 0,
        skippedBooks: 0,
        overwrite: false,
        cancelRequested: false,
        pendingBookIds: remainingIds,
        perBookStates: states,
        startedAt: now - 60_000,
        updatedAtMs: now - 5_000,
        updatedAt: new Date(now - 5_000).toISOString(),
      });

    vi.spyOn(EnrichmentService, 'triggerBatchEnrichment').mockImplementation(
      async (_uid, _email, input, options) => {
        for (const id of input.bookIds) {
          options?.callbacks?.onBookProgress?.({
            bookId: id,
            stage: 'completed',
            winningProviders: {coverImage: 'open_library'},
            updatedFields: ['coverUrl'],
          });
        }
        return {
          status: 'success',
          enrichmentType: 'coverImage',
          processedCount: input.bookIds.length,
          results: input.bookIds.map(id => ({id})),
        };
      },
    );

    const donePromise = new Promise<void>(resolve => {
      const unsub = replicaB.subscribeToLibrary('lib_large_610', evt => {
        if (evt.type === 'job:completed') {
          unsub();
          resolve();
        }
      });
    });

    const claimed = await replicaB.getJobStatus('lib_large_610');
    expect(claimed?.completedBooks).toBe(600);
    expect(claimed?.totalBooks).toBe(610);

    await donePromise;

    const finalSnap = await replicaB.getJobStatus('lib_large_610');
    expect(finalSnap?.status).toBe('completed');
    expect(finalSnap?.completedBooks).toBe(610);
    expect(finalSnap?.totalBooks).toBe(610);

    replicaB.clearLocalJobsForTesting();
  });
});
