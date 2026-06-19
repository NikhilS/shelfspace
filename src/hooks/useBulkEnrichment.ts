import {useState, useEffect, useMemo, useCallback} from 'react';
import {writeBatch, doc} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../stores/authStore';
import {Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {trpcVanilla} from '../lib/trpc';

export interface UseBulkEnrichmentConfig {
  books: Book[];
  isBooksLoading: boolean;
  libraryId: string | undefined;
  providerKey: string;
  metadataField: string;
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
  providerKey,
  metadataField,
  batchSize = 10,
  concurrencyLimit = 5,
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
        providerKey,
      },
    );

    try {
      const booksToProcess = [...booksToBackfill];
      const total = booksToProcess.length;

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
          const payload = batch.map(b => {
            const bookAny = b as Record<string, unknown>;
            return {
              id: b.id,
              title: b.title,
              author: b.author || 'Unknown',
              synopsis:
                (bookAny.synopsis as string) ||
                (bookAny.description as string) ||
                '',
            };
          });

          const data = await trpcVanilla.metadata.bulkFetch.mutate({
            libraryId: libraryId,
            providerKey,
            books: payload,
          });

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
    providerKey,
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
