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
});

globalProviderGovernor.registerScheduler(geminiLimiter);
globalProviderGovernor.registerScheduler(geminiEmbeddingLimiter);
