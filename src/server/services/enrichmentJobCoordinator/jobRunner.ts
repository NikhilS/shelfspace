import {ENRICHMENT_CONSTANTS} from '../../../constants/enrichment';
import type {StageEscalationState} from '../../../types/metadata';
import {
  EnrichmentService,
  type PerBookProgressUpdate,
} from '../enrichmentService';
import {globalProviderGovernor} from '../scheduler/globalProviderGovernor';
import {
  buildJobSnapshot,
  checkCrossReplicaCancellationOrFence,
  renewJobLeaseInFirestore,
} from './jobStore';
import {
  type BookJobTelemetryEntry,
  type EnrichmentJobSnapshot,
  type EnrichmentSseEvent,
  type InternalJobState,
  JOB_HEARTBEAT_INTERVAL_MS,
  JOB_LEASE_TTL_MS,
} from './jobTypes';

export interface RunJobWaveLoopCallbacks {
  workerId: string;
  isCurrentActiveJob: (job: InternalJobState) => boolean;
  emitLibraryEvent: (libraryId: string, event: EnrichmentSseEvent) => void;
  markJobFencedInMemory: (job: InternalJobState) => void;
  markJobCancelledInMemory: (job: InternalJobState) => void;
  persistJobState: (
    job: InternalJobState,
    snapshot: EnrichmentJobSnapshot,
  ) => Promise<boolean>;
}

