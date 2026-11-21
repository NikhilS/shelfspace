import type {EnrichmentTier} from '../../../constants/enrichment';
import type {CanonicalEnrichmentType} from '../../../schemas/libraryApi';
import type {PerBookJobStage} from '../enrichmentService';
import type {ProviderTelemetrySummary} from '../scheduler/globalProviderGovernor';

export const JOB_LEASE_TTL_MS = 45_000;
export const JOB_HEARTBEAT_INTERVAL_MS = 15_000;

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
  cancelRequested?: boolean;
  leaseOwnerId?: string;
  leaseExpiresAtMs?: number;
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

export interface InternalJobState {
  jobId: string;
  uid: string;
  userEmail?: string;
  libraryId: string;
  enrichmentType: CanonicalEnrichmentType;
  status: EnrichmentJobStatus;
  bookIds: string[];
  totalBooksBaseline: number;
  completedBooksBaseline: number;
  failedBooksBaseline: number;
  skippedBooksBaseline: number;
  pendingQueue: string[];
  overwrite: boolean;
  cancelRequested: boolean;
  fenced: boolean;
  leaseOwnerId: string;
  leaseExpiresAtMs: number;
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
