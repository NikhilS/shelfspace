import type {z} from 'zod';
import type {EnrichmentTier} from '../constants/enrichment';

export enum MetadataKey {
  GEO = 'geo',
  TEMPORAL = 'temporal',
  GENRE = 'genre',
  SYNOPSIS = 'synopsis',
  AUTHOR_BIO = 'authorBio',
  EMBEDDING = 'embedding',
  SERIES = 'series',
  BASIC_INFO = 'basicInfo',
  COVER_IMAGE = 'coverImage',
}

export type CanonicalEnrichmentType =
  | 'geo'
  | 'temporal'
  | 'genre'
  | 'synopsis'
  | 'authorBio'
  | 'coverImage'
  | 'series'
  | 'embedding';

export interface BookGenreData {
  primaryGenre: string;
  subgenres?: string[];
  isCustomPrimary?: boolean;
}

export interface CoreBookData {
  id: string;
  title: string;
  author: string;
  isbn?: string;
  primaryGenre?: string;
  subgenres?: string[];
  synopsis?: string;
  [key: string]: unknown;
}

export interface MetadataBulkFetchOptions {
  signal?: AbortSignal;
  allowAiFallback?: boolean;
  customGenres?: string[];
}

/**
 * Opportunistic bibliographic metadata harvested when a book escalates to
 * external catalog providers, persisted strictly non-destructively.
 */
export interface BonusCatalogFields {
  coverUrl?: string;
  isbn?: string;
  publishedDate?: string;
  series?: string;
  synopsis?: string;
  winningProvider?: string;
}

export interface StageEscalationState<Output = unknown> {
  enrichedBook?: Partial<CoreBookData>;
  fallbackValue?: Output;
  bonusCatalog?: BonusCatalogFields;
}

export type StageBookOutcome<Output = unknown> =
  | {
      status: 'resolved';
      value: Output;
      winningProvider?: string;
      bonusCatalog?: BonusCatalogFields;
    }
  | {
      status: 'pruned';
      reason?: string;
      bonusCatalog?: BonusCatalogFields;
    }
  | {
      status: 'escalate';
      enrichedBook?: Partial<CoreBookData>;
      fallbackValue?: Output;
      bonusCatalog?: BonusCatalogFields;
    };

export interface EnrichmentStageContext<Output = unknown> {
  books: CoreBookData[];
  options?: MetadataBulkFetchOptions;
  priorEscalations?: ReadonlyMap<string, StageEscalationState<Output>>;
}

export interface EnrichmentPipelineStage<Output = unknown> {
  readonly id: string;
  readonly tier: EnrichmentTier;
  execute(
    context: EnrichmentStageContext<Output>,
  ): Promise<Map<string, StageBookOutcome<Output>>>;
}

/**
 * Base metadata provider contract following Google TypeScript Style Guide
 * naming (no Hungarian `I` prefix; descriptive `Output` type parameter).
 */
export interface MetadataProvider<Output = unknown> {
  getKey(): MetadataKey;
  fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<Output>;
  bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, Output>>;
  shouldFetchOnCreate(): boolean;
  isAvailable(): boolean;
}

export interface MetadataPersistenceContext<Output = unknown> {
  book: CoreBookData;
  value: Output;
  existingStatus: Record<string, unknown>;
  existingDetailsMeta: Record<string, unknown>;
  nowIso: string;
}

export interface MetadataPersistencePatch {
  bookUpdate: Record<string, unknown>;
  detailsUpdate?: Record<string, unknown>;
  resultPreview: Record<string, unknown>;
}

/**
 * Full server metadata enrichment plugin contract combining declarative
 * multi-tier pipeline stages, runtime Zod output validation, and typed persistence patching.
 */
export interface MetadataPlugin<
  Output = unknown,
> extends MetadataProvider<Output> {
  readonly statusKey: CanonicalEnrichmentType;
  readonly needsSynopsis: boolean;
  readonly supportsHybridAiFallback: boolean;
  readonly outputSchema: z.ZodType<Output>;
  readonly stages?: ReadonlyArray<EnrichmentPipelineStage<Output>>;
  toPersistencePatch(
    context: MetadataPersistenceContext<Output>,
  ): MetadataPersistencePatch;
}
