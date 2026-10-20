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

  /** Number of books processed per streaming micro-batch for vector embedding flows */
  EMBEDDING_MICRO_BATCH_COMMIT_SIZE: 40,

  /** Maximum books flushed per incremental Firestore micro-commit during streaming jobs */
  FIRESTORE_COMMIT_CHUNK_SIZE: 25,
} as const;
