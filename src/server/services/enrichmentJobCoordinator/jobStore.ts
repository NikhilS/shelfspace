import {
  SchemaValidationError,
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../../schemas/common';
import {
  storedEnrichmentJobDocSchema,
  type StoredEnrichmentJobDoc,
} from '../../../schemas/libraryApi';
import {normalizeFirestoreTimestamp} from '../book/bookPartitioner';
import {getAdminDb} from '../firebaseAdmin';
import {globalProviderGovernor} from '../scheduler/globalProviderGovernor';
import {
  type BookJobTelemetryEntry,
  type EnrichmentJobSnapshot,
  type InternalJobState,
  JOB_LEASE_TTL_MS,
} from './jobTypes';

const MAX_PERSISTED_BOOK_STATES = 500;
const MAX_PERSISTED_PENDING_BOOK_IDS = 5000;

function isTerminalBookStage(stage: string): boolean {
  return stage === 'completed' || stage === 'skipped' || stage === 'failed';
}

function countTerminalBookStages(
  states: Record<string, BookJobTelemetryEntry>,
): {completed: number; failed: number; skipped: number} {
  let completed = 0;
  let failed = 0;
  let skipped = 0;
  for (const entry of Object.values(states)) {
    if (entry.stage === 'completed') {
      completed++;
    } else if (entry.stage === 'failed') {
      failed++;
    } else if (entry.stage === 'skipped') {
      skipped++;
    }
  }
  return {completed, failed, skipped};
}

function absorbRemotePendingBookIds(
  job: InternalJobState,
  stored: StoredEnrichmentJobDoc,
  nowMs: number,
): void {
  if (!stored.pendingBookIds || stored.pendingBookIds.length === 0) {
    return;
  }
  const knownIds = new Set(job.bookIds);
  for (const id of job.pendingQueue) {
    knownIds.add(id);
  }
  for (const id of stored.pendingBookIds) {
    if (!knownIds.has(id) && !job.perBookStates.has(id)) {
      knownIds.add(id);
      job.bookIds.push(id);
      job.pendingQueue.push(id);
      job.perBookStates.set(id, {
        bookId: id,
        stage: 'queued',
        updatedAt: nowMs,
      });
    }
  }
  if (stored.overwrite && !job.overwrite) {
    job.overwrite = true;
  }
  job.totalBooksBaseline = Math.max(
    job.totalBooksBaseline,
    stored.totalBooks,
    job.bookIds.length,
  );
}

function trimPerBookStatesForFirestore(
  states: Record<string, BookJobTelemetryEntry>,
): Record<string, BookJobTelemetryEntry> {
  const entries = Object.entries(states);
  if (entries.length <= MAX_PERSISTED_BOOK_STATES) {
    return states;
  }
  entries.sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  const bounded: Record<string, BookJobTelemetryEntry> = {};
  for (let i = 0; i < MAX_PERSISTED_BOOK_STATES; i++) {
    const [bookId, entry] = entries[i];
    bounded[bookId] = entry;
  }
  return bounded;
}

export const enrichmentJobConverter = {
  toFirestoreWrite(
    libraryId: string,
    jobId: string,
    input: Omit<StoredEnrichmentJobDoc, 'id' | 'libraryId' | 'updatedAt'> & {
      updatedAt?: string;
    },
  ): StoredEnrichmentJobDoc {
    const boundedStates = input.perBookStates
      ? trimPerBookStatesForFirestore(input.perBookStates)
      : undefined;
    const boundedPending = input.pendingBookIds
      ? input.pendingBookIds.slice(0, MAX_PERSISTED_PENDING_BOOK_IDS)
      : undefined;

    const payload: StoredEnrichmentJobDoc = {
      id: jobId,
      libraryId,
      ...(input.ownerUid ? {ownerUid: input.ownerUid} : {}),
      ...(input.ownerEmail ? {ownerEmail: input.ownerEmail} : {}),
      ...(input.leaseOwnerId ? {leaseOwnerId: input.leaseOwnerId} : {}),
      ...(input.leaseExpiresAtMs !== undefined
        ? {leaseExpiresAtMs: input.leaseExpiresAtMs}
        : {}),
      enrichmentType: input.enrichmentType,
      status: input.status,
      totalBooks: input.totalBooks,
      completedBooks: input.completedBooks,
      failedBooks: input.failedBooks,
      skippedBooks: input.skippedBooks,
      overwrite: input.overwrite,
      cancelRequested: Boolean(input.cancelRequested),
      ...(boundedPending ? {pendingBookIds: boundedPending} : {}),
      ...(input.customGenres && input.customGenres.length > 0
        ? {customGenres: input.customGenres.slice(0, 100)}
        : {}),
      ...(input.allowAiFallback !== undefined
        ? {allowAiFallback: input.allowAiFallback}
        : {}),
      ...(input.activeWave ? {activeWave: {...input.activeWave}} : {}),
      ...(boundedStates ? {perBookStates: boundedStates} : {}),
      startedAt: input.startedAt,
      ...(input.completedAt !== undefined
        ? {completedAt: input.completedAt}
        : {}),
      updatedAtMs: input.updatedAtMs,
      updatedAt: input.updatedAt || new Date(input.updatedAtMs).toISOString(),
    };

    validateFirestoreWritePayload(storedEnrichmentJobDocSchema, payload, {
      entity: 'StoredEnrichmentJobDoc',
      documentPath: `/libraries/${libraryId}/jobs/${jobId}`,
      operation: 'upsert',
    });
    return payload;
  },

  fromFirestore(
    libraryId: string,
    jobId: string,
    raw: Record<string, unknown>,
  ): StoredEnrichmentJobDoc {
    const updatedAt = normalizeFirestoreTimestamp(raw.updatedAt);
    const candidate: Record<string, unknown> = {
      ...raw,
      id: jobId,
      libraryId:
        typeof raw.libraryId === 'string' && raw.libraryId
          ? raw.libraryId
          : libraryId,
    };
    if (updatedAt !== undefined) {
      candidate.updatedAt = updatedAt;
    } else {
      delete candidate.updatedAt;
    }
    if (
      Object.prototype.hasOwnProperty.call(raw, 'leaseOwnerInstanceId') &&
      typeof raw.leaseOwnerInstanceId === 'string'
    ) {
      if (!candidate.leaseOwnerId) {
        candidate.leaseOwnerId = raw.leaseOwnerInstanceId;
      }
      delete candidate.leaseOwnerInstanceId;
    }
    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }

    return validateFirestoreReadPayload(
      storedEnrichmentJobDocSchema,
      candidate,
      {
        entity: 'StoredEnrichmentJobDoc',
        documentPath: `/libraries/${libraryId}/jobs/${jobId}`,
        operation: 'read',
      },
    );
  },
};

