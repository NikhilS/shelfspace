import {useState, useEffect, useMemo, useCallback} from 'react';
import {doc, updateDoc} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../stores/authStore';
import {Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {trpcVanilla} from '../lib/trpc';
import {bulkEnrichmentClientLimiter} from '../lib/clientLimiters';

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
    failed: 0,
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
    setBackfillProgress({
      completed: 0,
      failed: 0,
      total: booksToBackfill.length,
    });

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

      // Group books into chunks of batchSize
      const bookChunks: Book[][] = [];
      for (let i = 0; i < booksToProcess.length; i += batchSize) {
        bookChunks.push(booksToProcess.slice(i, i + batchSize));
      }

      // Helper to process a batch of books with dynamic error isolation
      const processBatch = async (chunk: Book[]) => {
        // Mark as attempted as soon as we start processing to avoid concurrency double-triggering
        setAttemptedBookIds(prev => {
          const next = new Set(prev);
          chunk.forEach(b => next.add(b.id));
          return next;
        });

        setInFlightCount(prev => prev + chunk.length);

        let batchCompleted = 0;
        let batchFailed = 0;

        try {
          const payloads = chunk.map(b => {
            const bookAny = b as unknown as Record<string, unknown>;
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

          const data = (await Promise.race([
            trpcVanilla.metadata.bulkFetch.mutate({
              libraryId: libraryId,
              providerKey,
              books: payloads,
            }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Batch processing timed out')),
                timeoutMs,
              ),
            ),
          ])) as {results: Record<string, unknown>[]};

          if (data && Array.isArray(data.results)) {
            // Write each successful result to Firestore immediately
            await Promise.all(
              data.results.map(async result => {
                if (result.id) {
                  const bookRef = doc(
                    db,
                    'libraries',
                    libraryId,
                    'books',
                    result.id as string,
                  );
                  await updateDoc(bookRef, {
                    [metadataField]: result[metadataField],
                  } as Record<string, unknown>);
                  batchCompleted++;
                }
              }),
            );
            // Any books we asked for that didn't get returned are counted as failed
            batchFailed = chunk.length - batchCompleted;
          } else {
            batchFailed = chunk.length;
          }
        } catch (batchErr) {
          batchFailed = chunk.length;
          const errMsg =
            batchErr instanceof Error ? batchErr.message : String(batchErr);
          DebugTelemetryEngine.getInstance().addLog(
            'error',
            `[BulkEnrichment Workers] Error processing batch of ${chunk.length} books for ${metadataField}: ${errMsg}`,
          );
        } finally {
          setInFlightCount(prev => Math.max(0, prev - chunk.length));
          setBackfillProgress(prev => ({
            ...prev,
            completed: prev.completed + batchCompleted,
            failed: prev.failed + batchFailed,
          }));
        }
      };

      // Schedule all batches using bottleneck
      const promises = bookChunks.map(chunk =>
        bulkEnrichmentClientLimiter.schedule(() => processBatch(chunk)),
      );
      await Promise.all(promises);

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
