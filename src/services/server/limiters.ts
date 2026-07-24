import Bottleneck from 'bottleneck';

// Google Books API is highly rate limited by IP
export const googleBooksLimiter = new Bottleneck({
  maxConcurrent: 3,
  minTime: 200, // 5 requests per second max
  reservoir: 100, // 100 requests per minute max...
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60 * 1000,
});

googleBooksLimiter.on('failed', async (error, jobInfo) => {
  const id = jobInfo.options.id;
  console.warn(`[googleBooksLimiter] Job ${id} failed: ${error}`);
  if (jobInfo.retryCount < 3) {
    // Exponential backoff
    return 1000 * Math.pow(2, jobInfo.retryCount);
  }
  return undefined;
});

// Gemini API is also rate limited per tier
export const geminiLimiter = new Bottleneck({
  maxConcurrent: 5,
  minTime: 1000, // 1 request per second max depending on flash/pro
  reservoir: 15, // 15 RPMin constraint to be safe against base tier quotas
  reservoirRefreshAmount: 15,
  reservoirRefreshInterval: 60 * 1000,
});

geminiLimiter.on('failed', async (error, jobInfo) => {
  const id = jobInfo.options.id;
  console.warn(`[geminiLimiter] Job ${id} failed: ${error}`);
  if (jobInfo.retryCount < 3) {
    return 2000 * Math.pow(2, jobInfo.retryCount);
  }
  return undefined;
});
