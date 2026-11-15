import {ProviderQuotaScheduler} from './scheduler/providerQuotaScheduler';
import {globalProviderGovernor} from './scheduler/globalProviderGovernor';

/**
 * First-class capacity-aware scheduler for Gemini Structured & Text Generation calls
 * (`gemini-3-flash-preview` / `gemini-3.1-pro-preview`).
 */
export const geminiLimiter = new ProviderQuotaScheduler({
  providerId: 'gemini-structured',
  maxConcurrent: 4,
  minSpacingMs: 250,
  maxRequestsPerMinute: 60,
  burstCapacity: 8,
  defaultCooldownMs: 10_000,
  maxRetries: 3,
  executionPool: 'GENERATIVE_AI',
});

/**
 * First-class capacity-aware scheduler for Gemini Vector Embedding calls
 * (`gemini-embedding-2-preview`).
 */
export const geminiEmbeddingLimiter = new ProviderQuotaScheduler({
  providerId: 'gemini-embedding',
  maxConcurrent: 5,
  minSpacingMs: 150,
  maxRequestsPerMinute: 120,
  burstCapacity: 15,
  defaultCooldownMs: 10_000,
  maxRetries: 3,
  executionPool: 'GENERATIVE_AI',
});

/**
 * First-class capacity-aware scheduler for Gemini Decisions API calls
 * (`gemini-decision-1` single-pass calibrated evaluations).
 * Runs in the dedicated `FAST_DECISION` pool so slow catalog HTTP scrapes
 * never delay Decision evaluations.
 */
export const geminiDecisionLimiter = new ProviderQuotaScheduler({
  providerId: 'gemini-decision',
  maxConcurrent: 8,
  minSpacingMs: 100,
  maxRequestsPerMinute: 150,
  burstCapacity: 16,
  defaultCooldownMs: 10_000,
  maxRetries: 3,
  executionPool: 'FAST_DECISION',
});

globalProviderGovernor.registerScheduler(geminiLimiter);
globalProviderGovernor.registerScheduler(geminiEmbeddingLimiter);
globalProviderGovernor.registerScheduler(geminiDecisionLimiter);