export function storedDocToSnapshot(
  doc: StoredEnrichmentJobDoc,
): EnrichmentJobSnapshot {
  return {
    jobId: doc.id || 'unknown_job',
    libraryId: doc.libraryId,
    status: doc.status,
    enrichmentType: doc.enrichmentType,
    totalBooks: doc.totalBooks,
    completedBooks: doc.completedBooks,
    failedBooks: doc.failedBooks,
    skippedBooks: doc.skippedBooks,
    overwrite: doc.overwrite,
    cancelRequested: Boolean(doc.cancelRequested),
    ...(doc.leaseOwnerId ? {leaseOwnerId: doc.leaseOwnerId} : {}),
    ...(doc.leaseExpiresAtMs !== undefined
      ? {leaseExpiresAtMs: doc.leaseExpiresAtMs}
      : {}),
    startedAt: doc.startedAt,
    updatedAt: doc.updatedAtMs,
    ...(doc.completedAt !== undefined ? {completedAt: doc.completedAt} : {}),
    ...(doc.activeWave ? {activeWave: {...doc.activeWave}} : {}),
    perBookStates: doc.perBookStates ? {...doc.perBookStates} : {},
    providerTelemetry: globalProviderGovernor.getTelemetrySummary('BATCH'),
    results: [],
  };
}

