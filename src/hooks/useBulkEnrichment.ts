import {useState, useEffect, useMemo, useCallback} from 'react';
import {writeBatch, doc} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../contexts/AuthContext';
import {Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine} from '../lib/telemetry';

export interface UseBulkEnrichmentConfig {
  books: Book[];
  isBooksLoading: boolean;
  libraryId: string | undefined;
  apiEndpoint: string;
  metadataField: 'geoMetadata' | 'temporalMetadata';
  batchSize?: number;
  concurrencyLimit?: number;
  filterPredicate: (book: Book) => boolean;
  successToastMessage?: string;
  errorToastMessage?: string;
  autoTrigger?: boolean;
  timeoutMs?: number;
}

export function useBulkEnrichment({
  books,
  isBooksLoading,
  libraryId,
  apiEndpoint,
  metadataField,
  batchSize = 10,
  concurrencyLimit = 3,
  filterPredicate,
  successToastMessage = 'Successfully enriched library books!',
  errorToastMessage = 'Some books could not be analyzed.',
  autoTrigger = true,
  timeoutMs = 180000,
}: UseBulkEnrichmentConfig) {
  const {user} = useAuth();

  const [isBackfilling, setIsBackfilling] = useState(false);
  const [inFlightCount, setInFlightCount] = useState(0);
  const [backfillProgress, setBackfillProgress] = useState({
    completed: 0,
    total: 0,
  });

  // Track book IDs that have been attempted to prevent infinite refresh retry loops on failure
  const [attemptedBookIds, setAttemptedBookIds] = useState<Set<string>>(
    () => new Set(),
  );

  // Compute books that need enrichment
  const booksToBackfill = useMemo(() => {
    return books.filter(b => filterPredicate(b) && !attemptedBookIds.has(b.id));
  }, [books, filterPredicate, attemptedBookIds]);

  const backfillQuotaCount = booksToBackfill.length;

  const triggerBatchBackfill = useCallback(async () => {
    if (!libraryId || booksToBackfill.length === 0 || isBackfilling || !user) {
      return;
    }

    setIsBackfilling(true);
    setBackfillProgress({completed: 0, total: booksToBackfill.length});

    DebugTelemetryEngine.getInstance().addLog(
      'worker',
      `[BulkEnrichment] Starting backfill scan for ${metadataField}`,
      {
        libraryId,
        totalToProcess: booksToBackfill.length,
        batchSize,
        concurrencyLimit,
        apiEndpoint,
      },
    );

    try {
      const idToken = await user.getIdToken();
      if (!idToken) throw new Error('Authorization required');

      const booksToProcess = [...booksToBackfill];
      const total = booksToProcess.length;

      // Define internal robust fetch with timeout and exponential backoff retry helper
      const fetchWithRetry = async (
        url: string,
        options: RequestInit,
        retries = 3,
        delay = 1000,
      ): Promise<Response> => {
        let lastError: Error | null = null;
        for (let i = 0; i < retries; i++) {
          try {
            const startTime = Date.now();
            DebugTelemetryEngine.getInstance().addLog(
              'info',
              `[BulkEnrichment Fetch] Attempt ${i + 1}/${retries}: ${options.method || 'GET'} ${url}`,
              {attempt: i + 1, url, method: options.method},
            );

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs); // 3 minutes timeout by default

            const response = await fetch(url, {
              ...options,
              signal: controller.signal,
            });

            clearTimeout(timeoutId);

            const durationMs = Date.now() - startTime;
            DebugTelemetryEngine.getInstance().addLog(
              'api_res',
              `[BulkEnrichment Response] HTTP ${response.status} from ${url} in ${durationMs}ms`,
              {status: response.status, durationMs, url},
            );

            if (response.ok) {
              return response;
            }

            // Retry on rate limit 429 or server errors 5xx
            if (response.status === 429 || response.status >= 500) {
              lastError = new Error(
                `Request failed with status ${response.status}`,
              );
            } else {
              // 4xx errors are client errors (like 404, 401), do not retry
              return response;
            }
          } catch (err) {
            if (controller.signal.aborted) {
              lastError = new Error(
                `Request timed out after ${timeoutMs / 1000} seconds`,
              );
            } else {
              lastError = err instanceof Error ? err : new Error(String(err));
            }
            DebugTelemetryEngine.getInstance().addLog(
              'warn',
              `[BulkEnrichment Fetch] Attempt ${i + 1}/${retries} got error: ${lastError.message}`,
              {error: lastError.message},
            );
          }

          if (i < retries - 1) {
            const waitTime = delay * Math.pow(2, i);
            DebugTelemetryEngine.getInstance().addLog(
              'info',
              `[BulkEnrichment] Rate-limited or timed out. Waiting ${waitTime}ms before retry...`,
              {waitTime},
            );
            await new Promise(resolve => setTimeout(resolve, waitTime));
          }
        }
        throw lastError || new Error('HTTP Request failed after retries');
      };

      // Split the books into batch arrays
      const batches: Book[][] = [];
      for (let i = 0; i < total; i += batchSize) {
        batches.push(booksToProcess.slice(i, i + batchSize));
      }

      // Helper to process a single batch with dynamic error isolation
      const processBatch = async (batch: Book[]) => {
        // Mark as attempted as soon as we start processing to avoid concurrency double-triggering
        const batchIds = batch.map(b => b.id);
        setAttemptedBookIds(prev => {
          const next = new Set(prev);
          batchIds.forEach(id => next.add(id));
          return next;
        });

        setInFlightCount(prev => prev + batch.length);

        DebugTelemetryEngine.getInstance().addLog(
          'worker',
          `[BulkEnrichment Workers] Processing batch of size ${batch.length}...`,
          {batchSize: batch.length, firstBook: batch[0]?.title},
        );

        try {
          const payload = batch.map(b => ({
            id: b.id,
            title: b.title,
            author: b.author || 'Unknown',
            synopsis: b.synopsis || b.description || '',
          }));

          const response = await fetchWithRetry(apiEndpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({books: payload}),
          });

          if (!response.ok) {
            throw new Error(
              `Enrichment failed with status: Code ${response.status}`,
            );
          }

          const contentType = response.headers.get('content-type');
          if (!contentType || !contentType.includes('application/json')) {
            const text = await response.text();
            throw new Error(
              `Expected JSON but received: ${text.substring(0, 100)}`,
            );
          }

          const data = await response.json();
          if (data && Array.isArray(data.results)) {
            DebugTelemetryEngine.getInstance().addLog(
              'worker',
              `[BulkEnrichment Workers] Writing results of size ${data.results.length} to Firestore...`,
              {resultsCount: data.results.length},
            );

            const firestoreBatch = writeBatch(db);
            for (const result of data.results) {
              const bookRef = doc(
                db,
                'libraries',
                libraryId,
                'books',
                result.id,
              );
              firestoreBatch.update(bookRef, {
                [metadataField]: result[metadataField],
              });
            }
            await firestoreBatch.commit();

            DebugTelemetryEngine.getInstance().addLog(
              'info',
              `[BulkEnrichment Workers] Batch of ${batch.length} books successfully processed and locked to Firestore.`,
            );
          } else {
            DebugTelemetryEngine.getInstance().addLog(
              'warn',
              '[BulkEnrichment Workers] Batch returned no valid enrichment results array.',
              {data},
            );
          }
        } catch (batchErr) {
          const errMsg =
            batchErr instanceof Error ? batchErr.message : String(batchErr);
          DebugTelemetryEngine.getInstance().addLog(
            'error',
            `[BulkEnrichment Workers] Error processing batch of books for ${metadataField}: ${errMsg}`,
            {error: errMsg, batchSize: batch.length},
          );
          console.error(
            `[BulkEnrichment] Error processing batch of books for ${metadataField}:`,
            batchErr,
          );
        } finally {
          setInFlightCount(prev => Math.max(0, prev - batch.length));
          setBackfillProgress(prev => ({
            ...prev,
            completed: Math.min(prev.total, prev.completed + batch.length),
          }));
        }
      };

      // Continuous queue worker pool
      const queue = [...batches];
      DebugTelemetryEngine.getInstance().addLog(
        'worker',
        `[BulkEnrichment Queue] Initialized with ${queue.length} batches of size ${batchSize}`,
        {batchesCount: queue.length},
      );

      const workers = Array.from(
        {length: Math.min(concurrencyLimit, queue.length)},
        async (_, idx) => {
          DebugTelemetryEngine.getInstance().addLog(
            'worker',
            `[BulkEnrichment Workers] Worker slot ${idx + 1} activated.`,
            {
              workerIdx: idx + 1,
              activeCount: Math.min(concurrencyLimit, queue.length),
            },
          );

          while (queue.length > 0) {
            const nextBatch = queue.shift();
            if (nextBatch) {
              await processBatch(nextBatch);
            }
          }
        },
      );

      await Promise.all(workers);

      DebugTelemetryEngine.getInstance().addLog(
        'info',
        `[BulkEnrichment] Backfill run finished successfully for ${metadataField}`,
        {metadataField, processedCount: total},
      );
      toast.success(successToastMessage);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        `[BulkEnrichment] Overall run failed for ${metadataField}: ${errMsg}`,
        {metadataField, error: errMsg},
      );
      console.error(
        `[BulkEnrichment] Overall run failed for ${metadataField}:`,
        err,
      );
      toast.error(errorToastMessage);
    } finally {
      setIsBackfilling(false);
      setInFlightCount(0);
    }
  }, [
    libraryId,
    booksToBackfill,
    isBackfilling,
    user,
    batchSize,
    apiEndpoint,
    metadataField,
    concurrencyLimit,
    successToastMessage,
    errorToastMessage,
    timeoutMs,
  ]);

  // Handle auto-triggering
  useEffect(() => {
    if (
      autoTrigger &&
      !isBooksLoading &&
      backfillQuotaCount > 0 &&
      !isBackfilling &&
      user
    ) {
      void triggerBatchBackfill();
    }
  }, [
    autoTrigger,
    isBooksLoading,
    backfillQuotaCount,
    isBackfilling,
    user,
    triggerBatchBackfill,
  ]);

  const resetBackfillTracker = useCallback(() => {
    setAttemptedBookIds(new Set());
  }, []);

  return {
    isBackfilling,
    progress: backfillProgress,
    inFlightCount,
    triggerBackfill: triggerBatchBackfill,
    resetBackfillTracker,
    booksToBackfill,
  };
}
