import Bottleneck from 'bottleneck';
import {ENRICHMENT_CONSTANTS} from '../constants/enrichment';

// Client-side limiter for bulk enrichments (paced to prevent swamping 15 RPM Gemini quotas)
export const bulkEnrichmentClientLimiter = new Bottleneck({
  maxConcurrent: ENRICHMENT_CONSTANTS.CLIENT_LIMITER.maxConcurrent,
  minTime: ENRICHMENT_CONSTANTS.CLIENT_LIMITER.minTimeMs,
});
