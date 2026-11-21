import {EventEmitter} from 'events';
import type {
  CanonicalEnrichmentType,
  StoredEnrichmentJobDoc,
} from '../../../schemas/libraryApi';
import {getAdminDb} from '../firebaseAdmin';
import {LibraryService} from '../library';
import {runEnrichmentJobWaveLoop} from './jobRunner';
import {
  buildJobSnapshot,
  computeUnfinishedBookIdsForJob,
  enrichmentJobConverter,
  persistJobSnapshotToFirestore,
  readLatestStoredJob,
  storedDocToSnapshot,
  tryClaimExpiredRemoteJob,
  tryMergeBooksIntoHealthyRemoteJob,
} from './jobStore';
import {
  type BookJobTelemetryEntry,
  type EnrichmentJobSnapshot,
  type EnrichmentSseEvent,
  type InternalJobState,
  JOB_LEASE_TTL_MS,
} from './jobTypes';

function generateWorkerId(): string {
  const randomSuffix = Math.random()
    .toString(36)
    .replace(/[^a-zA-Z0-9]/g, '')
    .slice(0, 8);
  return `worker_${process.pid}_${randomSuffix || '0'}`;
}

export class EnrichmentJobCoordinatorService {
  readonly workerId: string;
  private readonly jobsByLibrary = new Map<string, InternalJobState>();
  private readonly emitter = new EventEmitter();

  constructor(workerId = generateWorkerId()) {
    this.workerId = workerId;
    this.emitter.setMaxListeners(200);
  }

  private emitLibraryEvent(libraryId: string, event: EnrichmentSseEvent): void {
    this.emitter.emit(`library:${libraryId}`, event);
  }

  private markJobCancelledInMemory(job: InternalJobState): void {
    job.cancelRequested = true;
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
  }

  private markJobFencedInMemory(job: InternalJobState): void {
    job.fenced = true;
    job.pendingQueue = [];
    job.abortController.abort();
    if (this.jobsByLibrary.get(job.libraryId) === job) {
      this.jobsByLibrary.delete(job.libraryId);
    }
  }

  private async persistJobState(
    job: InternalJobState,
    snapshot: EnrichmentJobSnapshot,
  ): Promise<boolean> {
    const {fenced} = await persistJobSnapshotToFirestore(snapshot, {
      ownerUid: job.uid,
      ownerEmail: job.userEmail,
      pendingBookIds: computeUnfinishedBookIdsForJob(job),
      customGenres: job.customGenres,
      allowAiFallback: job.allowAiFallback,
      verifyLeaseOwnerId: this.workerId,
    });
    if (fenced) {
      this.markJobFencedInMemory(job);
      return false;
    }
    return true;
  }

  private async maybeClaimAndResumeStoredJob(
    libraryId: string,
    storedJob: StoredEnrichmentJobDoc,
  ): Promise<InternalJobState | EnrichmentJobSnapshot | null> {
    const now = Date.now();
    if (
      storedJob.status !== 'running' ||
      storedJob.cancelRequested ||
      !storedJob.id ||
      storedJob.leaseOwnerId === this.workerId ||
      typeof storedJob.leaseExpiresAtMs !== 'number' ||
      storedJob.leaseExpiresAtMs > now
    ) {
      return null;
    }

    const claimed = await tryClaimExpiredRemoteJob(
      libraryId,
      storedJob.id,
      this.workerId,
      now,
    );
    if (!claimed) {
      return null;
    }

    if (
      claimed.claimedDoc.status !== 'running' ||
      claimed.unfinishedBookIds.length === 0
    ) {
      const completedSnap = storedDocToSnapshot(claimed.claimedDoc);
      this.emitLibraryEvent(libraryId, {
        type: 'job:completed',
        payload: completedSnap,
      });
      return completedSnap;
    }

    const perBookStates = new Map<string, BookJobTelemetryEntry>();
    for (const [bookId, entry] of Object.entries(
      claimed.claimedDoc.perBookStates ?? {},
    )) {
      perBookStates.set(bookId, entry);
    }

    const resumedJob: InternalJobState = {
      jobId: claimed.claimedDoc.id || storedJob.id,
      uid: claimed.claimedDoc.ownerUid || 'system_recovery',
      userEmail: claimed.claimedDoc.ownerEmail,
      libraryId,
      enrichmentType: claimed.claimedDoc.enrichmentType,
      status: 'running',
      bookIds: claimed.orderedBookIds,
      totalBooksBaseline: claimed.claimedDoc.totalBooks,
      completedBooksBaseline: claimed.completedBooksBaseline,
      failedBooksBaseline: claimed.failedBooksBaseline,
      skippedBooksBaseline: claimed.skippedBooksBaseline,
      pendingQueue: [...claimed.unfinishedBookIds],
      overwrite: claimed.claimedDoc.overwrite,
      cancelRequested: false,
      fenced: false,
      leaseOwnerId: this.workerId,
      leaseExpiresAtMs:
        claimed.claimedDoc.leaseExpiresAtMs ?? now + JOB_LEASE_TTL_MS,
      customGenres: claimed.claimedDoc.customGenres,
      allowAiFallback: claimed.claimedDoc.allowAiFallback,
      startedAt: claimed.claimedDoc.startedAt,
      updatedAt: claimed.claimedDoc.updatedAtMs,
      activeWave: claimed.claimedDoc.activeWave,
      perBookStates,
      accumulatedResults: [],
      abortController: new AbortController(),
    };

    this.jobsByLibrary.set(libraryId, resumedJob);
    const snapshot = buildJobSnapshot(resumedJob);
    this.emitLibraryEvent(libraryId, {
      type: 'job:snapshot',
      payload: snapshot,
    });
    void this.runJobLoop(resumedJob);
    return resumedJob;
  }

