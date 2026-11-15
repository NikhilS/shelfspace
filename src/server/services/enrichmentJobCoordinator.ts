import {EventEmitter} from 'events';
import {
  EnrichmentService,
  PerBookJobStage,
  PerBookProgressUpdate,
} from './enrichmentService';
import {
  globalProviderGovernor,
  ProviderTelemetrySummary,
} from './scheduler/globalProviderGovernor';
import {LibraryService} from './library';
import {
  ENRICHMENT_CONSTANTS,
  type EnrichmentTier,
} from '../../constants/enrichment';
import {CanonicalEnrichmentType} from '../../schemas/libraryApi';
import type {StageEscalationState} from '../../types/metadata';

export type EnrichmentJobStatus =
  'idle' | 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';

export interface BookJobTelemetryEntry {
  bookId: string;
  stage: PerBookJobStage;
  winningProviders?: Record<string, string>;
  updatedFields?: string[];
  error?: string;
  updatedAt: number;
}

export interface ActiveEnrichmentWave {
  waveNumber: number;
  totalWaves: number;
  tier: EnrichmentTier;
  remainingInWave: number;
}

export interface EnrichmentJobSnapshot {
  jobId: string;
  libraryId: string;
  status: EnrichmentJobStatus;
  enrichmentType: CanonicalEnrichmentType;
  totalBooks: number;
  completedBooks: number;
  failedBooks: number;
  skippedBooks: number;
  overwrite: boolean;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  activeWave?: ActiveEnrichmentWave;
  perBookStates: Record<string, BookJobTelemetryEntry>;
  providerTelemetry: ProviderTelemetrySummary;
  results: Array<Record<string, unknown>>;
}

export type EnrichmentSseEvent =
  | {type: 'job:snapshot'; payload: EnrichmentJobSnapshot}
  | {
      type: 'book:progress';
      payload: {
        jobId: string;
        libraryId: string;
        book: BookJobTelemetryEntry;
        completedBooks: number;
        failedBooks: number;
        skippedBooks: number;
        totalBooks: number;
      };
    }
  | {
      type: 'provider:telemetry';
      payload: {
        jobId: string;
        libraryId: string;
        telemetry: ProviderTelemetrySummary;
      };
    }
  | {
      type: 'batch:committed';
      payload: {
        jobId: string;
        libraryId: string;
        enrichmentType: CanonicalEnrichmentType;
        results: Array<Record<string, unknown>>;
        completedBooks: number;
        failedBooks: number;
        skippedBooks: number;
        totalBooks: number;
        activeWave?: ActiveEnrichmentWave;
      };
    }
  | {
      type: 'job:completed';
      payload: EnrichmentJobSnapshot;
    };

interface InternalJobState {
  jobId: string;
  uid: string;
  userEmail?: string;
  libraryId: string;
  enrichmentType: CanonicalEnrichmentType;
  status: EnrichmentJobStatus;
  bookIds: string[];
  pendingQueue: string[];
  overwrite: boolean;
  customGenres?: string[];
  allowAiFallback?: boolean;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  activeWave?: ActiveEnrichmentWave;
  perBookStates: Map<string, BookJobTelemetryEntry>;
  accumulatedResults: Array<Record<string, unknown>>;
  abortController: AbortController;
}

class EnrichmentJobCoordinatorService {
  private readonly jobsByLibrary = new Map<string, InternalJobState>();
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  private buildSnapshot(job: InternalJobState): EnrichmentJobSnapshot {
    let completedBooks = 0;
    let failedBooks = 0;
    let skippedBooks = 0;
    const perBookRecord: Record<string, BookJobTelemetryEntry> = {};

    for (const [bookId, entry] of job.perBookStates.entries()) {
      perBookRecord[bookId] = entry;
      if (entry.stage === 'completed') {
        completedBooks++;
      } else if (entry.stage === 'failed') {
        failedBooks++;
      } else if (entry.stage === 'skipped') {
        skippedBooks++;
      }
    }

    return {
      jobId: job.jobId,
      libraryId: job.libraryId,
      status: job.status,
      enrichmentType: job.enrichmentType,
      totalBooks: job.bookIds.length,
      completedBooks,
      failedBooks,
      skippedBooks,
      overwrite: job.overwrite,
      startedAt: job.startedAt,
      updatedAt: job.updatedAt,
      completedAt: job.completedAt,
      ...(job.activeWave ? {activeWave: {...job.activeWave}} : {}),
      perBookStates: perBookRecord,
      providerTelemetry: globalProviderGovernor.getTelemetrySummary('BATCH'),
      results: [...job.accumulatedResults],
    };
  }

  private emitLibraryEvent(libraryId: string, event: EnrichmentSseEvent): void {
    this.emitter.emit(`library:${libraryId}`, event);
  }

