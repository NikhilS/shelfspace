import type {EnrichmentTier} from '../constants/enrichment';
import type {CanonicalEnrichmentType} from '../schemas/libraryApi';
import type {trpc} from '../lib/trpc';
import {useEntityCacheStore} from '../stores/entityCacheStore';
import type {Book} from '../types';

export type PerBookJobStage =
  | 'queued'
  | 'evaluating_decisions'
  | 'fetching_catalog'
  | 'fetching_ai'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface BookJobTelemetry {
  bookId: string;
  stage: PerBookJobStage;
  winningProviders?: Record<string, string>;
  updatedFields?: string[];
  error?: string;
  updatedAt: number;
}

export interface ProviderTelemetrySummary {
  activeProviders: string[];
  delayedProviders: string[];
  cooldownProviders: Array<{providerId: string; cooldownRemainingMs: number}>;
  exhaustedProviders: string[];
  totalInFlight: number;
  maxGlobalConcurrent: number;
}

export interface ActiveEnrichmentWave {
  waveNumber: number;
  totalWaves: number;
  tier: EnrichmentTier;
  remainingInWave: number;
}

export interface BulkEnrichmentProgress {
  completed: number;
  failed: number;
  total: number;
}

export interface SseJobSnapshotPayload {
  jobId?: string;
  enrichmentType?: CanonicalEnrichmentType;
  status?: 'running' | 'cancelling' | 'completed' | 'cancelled' | 'failed';
  totalBooks?: number;
  completedBooks?: number;
  failedBooks?: number;
  skippedBooks?: number;
  overwrite?: boolean;
  activeWave?: ActiveEnrichmentWave;
  perBookStates?: Record<string, BookJobTelemetry>;
  providerTelemetry?: ProviderTelemetrySummary;
}

export interface SseBookProgressPayload {
  jobId?: string;
  book?: BookJobTelemetry;
  totalBooks?: number;
  completedBooks?: number;
  failedBooks?: number;
  skippedBooks?: number;
}

export interface SseProviderTelemetryPayload {
  telemetry?: ProviderTelemetrySummary;
}

export interface SseBatchCommittedPayload {
  jobId?: string;
  results?: Array<Record<string, unknown> & {id: string}>;
  completedBooks?: number;
  totalBooks?: number;
  activeWave?: ActiveEnrichmentWave;
}

export interface ParsedSseFrame {
  event: string;
  data: string;
}

export function parseSseJson<Payload>(raw: unknown): Payload | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const parsed: unknown = JSON.parse(raw);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Payload;
  }
  return null;
}

/**
 * Parses Server-Sent Event frames from an incremental text buffer, returning
 * complete frames and any trailing incomplete remainder.
 */
export function consumeSseFrames(buffer: string): {
  frames: ParsedSseFrame[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const blocks = normalized.split('\n\n');
  const remainder = blocks.pop() ?? '';
  const frames: ParsedSseFrame[] = [];

  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) {
      continue;
    }
    let eventName = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || 'message';
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
    if (dataLines.length > 0) {
      frames.push({
        event: eventName,
        data: dataLines.join('\n'),
      });
    }
  }

  return {frames, remainder};
}

export function applyBookPatchesToCaches(
  targetLibId: string,
  patches: ReadonlyArray<Record<string, unknown> & {id: string}>,
  utils: ReturnType<typeof trpc.useUtils> | null,
): boolean {
  if (patches.length === 0) {
    return false;
  }

  const entityStore = useEntityCacheStore.getState();
  const mergedForStore: Book[] = [];
  for (const patch of patches) {
    const existing = entityStore.booksByKey[`${targetLibId}:${patch.id}`];
    if (existing) {
      mergedForStore.push({
        ...existing,
        ...(patch as Partial<Book>),
        libraryId: targetLibId,
      });
    }
  }
  if (mergedForStore.length > 0) {
    entityStore.upsertBooksDelta(targetLibId, mergedForStore);
  }

  if (utils?.book?.list?.setData) {
    const patchesById = new Map(patches.map(r => [r.id, r]));
    utils.book.list.setData({libraryId: targetLibId}, old => {
      if (!old || !Array.isArray(old.books)) {
        return old;
      }
      return {
        ...old,
        books: old.books.map(b => {
          const patch = patchesById.get(b.id);
          return patch ? {...b, ...(patch as Partial<typeof b>)} : b;
        }),
      };
    });
    return true;
  }

  return mergedForStore.length > 0;
}
