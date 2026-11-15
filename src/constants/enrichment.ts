/**
 * Canonical server-side configuration for metadata enrichment, adaptive sub-chunking,
 * and Firestore micro-batch commits.
 * Note: All client-side batching and rate-limiting constants have been eliminated;
 * the server EnrichmentJobCoordinator and GlobalProviderGovernor own all pacing.
 */
export const ENRICHMENT_CONSTANTS = {
  /** Maximum chunk size sent to Gemini structured JSON batch operations */
  GEMINI_CHUNK_SIZE: 10,

  /** Maximum chunk size sent to Gemini embedding batch operations */
  EMBEDDING_CHUNK_SIZE: 20,

  /** Server-side maximum books per single enrichment execution request */
  SERVER_MAX_BATCH_SIZE: 500,

  /** Server-side internal processing chunk size for Firestore reads and writes */
  SERVER_CHUNK_SIZE: 10,

  /** Number of books processed per streaming micro-batch for catalog-primary flows */
  MICRO_BATCH_COMMIT_SIZE: 10,

  /** Number of books processed per streaming micro-batch for Gemini structured AI flows (3 concurrent chunks of 10) */
  AI_MICRO_BATCH_COMMIT_SIZE: 30,

  /** Number of books processed per streaming micro-batch for Gemini Decision API flows */
  DECISION_MICRO_BATCH_COMMIT_SIZE: 30,

  /** Number of books processed per streaming micro-batch for Gemini generative fallback flows */
  GENERATIVE_MICRO_BATCH_COMMIT_SIZE: 20,

  /** Number of books processed per streaming micro-batch for vector embedding flows */
  EMBEDDING_MICRO_BATCH_COMMIT_SIZE: 40,

  /** Maximum books flushed per incremental Firestore micro-commit during streaming jobs */
  FIRESTORE_COMMIT_CHUNK_SIZE: 25,
} as const;

/**
 * Execution tiers for metadata enrichment waves, ordered from fastest/cheapest
 * (`decision`) to external HTTP (`catalog`) and open-ended LLM generation (`generative`).
 */
export type EnrichmentTier =
  'decision' | 'catalog' | 'generative' | 'embedding';

export type EnrichmentStageProgressLabel =
  'evaluating_decisions' | 'fetching_catalog' | 'fetching_ai';

export interface TierExecutionProfile {
  readonly microBatchSize: number;
  readonly progressStage: EnrichmentStageProgressLabel;
  readonly requiresAi: boolean;
}

/**
 * Canonical execution profiles per enrichment tier so coordinators and services
 * derive batch sizing and SSE stage labels generically without enrichmentType branching.
 */
export const TIER_EXECUTION_PROFILES: Readonly<
  Record<EnrichmentTier, TierExecutionProfile>
> = {
  decision: {
    microBatchSize: ENRICHMENT_CONSTANTS.DECISION_MICRO_BATCH_COMMIT_SIZE,
    progressStage: 'evaluating_decisions',
    requiresAi: true,
  },
  catalog: {
    microBatchSize: ENRICHMENT_CONSTANTS.MICRO_BATCH_COMMIT_SIZE,
    progressStage: 'fetching_catalog',
    requiresAi: false,
  },
  generative: {
    microBatchSize: ENRICHMENT_CONSTANTS.GENERATIVE_MICRO_BATCH_COMMIT_SIZE,
    progressStage: 'fetching_ai',
    requiresAi: true,
  },
  embedding: {
    microBatchSize: ENRICHMENT_CONSTANTS.EMBEDDING_MICRO_BATCH_COMMIT_SIZE,
    progressStage: 'fetching_ai',
    requiresAi: true,
  },
};

export const SERIES_STANDALONE_NOUL_THRESHOLD = 0.45;
export const GENRE_CONFIDENCE_THRESHOLD = 0.65;
export const GEO_CONFIDENCE_THRESHOLD = 0.55;
export const TEMPORAL_CONFIDENCE_THRESHOLD = 0.55;
