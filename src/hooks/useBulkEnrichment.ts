import {useState, useEffect, useMemo, useCallback} from 'react';
import {doc} from 'firebase/firestore';
import {db} from '../firebase';
import {useAuth} from '../stores/authStore';
import {Book, BookEnrichmentStatus} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {trpcVanilla} from '../lib/trpc';
import {bulkEnrichmentClientLimiter} from '../lib/clientLimiters';
import {ENRICHMENT_CONSTANTS} from '../constants/enrichment';
import {ENRICHMENT_TYPE_LIST} from '../schemas/libraryApi';

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
  overwrite?: boolean;
}

export function useBulkEnrichment({
  books,
  isBooksLoading,
  libraryId,
  providerKey,
  metadataField,
  batchSize = ENRICHMENT_CONSTANTS.CLIENT_BATCH_SIZE,
  concurrencyLimit = ENRICHMENT_CONSTANTS.CLIENT_LIMITER.maxConcurrent,
  filterPredicate,
  successToastMessage = 'Successfully enriched library books!',
  errorToastMessage = 'Some books could not be analyzed.',
  autoTrigger = true,
  timeoutMs = ENRICHMENT_CONSTANTS.CLIENT_TIMEOUT_MS,
  overwrite = false,
}: UseBulkEnrichmentConfig) {
  const {user} = useAuth();

  const [isBackfilling, setIsBackfilling] = useState(false);
  const [inFlightCount, setInFlightCount] = useState(0);
  const [backfillProgress, setBackfillProgress] = useState({
    completed: 0,
    failed: 0,
    total: 0,
  });

  // Track book IDs that have been attempted in this session to prevent infinite retry loops
  const [attemptedBookIds, setAttemptedBookIds] = useState<Set<string>>(
    () => new Set(),
  );

  const statusKey = useMemo(() => {
    return providerKey === 'geoMetadata' || providerKey === 'geo'
      ? 'geo'
      : providerKey === 'temporalMetadata' || providerKey === 'temporal'
        ? 'temporal'
        : providerKey === 'genres' || providerKey === 'genre'
          ? 'genre'
          : providerKey === 'coverUrl' || providerKey === 'coverImage'
            ? 'coverImage'
            : providerKey === 'embeddings' || providerKey === 'embedding'
              ? 'embedding'
              : providerKey;
  }, [providerKey]);

  // Compute books that need enrichment, factoring in persistent tombstoning
  const booksToBackfill = useMemo(() => {
    return books.filter(b => {
      if (!filterPredicate(b)) return false;
      if (attemptedBookIds.has(b.id)) return false;
      if (!overwrite) {
        const status =
          b.enrichmentStatus?.[statusKey as keyof BookEnrichmentStatus];
        if (status === 'unsupported' || status === 'failed') {
          return false;
        }
      }
      return true;
    });
  }, [books, filterPredicate, attemptedBookIds, overwrite, statusKey]);

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
      `[BulkEnrichment] Starting server-authoritative backfill scan for ${metadataField}`,
      {
        libraryId,
        totalToProcess: booksToBackfill.length,
        batchSize,
        concurrencyLimit,
        providerKey,
        overwrite,
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

      // Helper to process a batch using the unified server-authoritative pipeline
      const processBatch = async (chunk: Book[]) => {
        // Mark as attempted in-memory immediately to avoid double execution
        setAttemptedBookIds(prev => {
          const next = new Set(prev);
          chunk.forEach(b => next.add(b.id));
          return next;
        });

        setInFlightCount(prev => prev + chunk.length);

        let batchCompleted = 0;
        let batchFailed = 0;

        try {
          const bookIds = chunk.map(b => b.id);

          const data = (await Promise.race([
            trpcVanilla.enrichment.trigger.mutate({
              libraryId,
              bookIds,
              books: chunk.map(b => ({
                id: b.id,
                title: b.title,
                author: b.author || 'Unknown Author',
                isbn: b.isbn,
                synopsis: b.synopsis || b.description,
              })),
              enrichmentType:
                providerKey as (typeof ENRICHMENT_TYPE_LIST)[number],
              overwrite,
            }),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error('Batch processing timed out')),
                timeoutMs,
              ),
            ),
          ])) as {
            status: string;
            processedCount?: number;
            results?: Record<string, unknown>[];
            updates?: Array<{bookId: string; payload: Record<string, unknown>}>;
          };

          if (data && data.status === 'success') {
            if (Array.isArray(data.updates) && data.updates.length > 0) {
              try {
                const {ClientBulkWriter} =
                  await import('../lib/clientBulkWriter');
                const writer = new ClientBulkWriter(db, 50);
                for (const {bookId, payload} of data.updates) {
                  if (!bookId || !payload) continue;
                  const bookDocRef = doc(
                    db,
                    'libraries',
                    libraryId,
                    'books',
                    bookId,
                  );
                  writer.set(bookDocRef, payload, {merge: true});

                  if (
                    payload.synopsis ||
                    payload.authorBio ||
                    payload.embedding
                  ) {
                    const detailRef = doc(
                      db,
                      'libraries',
                      libraryId,
                      'bookDetails',
                      bookId,
                    );
                    const detailPayload: Record<string, unknown> = {
                      updatedAt: new Date().toISOString(),
                    };
                    if (payload.synopsis)
                      detailPayload.synopsis = payload.synopsis;
                    if (payload.authorBio)
                      detailPayload.authorBio = payload.authorBio;
                    if (payload.embedding)
                      detailPayload.embedding = payload.embedding;
                    writer.set(detailRef, detailPayload, {merge: true});
                  }
                }
                await writer.close();
              } catch (clientWriteErr) {
                console.warn(
                  '[BulkEnrichment] Client write warning:',
                  clientWriteErr,
                );
              }
            }

            const count =
              typeof data.processedCount === 'number'
                ? data.processedCount
                : Array.isArray(data.results)
                  ? data.results.length
                  : 0;
            batchCompleted = count;
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
    overwrite,
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