export function computeUnfinishedBookIdsForJob(
  job: InternalJobState,
): string[] {
  const seen = new Set<string>();
  const unfinished: string[] = [];

  for (const id of job.bookIds) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const entry = job.perBookStates.get(id);
    if (!entry || !isTerminalBookStage(entry.stage)) {
      unfinished.push(id);
    }
  }

  for (const id of job.pendingQueue) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const entry = job.perBookStates.get(id);
    if (!entry || !isTerminalBookStage(entry.stage)) {
      unfinished.push(id);
    }
  }

  return unfinished;
}

export function buildJobSnapshot(job: InternalJobState): EnrichmentJobSnapshot {
  let countedCompleted = 0;
  let countedFailed = 0;
  let countedSkipped = 0;
  let unfinishedInMap = 0;
  const perBookRecord: Record<string, BookJobTelemetryEntry> = {};

  for (const [bookId, entry] of job.perBookStates.entries()) {
    perBookRecord[bookId] = entry;
    if (entry.stage === 'completed') {
      countedCompleted++;
    } else if (entry.stage === 'failed') {
      countedFailed++;
    } else if (entry.stage === 'skipped') {
      countedSkipped++;
    } else {
      unfinishedInMap++;
    }
  }

  const completedBooks = job.completedBooksBaseline + countedCompleted;
  const failedBooks = job.failedBooksBaseline + countedFailed;
  const skippedBooks = job.skippedBooksBaseline + countedSkipped;
  const totalBooks = Math.max(
    job.totalBooksBaseline,
    job.bookIds.length,
    completedBooks + failedBooks + skippedBooks + unfinishedInMap,
  );

  return {
    jobId: job.jobId,
    libraryId: job.libraryId,
    status: job.status,
    enrichmentType: job.enrichmentType,
    totalBooks,
    completedBooks,
    failedBooks,
    skippedBooks,
    overwrite: job.overwrite,
    cancelRequested: job.cancelRequested,
    ...(job.status === 'running'
      ? {
          leaseOwnerId: job.leaseOwnerId,
          leaseExpiresAtMs: job.leaseExpiresAtMs,
        }
      : {}),
    startedAt: job.startedAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    ...(job.activeWave ? {activeWave: {...job.activeWave}} : {}),
    perBookStates: perBookRecord,
    providerTelemetry: globalProviderGovernor.getTelemetrySummary('BATCH'),
    results: [...job.accumulatedResults],
  };
}

function isUnavailableOrUnconfiguredFirestoreError(err: unknown): boolean {
  if (!err || err instanceof SchemaValidationError) {
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as {code?: number | string})?.code;
  return (
    code === 7 ||
    code === 'permission-denied' ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('permission-denied') ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('Could not load the default credentials') ||
    msg.includes('Firebase config not found')
  );
}

export interface PersistJobMetadata {
  ownerUid?: string;
  ownerEmail?: string;
  pendingBookIds?: string[];
  customGenres?: string[];
  allowAiFallback?: boolean;
  verifyLeaseOwnerId?: string;
}