export async function runEnrichmentJobWaveLoop(
  job: InternalJobState,
  callbacks: RunJobWaveLoopCallbacks,
): Promise<void> {
  const {
    workerId,
    isCurrentActiveJob,
    emitLibraryEvent,
    markJobFencedInMemory,
    markJobCancelledInMemory,
    persistJobState,
  } = callbacks;

  let emittedTerminalEvent = false;
  const unsubscribeGovernor = globalProviderGovernor.subscribe(() => {
    if (job.status !== 'running' || job.fenced || !isCurrentActiveJob(job)) {
      return;
    }
    emitLibraryEvent(job.libraryId, {
      type: 'provider:telemetry',
      payload: {
        jobId: job.jobId,
        libraryId: job.libraryId,
        telemetry: globalProviderGovernor.getTelemetrySummary('BATCH'),
      },
    });
  });

  const heartbeatTimer = setInterval(() => {
    void (async () => {
      if (job.status !== 'running' || job.fenced || !isCurrentActiveJob(job)) {
        return;
      }
      const leaseState = await renewJobLeaseInFirestore(job, workerId);
      if (leaseState.fenced) {
        markJobFencedInMemory(job);
      } else if (leaseState.cancelled) {
        markJobCancelledInMemory(job);
      }
    })();
  }, JOB_HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();

  try {
    const configuredStages = EnrichmentService.getPipelineStages(
      job.enrichmentType,
    );
    const stages =
      Array.isArray(configuredStages) && configuredStages.length > 0
        ? configuredStages
        : [
            {
              stageIndex: 0,
              id: `${job.enrichmentType}-default`,
              tier: 'catalog' as const,
              microBatchSize:
                ENRICHMENT_CONSTANTS.MICRO_BATCH_COMMIT_SIZE || 10,
              progressStage: 'fetching_catalog' as const,
            },
          ];

    while (
      job.pendingQueue.length > 0 &&
      job.status === 'running' &&
      !job.fenced &&
      !job.abortController.signal.aborted
    ) {
      const initialWaveIds = job.pendingQueue.splice(
        0,
        job.pendingQueue.length,
      );
      if (initialWaveIds.length === 0) {
        break;
      }

      let waveBookIds = initialWaveIds;
      let waveEscalations = new Map<string, StageEscalationState<unknown>>();

      for (let stageIdx = 0; stageIdx < stages.length; stageIdx++) {
        if (
          waveBookIds.length === 0 ||
          job.status !== 'running' ||
          job.fenced ||
          job.abortController.signal.aborted
        ) {
          break;
        }

        const stage = stages[stageIdx];
        const batchSize = Math.max(
          1,
          stage.microBatchSize || ENRICHMENT_CONSTANTS.SERVER_CHUNK_SIZE || 10,
        );
        const nextWaveIds: string[] = [];
        const nextWaveEscalations = new Map<
          string,
          StageEscalationState<unknown>
        >();

        for (let offset = 0; offset < waveBookIds.length; offset += batchSize) {
          if (
            job.status !== 'running' ||
            job.fenced ||
            job.abortController.signal.aborted ||
            !isCurrentActiveJob(job)
          ) {
            break;
          }

          const preCheck = await checkCrossReplicaCancellationOrFence(
            job,
            workerId,
          );
          if (preCheck === 'fenced') {
            markJobFencedInMemory(job);
            break;
          }
          if (preCheck === 'cancelled') {
            markJobCancelledInMemory(job);
            break;
          }

          const microBatch = waveBookIds.slice(offset, offset + batchSize);
          if (microBatch.length === 0) {
            continue;
          }

          job.activeWave = {
            waveNumber: stageIdx + 1,
            totalWaves: stages.length,
            tier: stage.tier,
            remainingInWave: Math.max(0, waveBookIds.length - offset),
          };

          try {
            const result = await EnrichmentService.triggerBatchEnrichment(
              job.uid,
              job.userEmail,
              {
                libraryId: job.libraryId,
                enrichmentType: job.enrichmentType,
                bookIds: microBatch,
                overwrite: job.overwrite,
                customGenres: job.customGenres,
                allowAiFallback: job.allowAiFallback,
              },
              {
                skipAccessCheck: true,
                stageIndex: stage.stageIndex,
                priorEscalations: waveEscalations,
                callbacks: {
                  signal: job.abortController.signal,
                  onBookProgress: (update: PerBookProgressUpdate) => {
                    if (
                      job.fenced ||
                      job.abortController.signal.aborted ||
                      !isCurrentActiveJob(job)
                    ) {
                      return;
                    }
                    const now = Date.now();
                    const existing = job.perBookStates.get(update.bookId);
                    const mergedProviders = {
                      ...(existing?.winningProviders || {}),
                      ...(update.winningProviders || {}),
                    };
                    const mergedFields = Array.from(
                      new Set([
                        ...(existing?.updatedFields || []),
                        ...(update.updatedFields || []),
                      ]),
                    );
                    const entry: BookJobTelemetryEntry = {
                      bookId: update.bookId,
                      stage: update.stage,
                      winningProviders:
                        Object.keys(mergedProviders).length > 0
                          ? mergedProviders
                          : undefined,
                      updatedFields:
                        mergedFields.length > 0 ? mergedFields : undefined,
                      error: update.error,
                      updatedAt: now,
                    };
                    job.perBookStates.set(update.bookId, entry);
                    job.updatedAt = now;

                    const snap = buildJobSnapshot(job);
                    emitLibraryEvent(job.libraryId, {
                      type: 'book:progress',
                      payload: {
                        jobId: job.jobId,
                        libraryId: job.libraryId,
                        book: entry,
                        completedBooks: snap.completedBooks,
                        failedBooks: snap.failedBooks,
                        skippedBooks: snap.skippedBooks,
                        totalBooks: snap.totalBooks,
                      },
                    });
                  },
                },
              },
            );

            if (
              job.fenced ||
              job.abortController.signal.aborted ||
              !isCurrentActiveJob(job)
            ) {
              break;
            }

            if (Array.isArray(result.results) && result.results.length > 0) {
              job.accumulatedResults.push(...result.results);
            }

            const escalatedSet = new Set<string>();
            if (Array.isArray(result.escalatedBooks)) {
              for (const esc of result.escalatedBooks) {
                escalatedSet.add(esc.bookId);
                nextWaveIds.push(esc.bookId);
                nextWaveEscalations.set(esc.bookId, esc.state);
              }
            }

            const now = Date.now();
            for (const bookId of microBatch) {
              const current = job.perBookStates.get(bookId);
              if (escalatedSet.has(bookId)) {
                job.perBookStates.set(bookId, {
                  bookId,
                  stage: 'queued',
                  winningProviders: current?.winningProviders,
                  updatedFields: current?.updatedFields,
                  updatedAt: now,
                });
              } else if (
                !current ||
                current.stage === 'queued' ||
                current.stage === 'evaluating_decisions' ||
                current.stage === 'fetching_catalog' ||
                current.stage === 'fetching_ai'
              ) {
                job.perBookStates.set(bookId, {
                  bookId,
                  stage: 'skipped',
                  winningProviders: current?.winningProviders,
                  updatedFields: current?.updatedFields,
                  updatedAt: now,
                });
              }
            }

            job.activeWave = {
              waveNumber: stageIdx + 1,
              totalWaves: stages.length,
              tier: stage.tier,
              remainingInWave: Math.max(
                0,
                waveBookIds.length - (offset + microBatch.length),
              ),
            };
            job.leaseExpiresAtMs = now + JOB_LEASE_TTL_MS;
            job.updatedAt = now;

            const postCheck = await checkCrossReplicaCancellationOrFence(
              job,
              workerId,
            );
            if (postCheck === 'fenced') {
              markJobFencedInMemory(job);
              break;
            }
            if (postCheck === 'cancelled') {
              markJobCancelledInMemory(job);
              break;
            }

            const postBatchSnap = buildJobSnapshot(job);
            const persisted = await persistJobState(job, postBatchSnap);
            if (!persisted) {
              break;
            }

            emitLibraryEvent(job.libraryId, {
              type: 'batch:committed',
              payload: {
                jobId: job.jobId,
                libraryId: job.libraryId,
                enrichmentType: job.enrichmentType,
                results: result.results || [],
                completedBooks: postBatchSnap.completedBooks,
                failedBooks: postBatchSnap.failedBooks,
                skippedBooks: postBatchSnap.skippedBooks,
                totalBooks: postBatchSnap.totalBooks,
                ...(postBatchSnap.activeWave
                  ? {activeWave: postBatchSnap.activeWave}
                  : {}),
              },
            });
            emitLibraryEvent(job.libraryId, {
              type: 'provider:telemetry',
              payload: {
                jobId: job.jobId,
                libraryId: job.libraryId,
                telemetry: globalProviderGovernor.getTelemetrySummary('BATCH'),
              },
            });
          } catch (chunkErr: unknown) {
            if (
              job.fenced ||
              job.abortController.signal.aborted ||
              !isCurrentActiveJob(job)
            ) {
              break;
            }
            console.error(
              `[EnrichmentJobCoordinator] Micro-batch error in job ${job.jobId}:`,
              chunkErr,
            );
            const now = Date.now();
            const errMsg =
              chunkErr instanceof Error
                ? chunkErr.message
                : 'Batch enrichment failed';
            for (const bookId of microBatch) {
              const current = job.perBookStates.get(bookId);
              job.perBookStates.set(bookId, {
                bookId,
                stage: 'failed',
                winningProviders: current?.winningProviders,
                updatedFields: current?.updatedFields,
                error: errMsg,
                updatedAt: now,
              });
            }
          }
        }

        waveBookIds = nextWaveIds;
        waveEscalations = nextWaveEscalations;
      }
    }

    job.activeWave = undefined;

    if (!job.fenced) {
      if (job.status === 'running') {
        job.status = job.abortController.signal.aborted
          ? 'cancelled'
          : 'completed';
        job.updatedAt = Date.now();
        job.completedAt = job.updatedAt;
      } else if (job.status === 'cancelled' && !job.cancelRequested) {
        emittedTerminalEvent = true;
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
    unsubscribeGovernor();
    if (!job.fenced && !emittedTerminalEvent && isCurrentActiveJob(job)) {
      const finalSnapshot = buildJobSnapshot(job);
      const persisted = await persistJobState(job, finalSnapshot);
      if (persisted) {
        emitLibraryEvent(job.libraryId, {
          type: 'job:completed',
          payload: finalSnapshot,
        });
      }
    }
  }
}
