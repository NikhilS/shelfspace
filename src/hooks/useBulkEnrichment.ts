import {useState, useEffect, useMemo, useCallback, useRef} from 'react';
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

  // Cancellation tracking
  const isCancelledRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelEnrichment = useCallback(() => {
    isCancelledRef.current = true;
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsBackfilling(false);
    setInFlightCount(0);
    DebugTelemetryEngine.getInstance().addLog(
      'warn',
      `[BulkEnrichment] Enrichment process stopped by user for ${metadataField}`,
      {
        metadataField,
        completed: backfillProgress.completed,
        failed: backfillProgress.failed,
        total: backfillProgress.total,
      },
    );
    toast.info('Enrichment process stopped');
  }, [metadataField, backfillProgress]);

  const canonicalEnrichmentType = useMemo(() => {
    return providerKey === 'geoMetadata' || providerKey === 'geo'
      ? 'geo'
      : providerKey === 'temporalMetadata' || providerKey === 'temporal'
        ? 'temporal'
        : providerKey === 'genre' || providerKey === 'primaryGenre'
          ? 'genre'
          : providerKey === 'coverUrl' || providerKey === 'coverImage'
            ? 'coverImage'
            : providerKey === 'embeddings' || providerKey === 'embedding'
              ? 'embedding'
              : providerKey;
  }, [providerKey]);

  const statusKey = canonicalEnrichmentType;

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

    isCancelledRef.current = false;
    abortControllerRef.current = new AbortController();

    setIsBackfilling(true);
    setBackfillProgress({
      completed: 0,
      failed: 0,
      total: booksToBackfill.length,
    });

    DebugTelemetryEngine.getInstance().addLog(
      'worker',
      `[BulkEnrichment] Starting server-authoritative backfill scan for ${metadataField} (${booksToBackfill.length} books queued)`,
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
      const processBatch = async (chunk: Book[], chunkIndex: number) => {
        if (isCancelledRef.current) {
          return;
        }

        // Mark as attempted in-memory immediately to avoid double execution
        setAttemptedBookIds(prev => {
          const next = new Set(prev);
          chunk.forEach(b => next.add(b.id));
          return next;
        });

        setInFlightCount(prev => prev + chunk.length);

        let batchCompleted = 0;
        let batchFailed = 0;
        const startTime = performance.now();

        DebugTelemetryEngine.getInstance().addLog(
          'worker',
          `[BulkEnrichment] Batch ${chunkIndex + 1}/${bookChunks.length}: Dispatching ${chunk.length} books for ${metadataField} (${chunk.map(b => b.title).join(', ')})`,
          {
            chunkIndex,
            books: chunk.map(b => ({
              id: b.id,
              title: b.title,
              author: b.author,
            })),
          },
        );

        try {
          const bookIds = chunk.map(b => b.id);

          const abortPromise = new Promise<never>((_, reject) => {
            if (abortControllerRef.current?.signal.aborted) {
              reject(new Error('Enrichment stopped by user'));
              return;
            }
            abortControllerRef.current?.signal.addEventListener(
              'abort',
              () => reject(new Error('Enrichment stopped by user')),
              {once: true},
            );
          });

          const data = (await Promise.race([
            trpcVanilla.enrichment.trigger.mutate({
              libraryId,
              bookIds,
              books: chunk.map(b => ({
                id: b.id,
                title: b.title,
                author: b.author || 'Unknown Author',
                isbn: b.isbn,
              })),
              enrichmentType:
                canonicalEnrichmentType as (typeof ENRICHMENT_TYPE_LIST)[number],
              overwrite,
            }),
            new Promise<never>((_, reject) =>
              setTimeout(
                () => reject(new Error('Batch processing timed out')),
                timeoutMs,
              ),
            ),
            abortPromise,
          ])) as {
            status: string;
            processedCount?: number;
            results?: Record<string, unknown>[];
            updates?: Array<{
              bookId: string;
              payload: Record<string, unknown>;
              heavyPayload?: Record<string, unknown>;
            }>;
          };

          const durationMs = Math.round(performance.now() - startTime);

          if (isCancelledRef.current) {
            DebugTelemetryEngine.getInstance().addLog(
              'warn',
              `[BulkEnrichment] Batch ${chunkIndex + 1} discarded due to cancellation`,
            );
            return;
          }

          DebugTelemetryEngine.getInstance().addLog(
            'api_res',
            `[BulkEnrichment API] Batch ${chunkIndex + 1} completed in ${durationMs}ms (status: ${data?.status || 'unknown'})`,
            {
              durationMs,
              status: data?.status,
              processedCount: data?.processedCount,
              chunkLength: chunk.length,
            },
          );

          if (data && data.status === 'success') {
            // Record AI invocation so Gemini Telemetry profiler accurately reflects activity
            DebugTelemetryEngine.getInstance().addLog(
              'gen_ai',
              `[BulkEnrichment AI] Gemini extracted ${metadataField} for batch ${chunkIndex + 1} (${chunk.length} volumes)`,
              {
                tokens: chunk.length * 160,
                metadataField,
                processedCount: data.processedCount,
              },
            );

            if (Array.isArray(data.updates) && data.updates.length > 0) {
              try {
                const {ClientBulkWriter} =
                  await import('../lib/clientBulkWriter');
                const writer = new ClientBulkWriter(db, 50);
                for (const updateItem of data.updates) {
                  const {bookId, payload, heavyPayload} = updateItem;
                  if (!bookId || !payload) continue;

                  // Partition heavy fields away from core book payload
                  const heavyData: Record<string, unknown> = {
                    ...(heavyPayload || {}),
                  };
                  if (payload.synopsis) heavyData.synopsis = payload.synopsis;
                  if (payload.authorBio)
                    heavyData.authorBio = payload.authorBio;
                  if (payload.embedding)
                    heavyData.embedding = payload.embedding;
                  if (payload.clusterCoordinates)
                    heavyData.clusterCoordinates = payload.clusterCoordinates;

                  const cleanBookPayload = {...payload};
                  delete cleanBookPayload.synopsis;
                  delete cleanBookPayload.authorBio;
                  delete cleanBookPayload.embedding;
                  delete cleanBookPayload.clusterCoordinates;

                  // Ensure bookDetailsMetadata is maintained on core book doc
                  if (Object.keys(heavyData).length > 0) {
                    const existingMeta =
                      (cleanBookPayload.bookDetailsMetadata as
                        Record<string, boolean> | undefined) || {};
                    cleanBookPayload.bookDetailsMetadata = {
                      ...existingMeta,
                      ...(heavyData.synopsis ? {hasSynopsis: true} : {}),
                      ...(heavyData.authorBio ? {hasAuthorBio: true} : {}),
                      ...(heavyData.embedding ? {hasEmbedding: true} : {}),
                    };
                  }

                  const bookDocRef = doc(
                    db,
                    'libraries',
                    libraryId,
                    'books',
                    bookId,
                  );
                  writer.set(bookDocRef, cleanBookPayload, {merge: true});

                  if (Object.keys(heavyData).length > 0) {
                    const detailRef = doc(
                      db,
                      'libraries',
                      libraryId,
                      'bookDetails',
                      bookId,
                    );
                    const detailPayload: Record<string, unknown> = {
                      ...heavyData,
                      updatedAt:
                        (cleanBookPayload.updatedAt as string) ||
                        new Date().toISOString(),
                    };
                    writer.set(detailRef, detailPayload, {merge: true});
                  }
                }
                await writer.close();

                DebugTelemetryEngine.getInstance().addLog(
                  'db_write',
                  `[BulkEnrichment DB] Committed ${data.updates.length} book updates to Firestore`,
                  {count: data.updates.length, libraryId},
                );
              } catch (clientWriteErr) {
                DebugTelemetryEngine.getInstance().addLog(
                  'error',
                  `[BulkEnrichment DB] Client write error writing book updates to Firestore: ${clientWriteErr}`,
                  clientWriteErr,
                );
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

            // Log per-book diagnostics for crystal-clear debugging visibility
            const updatesMap = new Map(
              (data.updates || []).map(u => [u.bookId, u]),
            );
            chunk.forEach(b => {
              const update = updatesMap.get(b.id);
              const statusObj = update?.payload?.enrichmentStatus as
                | Record<string, string>
                | undefined;
              const enrichmentStatus = statusObj?.[statusKey];

              if (enrichmentStatus === 'completed') {
                DebugTelemetryEngine.getInstance().addLog(
                  'info',
                  `[BulkEnrichment] ✓ Enriched "${b.title}" with ${metadataField}`,
                  {
                    bookId: b.id,
                    title: b.title,
                    metadataField,
                    status: 'completed',
                  },
                );
              } else {
                DebugTelemetryEngine.getInstance().addLog(
                  'warn',
                  `[BulkEnrichment] ⚠ No ${metadataField} found for "${b.title}" (marked unsupported)`,
                  {
                    bookId: b.id,
                    title: b.title,
                    metadataField,
                    status: enrichmentStatus || 'unsupported',
                  },
                );
              }
            });
          } else {
            batchFailed = chunk.length;
            DebugTelemetryEngine.getInstance().addLog(
              'error',
              `[BulkEnrichment] Batch ${chunkIndex + 1} returned unsuccessful status for ${chunk.length} books: ${JSON.stringify(data)}`,
              data,
            );
          }
        } catch (batchErr) {
          batchFailed = chunk.length;
          const errMsg =
            batchErr instanceof Error ? batchErr.message : String(batchErr);

          if (isCancelledRef.current || errMsg.includes('stopped by user')) {
            DebugTelemetryEngine.getInstance().addLog(
              'warn',
              `[BulkEnrichment] Batch ${chunkIndex + 1} halted by user`,
            );
          } else {
            DebugTelemetryEngine.getInstance().addLog(
              'error',
              `[BulkEnrichment Workers] Error processing batch of ${chunk.length} books for ${metadataField}: ${errMsg}`,
              {error: errMsg, books: chunk.map(b => ({id: b.id, title: b.title}))},
            );
          }
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
      const promises = bookChunks.map((chunk, idx) =>
        bulkEnrichmentClientLimiter.schedule(() => processBatch(chunk, idx)),
      );
      await Promise.all(promises);

      if (!isCancelledRef.current) {
        DebugTelemetryEngine.getInstance().addLog(
          'info',
          `[BulkEnrichment] Backfill run finished for ${metadataField} (Total processed: ${total})`,
          {metadataField, processedCount: total},
        );
        toast.success(successToastMessage);
      }
    } catch (err) {
      if (!isCancelledRef.current) {
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
      }
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
    canonicalEnrichmentType,
    statusKey,
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

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (isBackfilling) {
        isCancelledRef.current = true;
        abortControllerRef.current?.abort();
      }
    };
  }, [isBackfilling]);

  const resetBackfillTracker = useCallback(() => {
    setAttemptedBookIds(new Set());
  }, []);

  return {
    isBackfilling,
    progress: backfillProgress,
    inFlightCount,
    triggerBackfill: triggerBatchBackfill,
    cancelEnrichment,
    resetBackfillTracker,
    booksToBackfill,
  };
}