export async function persistJobSnapshotToFirestore(
  snapshot: EnrichmentJobSnapshot,
  meta: PersistJobMetadata = {},
): Promise<{fenced: boolean}> {
  if (snapshot.status === 'idle') {
    return {fenced: false};
  }
  try {
    const db = getAdminDb();
    const jobRef = db
      .collection('libraries')
      .doc(snapshot.libraryId)
      .collection('jobs')
      .doc(snapshot.jobId);

    let mergedPendingIds = meta.pendingBookIds;
    let mergedTotalBooks = snapshot.totalBooks;
    let mergedPerBookStates = snapshot.perBookStates;

    if (meta.verifyLeaseOwnerId) {
      const existingSnap = await jobRef.get();
      if (existingSnap.exists) {
        const existing = enrichmentJobConverter.fromFirestore(
          snapshot.libraryId,
          existingSnap.id,
          existingSnap.data() || {},
        );
        if (
          existing.leaseOwnerId &&
          existing.leaseOwnerId !== meta.verifyLeaseOwnerId &&
          (existing.leaseExpiresAtMs ?? 0) > Date.now()
        ) {
          return {fenced: true};
        }
        if (
          snapshot.status === 'running' &&
          existing.pendingBookIds &&
          existing.pendingBookIds.length > 0
        ) {
          const pendingSet = new Set(mergedPendingIds ?? []);
          let addedRemote = 0;
          const nextStates = {...mergedPerBookStates};
          for (const remoteId of existing.pendingBookIds) {
            if (!pendingSet.has(remoteId) && !nextStates[remoteId]) {
              pendingSet.add(remoteId);
              nextStates[remoteId] = {
                bookId: remoteId,
                stage: 'queued',
                updatedAt: snapshot.updatedAt,
              };
              addedRemote++;
            }
          }
          if (addedRemote > 0) {
            mergedPendingIds = Array.from(pendingSet);
            mergedPerBookStates = nextStates;
            mergedTotalBooks = Math.max(mergedTotalBooks, existing.totalBooks);
          }
        }
      }
    }

    const docPayload = enrichmentJobConverter.toFirestoreWrite(
      snapshot.libraryId,
      snapshot.jobId,
      {
        ownerUid: meta.ownerUid,
        ownerEmail: meta.ownerEmail,
        leaseOwnerId:
          snapshot.status === 'running' ? snapshot.leaseOwnerId : undefined,
        leaseExpiresAtMs:
          snapshot.status === 'running' ? snapshot.leaseExpiresAtMs : undefined,
        enrichmentType: snapshot.enrichmentType,
        status: snapshot.status,
        totalBooks: mergedTotalBooks,
        completedBooks: snapshot.completedBooks,
        failedBooks: snapshot.failedBooks,
        skippedBooks: snapshot.skippedBooks,
        overwrite: snapshot.overwrite,
        cancelRequested: Boolean(snapshot.cancelRequested),
        pendingBookIds:
          snapshot.status === 'running' ? mergedPendingIds : undefined,
        customGenres: meta.customGenres,
        allowAiFallback: meta.allowAiFallback,
        activeWave: snapshot.activeWave,
        perBookStates: mergedPerBookStates,
        startedAt: snapshot.startedAt,
        completedAt: snapshot.completedAt,
        updatedAtMs: snapshot.updatedAt,
      },
    );
    await jobRef.set(docPayload);
    return {fenced: false};
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    if (!isUnavailableOrUnconfiguredFirestoreError(err)) {
      console.warn(
        `[EnrichmentJobCoordinator] Failed to persist job ${snapshot.jobId}:`,
        err,
      );
    }
    return {fenced: false};
  }
}

export async function readLatestStoredJob(
  libraryId: string,
): Promise<StoredEnrichmentJobDoc | null> {
  try {
    const db = getAdminDb();
    const snap = await db
      .collection('libraries')
      .doc(libraryId)
      .collection('jobs')
      .orderBy('startedAt', 'desc')
      .limit(1)
      .get();
    if (snap.empty || snap.docs.length === 0) {
      return null;
    }
    const docSnap = snap.docs[0];
    return enrichmentJobConverter.fromFirestore(
      libraryId,
      docSnap.id,
      docSnap.data() || {},
    );
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    return null;
  }
}

export async function renewJobLeaseInFirestore(
  job: InternalJobState,
  workerId: string,
): Promise<{cancelled: boolean; fenced: boolean}> {
  if (job.status !== 'running' || job.fenced || job.cancelRequested) {
    return {cancelled: job.cancelRequested, fenced: job.fenced};
  }
  try {
    const db = getAdminDb();
    const jobRef = db
      .collection('libraries')
      .doc(job.libraryId)
      .collection('jobs')
      .doc(job.jobId);

    return await db.runTransaction(async tx => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) {
        return {cancelled: false, fenced: false};
      }
      const stored = enrichmentJobConverter.fromFirestore(
        job.libraryId,
        snap.id,
        snap.data() || {},
      );
      const now = Date.now();
      if (stored.cancelRequested || stored.status === 'cancelled') {
        return {cancelled: true, fenced: false};
      }
      if (
        stored.leaseOwnerId &&
        stored.leaseOwnerId !== workerId &&
        (stored.leaseExpiresAtMs ?? 0) > now
      ) {
        return {cancelled: false, fenced: true};
      }
      if (stored.status !== 'running') {
        return {cancelled: false, fenced: false};
      }

      absorbRemotePendingBookIds(job, stored, now);

      const nextLeaseExpiresAtMs = now + JOB_LEASE_TTL_MS;
      const updatedPayload = enrichmentJobConverter.toFirestoreWrite(
        job.libraryId,
        job.jobId,
        {
          ...stored,
          totalBooks: Math.max(stored.totalBooks, job.totalBooksBaseline),
          overwrite: job.overwrite,
          leaseOwnerId: workerId,
          leaseExpiresAtMs: nextLeaseExpiresAtMs,
          pendingBookIds: computeUnfinishedBookIdsForJob(job),
          updatedAtMs: now,
        },
      );
      tx.set(jobRef, updatedPayload);
      job.leaseOwnerId = workerId;
      job.leaseExpiresAtMs = nextLeaseExpiresAtMs;
      job.updatedAt = now;
      return {cancelled: false, fenced: false};
    });
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    return {cancelled: false, fenced: false};
  }
}