  subscribeToLibrary(
    libraryId: string,
    listener: (event: EnrichmentSseEvent) => void,
  ): () => void {
    const channel = `library:${libraryId}`;
    let lastDeliveredVersion = 0;

    const wrappedLocalListener = (event: EnrichmentSseEvent) => {
      if (event.type === 'job:snapshot' || event.type === 'job:completed') {
        lastDeliveredVersion = Math.max(
          lastDeliveredVersion,
          event.payload.updatedAt,
        );
      }
      listener(event);
    };

    this.emitter.on(channel, wrappedLocalListener);

    let unsubscribeFirestore: (() => void) | null = null;
    try {
      const db = getAdminDb();
      const jobsQuery = db
        .collection('libraries')
        .doc(libraryId)
        .collection('jobs')
        .orderBy('startedAt', 'desc')
        .limit(1);

      unsubscribeFirestore = jobsQuery.onSnapshot(
        snap => {
          if (snap.empty || snap.docs.length === 0) {
            return;
          }
          const localJob = this.jobsByLibrary.get(libraryId);
          const docSnap = snap.docs[0];
          if (localJob && localJob.jobId === docSnap.id && !localJob.fenced) {
            return;
          }
          try {
            const parsed = enrichmentJobConverter.fromFirestore(
              libraryId,
              docSnap.id,
              docSnap.data() || {},
            );
            if (parsed.updatedAtMs <= lastDeliveredVersion) {
              return;
            }
            lastDeliveredVersion = parsed.updatedAtMs;
            const snapshot = storedDocToSnapshot(parsed);
            if (
              snapshot.status === 'completed' ||
              snapshot.status === 'cancelled' ||
              snapshot.status === 'failed'
            ) {
              listener({type: 'job:completed', payload: snapshot});
            } else {
              listener({type: 'job:snapshot', payload: snapshot});
            }
          } catch {
            // Ignore transient snapshot parse issue on stream listener
          }
        },
        () => {
          // Quietly detach Firestore listener if unavailable in local test sandbox
        },
      );
    } catch {
      unsubscribeFirestore = null;
    }

    return () => {
      this.emitter.off(channel, wrappedLocalListener);
      unsubscribeFirestore?.();
    };
  }

  async getJobStatus(
    libraryIdOrUid: string,
    _userEmail?: string,
    maybeLibraryId?: string,
  ): Promise<EnrichmentJobSnapshot | null> {
    const resolvedLibraryId = maybeLibraryId || libraryIdOrUid;
    const localJob = this.jobsByLibrary.get(resolvedLibraryId);
    if (localJob && localJob.status === 'running' && !localJob.fenced) {
      return buildJobSnapshot(localJob);
    }

    const storedJob = await readLatestStoredJob(resolvedLibraryId);
    if (storedJob) {
      const resumed = await this.maybeClaimAndResumeStoredJob(
        resolvedLibraryId,
        storedJob,
      );
      if (resumed) {
        return 'abortController' in resumed
          ? buildJobSnapshot(resumed)
          : resumed;
      }

      if (
        localJob &&
        !localJob.fenced &&
        localJob.jobId === storedJob.id &&
        localJob.updatedAt >= storedJob.updatedAtMs
      ) {
        return buildJobSnapshot(localJob);
      }
      return storedDocToSnapshot(storedJob);
    }

    if (!localJob || localJob.fenced) {
      return null;
    }
    return buildJobSnapshot(localJob);
  }

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

    let activeLocalJob = this.jobsByLibrary.get(libraryId);
    if (
      !activeLocalJob ||
      activeLocalJob.status !== 'running' ||
      activeLocalJob.fenced
    ) {
      const remoteJob = await readLatestStoredJob(libraryId);
      if (
        remoteJob &&
        remoteJob.status === 'running' &&
        !remoteJob.cancelRequested &&
        remoteJob.id
      ) {
        if (remoteJob.enrichmentType !== enrichmentType) {
          await this.cancelJob(
            uid,
            userEmail,
            {libraryId, jobId: remoteJob.id},
            {skipAccessCheck: true},
          );
        } else {
          // If another replica holds a healthy, unexpired lease for the same enrichmentType,
          // merge any new bookIds into that active Firestore job and return its snapshot
          // instead of spawning a duplicate competing worker loop.
          const mergedHealthyRemote = await tryMergeBooksIntoHealthyRemoteJob(
            libraryId,
            remoteJob.id,
            cleanBookIds,
            {overwrite, allowAiFallback},
          );
          if (mergedHealthyRemote) {
            return storedDocToSnapshot(mergedHealthyRemote);
          }

          // Otherwise, if the remote lease expired between read and merge, claim & resume it locally.
          const resumed = await this.maybeClaimAndResumeStoredJob(
            libraryId,
            remoteJob,
          );
          if (resumed) {
            if ('abortController' in resumed) {
              activeLocalJob = resumed;
            } else {
              return resumed;
            }
          }
        }
      }
    }