  subscribeToLibrary(
    libraryId: string,
    listener: (event: EnrichmentSseEvent) => void,
  ): () => void {
    const channel = `library:${libraryId}`;
    this.emitter.on(channel, listener);
    return () => {
      this.emitter.off(channel, listener);
    };
  }

  getJobStatus(
    libraryIdOrUid: string,
    _userEmail?: string,
    maybeLibraryId?: string,
  ): EnrichmentJobSnapshot | null {
    const resolvedLibraryId = maybeLibraryId || libraryIdOrUid;
    const job = this.jobsByLibrary.get(resolvedLibraryId);
    if (!job) {
      return null;
    }
    return this.buildSnapshot(job);
  }

  /**
   * Alias for startJob used by tRPC router procedures.
   */
  async startOrJoinJob(
    uid: string,
    userEmail: string | undefined,
    input: {
      libraryId: string;
      enrichmentType: CanonicalEnrichmentType;
      bookIds: string[];
      overwrite?: boolean;
      customGenres?: string[];
      allowAiFallback?: boolean;
    },
    options?: {skipAccessCheck?: boolean},
  ): Promise<EnrichmentJobSnapshot> {
    return this.startJob(uid, userEmail, input, options);
  }

  /**
   * Starts or merges into a background enrichment job for a library.
   */
  async startJob(
    uid: string,
    userEmail: string | undefined,
    input: {
      libraryId: string;
      enrichmentType: CanonicalEnrichmentType;
      bookIds: string[];
      overwrite?: boolean;
      customGenres?: string[];
      allowAiFallback?: boolean;
    },
    options?: {skipAccessCheck?: boolean},
  ): Promise<EnrichmentJobSnapshot> {
    const {
      libraryId,
      enrichmentType,
      bookIds,
      overwrite = false,
      customGenres,
      allowAiFallback,
    } = input;

    if (!options?.skipAccessCheck) {
      await LibraryService.verifyLibraryAccess(
        uid,
        userEmail,
        libraryId,
        'editor',
      );
    }

    const cleanBookIds = Array.from(
      new Set((bookIds || []).map(id => String(id).trim()).filter(Boolean)),
    );

    const existingJob = this.jobsByLibrary.get(libraryId);
    if (existingJob && existingJob.status === 'running') {
      if (existingJob.enrichmentType === enrichmentType) {
        if (overwrite) {
          existingJob.overwrite = true;
        }
        if (allowAiFallback !== undefined) {
          existingJob.allowAiFallback = allowAiFallback;
        }
        const now = Date.now();
        for (const id of cleanBookIds) {
          if (!existingJob.perBookStates.has(id)) {
            existingJob.bookIds.push(id);
            existingJob.pendingQueue.push(id);
            existingJob.perBookStates.set(id, {
              bookId: id,
              stage: 'queued',
              updatedAt: now,
            });
          }
        }
        existingJob.updatedAt = now;
        const snapshot = this.buildSnapshot(existingJob);
        this.emitLibraryEvent(libraryId, {
          type: 'job:snapshot',
          payload: snapshot,
        });
        return snapshot;
      } else {
        // Preempt and cancel the running job of a different category before switching
        await this.cancelJob(
          uid,
          userEmail,
          {libraryId, jobId: existingJob.jobId},
          {skipAccessCheck: true},
        );
      }
    }

    const now = Date.now();
    const jobId = `job_${libraryId}_${now}_${Math.random().toString(36).slice(2, 7)}`;
    const perBookStates = new Map<string, BookJobTelemetryEntry>();
    for (const id of cleanBookIds) {
      perBookStates.set(id, {
        bookId: id,
        stage: 'queued',
        updatedAt: now,
      });
    }

    const newJob: InternalJobState = {
      jobId,
      uid,
      userEmail,
      libraryId,
      enrichmentType,
      status: cleanBookIds.length > 0 ? 'running' : 'completed',
      bookIds: [...cleanBookIds],
      pendingQueue: [...cleanBookIds],
      overwrite,
      customGenres,
      allowAiFallback,
      startedAt: now,
      updatedAt: now,
      completedAt: cleanBookIds.length === 0 ? now : undefined,
      perBookStates,
      accumulatedResults: [],
      abortController: new AbortController(),
    };

    this.jobsByLibrary.set(libraryId, newJob);
    const initialSnapshot = this.buildSnapshot(newJob);
    this.emitLibraryEvent(libraryId, {
      type: 'job:snapshot',
      payload: initialSnapshot,
    });

    if (cleanBookIds.length > 0) {
      void this.runJobLoop(newJob);
    }

    return initialSnapshot;
  }