export async function checkCrossReplicaCancellationOrFence(
  job: InternalJobState,
  workerId: string,
): Promise<'active' | 'cancelled' | 'fenced'> {
  if (job.fenced) {
    return 'fenced';
  }
  if (job.cancelRequested || job.abortController.signal.aborted) {
    return 'cancelled';
  }
  try {
    const db = getAdminDb();
    const docSnap = await db
      .collection('libraries')
      .doc(job.libraryId)
      .collection('jobs')
      .doc(job.jobId)
      .get();
    if (!docSnap.exists) {
      return 'active';
    }
    const stored = enrichmentJobConverter.fromFirestore(
      job.libraryId,
      docSnap.id,
      docSnap.data() || {},
    );
    const now = Date.now();
    if (
      stored.leaseOwnerId &&
      stored.leaseOwnerId !== workerId &&
      (stored.leaseExpiresAtMs ?? 0) > now
    ) {
      return 'fenced';
    }
    if (stored.cancelRequested || stored.status === 'cancelled') {
      return 'cancelled';
    }
    absorbRemotePendingBookIds(job, stored, now);
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
  }
  return 'active';
}

export async function tryMergeBooksIntoHealthyRemoteJob(
  libraryId: string,
  jobId: string,
  incomingBookIds: string[],
  options: {overwrite?: boolean; allowAiFallback?: boolean} = {},
  nowMs = Date.now(),
): Promise<StoredEnrichmentJobDoc | null> {
  try {
    const db = getAdminDb();
    const jobRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('jobs')
      .doc(jobId);

    return await db.runTransaction(async tx => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) {
        return null;
      }
      const stored = enrichmentJobConverter.fromFirestore(
        libraryId,
        snap.id,
        snap.data() || {},
      );
      if (
        stored.status !== 'running' ||
        stored.cancelRequested ||
        typeof stored.leaseExpiresAtMs !== 'number' ||
        stored.leaseExpiresAtMs <= nowMs
      ) {
        return null;
      }

      const existingPending = new Set(stored.pendingBookIds ?? []);
      const existingStates = {...(stored.perBookStates ?? {})};
      let newlyAddedCount = 0;

      for (const rawId of incomingBookIds) {
        const id = rawId.trim();
        if (!id) {
          continue;
        }
        if (!existingPending.has(id) && !existingStates[id]) {
          existingPending.add(id);
          existingStates[id] = {
            bookId: id,
            stage: 'queued',
            updatedAt: nowMs,
          };
          newlyAddedCount++;
        }
      }

      const nextOverwrite = Boolean(stored.overwrite || options.overwrite);
      const nextAllowAi =
        options.allowAiFallback !== undefined
          ? options.allowAiFallback
          : stored.allowAiFallback;

      if (
        newlyAddedCount === 0 &&
        nextOverwrite === stored.overwrite &&
        nextAllowAi === stored.allowAiFallback
      ) {
        return stored;
      }

      const updatedDoc = enrichmentJobConverter.toFirestoreWrite(
        libraryId,
        jobId,
        {
          ...stored,
          totalBooks: stored.totalBooks + newlyAddedCount,
          overwrite: nextOverwrite,
          allowAiFallback: nextAllowAi,
          pendingBookIds: Array.from(existingPending),
          perBookStates: existingStates,
          updatedAtMs: nowMs,
        },
      );
      tx.set(jobRef, updatedDoc);
      return updatedDoc;
    });
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    return null;
  }
}