    if (
      activeLocalJob &&
      activeLocalJob.status === 'running' &&
      !activeLocalJob.fenced
    ) {
      if (activeLocalJob.enrichmentType === enrichmentType) {
        if (overwrite) {
          activeLocalJob.overwrite = true;
        }
        if (allowAiFallback !== undefined) {
          activeLocalJob.allowAiFallback = allowAiFallback;
        }
        const now = Date.now();
        activeLocalJob.leaseExpiresAtMs = now + JOB_LEASE_TTL_MS;
        for (const id of cleanBookIds) {
          if (!activeLocalJob.perBookStates.has(id)) {
            activeLocalJob.bookIds.push(id);
            activeLocalJob.pendingQueue.push(id);
            activeLocalJob.perBookStates.set(id, {
              bookId: id,
              stage: 'queued',
              updatedAt: now,
            });
          }
        }
        activeLocalJob.totalBooksBaseline = Math.max(
          activeLocalJob.totalBooksBaseline,
          activeLocalJob.bookIds.length,
        );
        activeLocalJob.updatedAt = now;
        const snapshot = buildJobSnapshot(activeLocalJob);
        await this.persistJobState(activeLocalJob, snapshot);
        this.emitLibraryEvent(libraryId, {
          type: 'job:snapshot',
          payload: snapshot,
        });
        return snapshot;
      } else {
        await this.cancelJob(
          uid,
          userEmail,
          {libraryId, jobId: activeLocalJob.jobId},
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
      totalBooksBaseline: cleanBookIds.length,
      completedBooksBaseline: 0,
      failedBooksBaseline: 0,
      skippedBooksBaseline: 0,
      pendingQueue: [...cleanBookIds],
      overwrite,
      cancelRequested: false,
      fenced: false,
      leaseOwnerId: this.workerId,
      leaseExpiresAtMs: now + JOB_LEASE_TTL_MS,
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
    const initialSnapshot = buildJobSnapshot(newJob);
    await this.persistJobState(newJob, initialSnapshot);
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
    if (job && !job.fenced && (!jobId || job.jobId === jobId)) {
      if (job.status === 'running' || job.status === 'cancelling') {
        this.markJobCancelledInMemory(job);
        const snapshot = buildJobSnapshot(job);
        await persistJobSnapshotToFirestore(snapshot, {
          ownerUid: job.uid,
          ownerEmail: job.userEmail,
        });
        this.emitLibraryEvent(libraryId, {
          type: 'job:completed',
          payload: snapshot,
        });
        return snapshot;
      }
      return buildJobSnapshot(job);
    }

    const remoteJob = await readLatestStoredJob(libraryId);
    if (!remoteJob) {
      return null;
    }
    if (jobId && remoteJob.id && remoteJob.id !== jobId) {
      return storedDocToSnapshot(remoteJob);
    }
    if (remoteJob.status === 'running' || remoteJob.status === 'cancelling') {
      const now = Date.now();
      const targetJobId = remoteJob.id || jobId || `job_${libraryId}`;
      const cancelledSnapshot: EnrichmentJobSnapshot = {
        ...storedDocToSnapshot(remoteJob),
        jobId: targetJobId,
        status: 'cancelled',
        cancelRequested: true,
        leaseOwnerId: undefined,
        leaseExpiresAtMs: undefined,
        activeWave: undefined,
        updatedAt: now,
        completedAt: now,
      };
      await persistJobSnapshotToFirestore(cancelledSnapshot, {
        ownerUid: remoteJob.ownerUid,
        ownerEmail: remoteJob.ownerEmail,
      });
      return cancelledSnapshot;
    }
    return storedDocToSnapshot(remoteJob);
  }

  clearLocalJobsForTesting(): void {
    for (const job of this.jobsByLibrary.values()) {
      job.fenced = true;
      job.abortController.abort();
    }
    this.jobsByLibrary.clear();
  }

  private async runJobLoop(job: InternalJobState): Promise<void> {
    await runEnrichmentJobWaveLoop(job, {
      workerId: this.workerId,
      isCurrentActiveJob: candidate =>
        this.jobsByLibrary.get(candidate.libraryId) === candidate,
      emitLibraryEvent: (libraryId, event) =>
        this.emitLibraryEvent(libraryId, event),
      markJobFencedInMemory: candidate => this.markJobFencedInMemory(candidate),
      markJobCancelledInMemory: candidate =>
        this.markJobCancelledInMemory(candidate),
      persistJobState: (candidate, snapshot) =>
        this.persistJobState(candidate, snapshot),
    });
  }
}

export const enrichmentJobCoordinator = new EnrichmentJobCoordinatorService();