  async cancelJob(
    uid: string,
    userEmail: string | undefined,
    libraryIdOrInput: string | {libraryId: string; jobId?: string},
    jobIdOrOptions?: string | {skipAccessCheck?: boolean},
    maybeOptions?: {skipAccessCheck?: boolean},
  ): Promise<EnrichmentJobSnapshot | null> {
    const libraryId =
      typeof libraryIdOrInput === 'string'
        ? libraryIdOrInput
        : libraryIdOrInput.libraryId;
    const jobId =
      typeof libraryIdOrInput === 'string'
        ? typeof jobIdOrOptions === 'string'
          ? jobIdOrOptions
          : undefined
        : libraryIdOrInput.jobId;
    const options =
      typeof jobIdOrOptions === 'object' && jobIdOrOptions !== null
        ? jobIdOrOptions
        : maybeOptions;

    if (!options?.skipAccessCheck) {
      await LibraryService.verifyLibraryAccess(
        uid,
        userEmail,
        libraryId,
        'editor',
      );
    }
    const job = this.jobsByLibrary.get(libraryId);
    if (!job) {
      return null;
    }
    if (jobId && job.jobId !== jobId) {
      return this.buildSnapshot(job);
    }

    if (job.status === 'running' || job.status === 'cancelling') {
      job.status = 'cancelled';
      job.pendingQueue = [];
      job.activeWave = undefined;
      job.abortController.abort();
      job.updatedAt = Date.now();
      job.completedAt = job.updatedAt;

      for (const [bookId, entry] of job.perBookStates.entries()) {
        if (
          entry.stage === 'queued' ||
          entry.stage === 'evaluating_decisions' ||
          entry.stage === 'fetching_catalog' ||
          entry.stage === 'fetching_ai'
        ) {
          job.perBookStates.set(bookId, {
            ...entry,
            stage: 'skipped',
            updatedAt: job.updatedAt,
          });
        }
      }

      const snapshot = this.buildSnapshot(job);
      this.emitLibraryEvent(libraryId, {
        type: 'job:completed',
        payload: snapshot,
      });
      return snapshot;
    }

    return this.buildSnapshot(job);
  }

  private async runJobLoop(job: InternalJobState): Promise<void> {
    let emittedTerminalEvent = false;
    const unsubscribeGovernor = globalProviderGovernor.subscribe(() => {
      if (
        job.status !== 'running' ||
        this.jobsByLibrary.get(job.libraryId) !== job
      ) {
        return;
      }
      this.emitLibraryEvent(job.libraryId, {
        type: 'provider:telemetry',
        payload: {
          jobId: job.jobId,
          libraryId: job.libraryId,
          telemetry: globalProviderGovernor.getTelemetrySummary('BATCH'),
        },
      });
    });

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
            job.abortController.signal.aborted
          ) {
            break;
          }

          const stage = stages[stageIdx];
          const batchSize = Math.max(
            1,
            stage.microBatchSize ||
              ENRICHMENT_CONSTANTS.SERVER_CHUNK_SIZE ||
              10,
          );
          const nextWaveIds: string[] = [];
          const nextWaveEscalations = new Map<
            string,
            StageEscalationState<unknown>
          >();

          for (
            let offset = 0;
            offset < waveBookIds.length;
            offset += batchSize
          ) {
            if (
              job.status !== 'running' ||
              job.abortController.signal.aborted ||
              this.jobsByLibrary.get(job.libraryId) !== job
            ) {
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
                        job.abortController.signal.aborted ||
                        this.jobsByLibrary.get(job.libraryId) !== job
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

                      const snap = this.buildSnapshot(job);
                      this.emitLibraryEvent(job.libraryId, {
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
                job.abortController.signal.aborted ||
                this.jobsByLibrary.get(job.libraryId) !== job
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
              job.updatedAt = now;

              const postBatchSnap = this.buildSnapshot(job);
              this.emitLibraryEvent(job.libraryId, {
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
              this.emitLibraryEvent(job.libraryId, {
                type: 'provider:telemetry',
                payload: {
                  jobId: job.jobId,
                  libraryId: job.libraryId,
                  telemetry:
                    globalProviderGovernor.getTelemetrySummary('BATCH'),
                },
              });
            } catch (chunkErr: unknown) {
              if (
                job.abortController.signal.aborted ||
                this.jobsByLibrary.get(job.libraryId) !== job
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

      if (job.status === 'running') {
        job.status = job.abortController.signal.aborted
          ? 'cancelled'
          : 'completed';
        job.updatedAt = Date.now();
        job.completedAt = job.updatedAt;
      } else if (job.status === 'cancelled') {
        // cancelJob already emitted job:completed
        emittedTerminalEvent = true;
      }
    } finally {
      unsubscribeGovernor();
      if (
        !emittedTerminalEvent &&
        this.jobsByLibrary.get(job.libraryId) === job
      ) {
        const finalSnapshot = this.buildSnapshot(job);
        this.emitLibraryEvent(job.libraryId, {
          type: 'job:completed',
          payload: finalSnapshot,
        });
      }
    }
  }
}

export const enrichmentJobCoordinator = new EnrichmentJobCoordinatorService();