export interface ClaimedExpiredJobResult {
  claimedDoc: StoredEnrichmentJobDoc;
  unfinishedBookIds: string[];
  orderedBookIds: string[];
  completedBooksBaseline: number;
  failedBooksBaseline: number;
  skippedBooksBaseline: number;
}

export async function tryClaimExpiredRemoteJob(
  libraryId: string,
  jobId: string,
  newWorkerId: string,
  nowMs = Date.now(),
): Promise<ClaimedExpiredJobResult | null> {
  try {
    const db = getAdminDb();
    const jobRef = db
      .collection('libraries')
      .doc(libraryId)
      .collection('jobs')
      .doc(jobId);

    return await db.runTransaction(async tx => {
      const snap = await tx.get(jobRef);
      if (!snap.exists) {
        return null;
      }
      const stored = enrichmentJobConverter.fromFirestore(
        libraryId,
        snap.id,
        snap.data() || {},
      );
      if (
        stored.status !== 'running' ||
        stored.cancelRequested ||
        stored.leaseOwnerId === newWorkerId ||
        typeof stored.leaseExpiresAtMs !== 'number' ||
        stored.leaseExpiresAtMs > nowMs
      ) {
        return null;
      }

      const states = stored.perBookStates ?? {};
      const orderedSet = new Set<string>();
      const unfinishedSet = new Set<string>();

      for (const id of Object.keys(states)) {
        orderedSet.add(id);
        if (!isTerminalBookStage(states[id].stage)) {
          unfinishedSet.add(id);
        }
      }
      for (const id of stored.pendingBookIds ?? []) {
        orderedSet.add(id);
        const existingState = states[id];
        if (!existingState || !isTerminalBookStage(existingState.stage)) {
          unfinishedSet.add(id);
        }
      }

      const unfinishedBookIds = Array.from(unfinishedSet);
      const orderedBookIds = Array.from(orderedSet);
      const nextLeaseExpiresAtMs = nowMs + JOB_LEASE_TTL_MS;

      const nextStates: Record<string, BookJobTelemetryEntry> = {...states};
      for (const id of unfinishedBookIds) {
        const existing = nextStates[id];
        nextStates[id] = {
          bookId: id,
          stage: 'queued',
          winningProviders: existing?.winningProviders,
          updatedFields: existing?.updatedFields,
          updatedAt: nowMs,
        };
      }

      const boundedNextStates = trimPerBookStatesForFirestore(nextStates);
      const retainedTerminals = countTerminalBookStages(boundedNextStates);
      const completedBooksBaseline = Math.max(
        0,
        stored.completedBooks - retainedTerminals.completed,
      );
      const failedBooksBaseline = Math.max(
        0,
        stored.failedBooks - retainedTerminals.failed,
      );
      const skippedBooksBaseline = Math.max(
        0,
        stored.skippedBooks - retainedTerminals.skipped,
      );

      const claimedStatus =
        unfinishedBookIds.length > 0 ? 'running' : 'completed';
      const updatedDoc = enrichmentJobConverter.toFirestoreWrite(
        libraryId,
        jobId,
        {
          ...stored,
          status: claimedStatus,
          leaseOwnerId: claimedStatus === 'running' ? newWorkerId : undefined,
          leaseExpiresAtMs:
            claimedStatus === 'running' ? nextLeaseExpiresAtMs : undefined,
          pendingBookIds:
            claimedStatus === 'running' ? unfinishedBookIds : undefined,
          activeWave:
            claimedStatus === 'running' ? stored.activeWave : undefined,
          perBookStates: boundedNextStates,
          completedAt:
            claimedStatus === 'completed' ? nowMs : stored.completedAt,
          updatedAtMs: nowMs,
        },
      );
      tx.set(jobRef, updatedDoc);

      return {
        claimedDoc: updatedDoc,
        unfinishedBookIds,
        orderedBookIds,
        completedBooksBaseline,
        failedBooksBaseline,
        skippedBooksBaseline,
      };
    });
  } catch (err) {
    if (err instanceof SchemaValidationError) {
      throw err;
    }
    return null;
  }
}
