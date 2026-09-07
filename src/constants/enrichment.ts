/**
 * Canonical configuration for enrichment, batching, rate limiting, and timeouts.
 */
export const ENRICHMENT_CONSTANTS = {
  /** Maximum number of books sent in a single client-to-server batch */
  CLIENT_BATCH_SIZE: 20,

  /** Client rate limiter settings to stay comfortably under server limits (15 RPM) */
  CLIENT_LIMITER: {
    maxConcurrent: 2,
    minTimeMs: 1500,
  },

  /** Client timeout per batch in milliseconds */
  CLIENT_TIMEOUT_MS: 120_000,

  /** Maximum chunk size sent to Gemini batch operations */
  GEMINI_CHUNK_SIZE: 10,

  /** Server-side maximum books per single enrichment execution request */
  SERVER_MAX_BATCH_SIZE: 100,

  /** Server-side internal processing chunk size for Firestore reads and writes */
  SERVER_CHUNK_SIZE: 10,
} as const;
