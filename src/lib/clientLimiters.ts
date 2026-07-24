import Bottleneck from 'bottleneck';

// Client-side limiter for bulk enrichments (UI trickles requests gently to TRPC server)
export const bulkEnrichmentClientLimiter = new Bottleneck({
  maxConcurrent: 10,
  minTime: 50, // Gentle trickle
});
