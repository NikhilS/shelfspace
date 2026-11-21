import {useState, useRef, useEffect, useCallback, useMemo} from 'react';
import {toast} from 'sonner';
import {Book} from '../types';
import {trpc, trpcVanilla} from '../lib/trpc';
import {useAuth} from '../stores/authStore';
import {useEntityCacheStore} from '../stores/entityCacheStore';
import {auth} from '../firebase';
import {findEnrichmentDescriptor} from '../constants/enrichmentDescriptors';
import {CanonicalEnrichmentType} from '../schemas/libraryApi';
import {createLogger, DebugTelemetryEngine} from '../lib/telemetry';
import {
  type ActiveEnrichmentWave,
  applyBookPatchesToCaches,
  type BookJobTelemetry,
  type BulkEnrichmentProgress,
  consumeSseFrames,
  type ParsedSseFrame,
  parseSseJson,
  type PerBookJobStage,
  type ProviderTelemetrySummary,
  type SseBatchCommittedPayload,
  type SseBookProgressPayload,
  type SseJobSnapshotPayload,
  type SseProviderTelemetryPayload,
} from './bulkEnrichmentHelpers';

export {
  type ActiveEnrichmentWave,
  type BookJobTelemetry,
  type BulkEnrichmentProgress,
  consumeSseFrames,
  type PerBookJobStage,
  type ProviderTelemetrySummary,
};

const enrichmentLogger = createLogger('Enrichment');

export interface UseBulkEnrichmentOptions {
  books: Book[];
  isBooksLoading: boolean;
  libraryId?: string | null;
  providerKey: string;
  metadataField: string;
  filterPredicate: (book: Book) => boolean;
  overwrite?: boolean;
  ignoreUnsupportedStatus?: boolean;
  autoTrigger?: boolean;
  autoReattach?: boolean;
  reattachAnyType?: boolean;
  canEdit?: boolean;
  customGenres?: string[];
  successToastMessage?: string;
  errorToastMessage?: string;
  onComplete?: () => void;
}

export function useBulkEnrichment(options: UseBulkEnrichmentOptions) {
  const {
    books,
    isBooksLoading,
    libraryId,
    providerKey,
    metadataField,
    filterPredicate,
    overwrite = false,
    ignoreUnsupportedStatus = false,
    autoTrigger = true,
    autoReattach,
    reattachAnyType = false,
    canEdit = true,
    customGenres,
    successToastMessage,
    errorToastMessage,
    onComplete,
  } = options;

  const shouldAutoReattach = autoReattach ?? autoTrigger;

  const {user} = useAuth();
  const utils = trpc.useUtils();
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const successToastRef = useRef(successToastMessage);
  successToastRef.current = successToastMessage;

  const errorToastRef = useRef(errorToastMessage);
  errorToastRef.current = errorToastMessage;

  const canonicalType: CanonicalEnrichmentType =
    findEnrichmentDescriptor(metadataField || providerKey)?.statusKey ?? 'geo';

  const booksToBackfill = useMemo(() => {
    if (isBooksLoading || !books) {
      return [];
    }
    return books.filter(book => {
      if (
        !overwrite &&
        !ignoreUnsupportedStatus &&
        book.enrichmentStatus?.[canonicalType] === 'unsupported'
      ) {
        return false;
      }
      return filterPredicate(book);
    });
  }, [
    books,
    isBooksLoading,
    overwrite,
    ignoreUnsupportedStatus,
    canonicalType,
    filterPredicate,
  ]);

  const [isBackfilling, setIsBackfilling] = useState(false);
  const [progress, setProgress] = useState<BulkEnrichmentProgress>({
    completed: 0,
    failed: 0,
    total: 0,
  });
  const [inFlightCount, setInFlightCount] = useState(0);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeEnrichmentType, setActiveEnrichmentType] =
    useState<CanonicalEnrichmentType>(canonicalType);
  const [perBookStates, setPerBookStates] = useState<
    Record<string, BookJobTelemetry>
  >({});
  const [providerTelemetry, setProviderTelemetry] =
    useState<ProviderTelemetrySummary | null>(null);
  const [activeWave, setActiveWave] = useState<ActiveEnrichmentWave | null>(
    null,
  );

  const isRunningRef = useRef(false);
  const cancelledRef = useRef(false);
  const autoTriggeredForLibRef = useRef<string | null>(null);
  const reattachCheckedKeyRef = useRef<string | null>(null);
  const isCheckingReattachRef = useRef(false);
  const streamAbortControllerRef = useRef<AbortController | null>(null);
  const isSseConnectedRef = useRef(false);
  const lastPatchedCompletedCountRef = useRef(0);
  const lastDeltaSyncMsRef = useRef(0);
  const isPullingDeltaRef = useRef(false);

  const sseListenerUnregisterRef = useRef<(() => void) | null>(null);

  const closeStreamConnection = useCallback(() => {
    isSseConnectedRef.current = false;
    if (sseListenerUnregisterRef.current) {
      sseListenerUnregisterRef.current();
      sseListenerUnregisterRef.current = null;
    }
    if (streamAbortControllerRef.current) {
      streamAbortControllerRef.current.abort();
      streamAbortControllerRef.current = null;
    }
  }, []);

  const reconcileCrossReplicaDelta = useCallback(
    async (targetLibId: string) => {
      if (isPullingDeltaRef.current || cancelledRef.current) {
        return;
      }
      isPullingDeltaRef.current = true;
      try {
        const syncQuery = trpcVanilla.book?.syncChanges?.query;
        if (syncQuery) {
          const sinceUpdatedAtMs = Math.max(
            0,
            lastDeltaSyncMsRef.current - 5_000,
          );
          const delta = await syncQuery({
            libraryId: targetLibId,
            sinceUpdatedAtMs,
          });
          if (
            typeof delta?.syncCursorMs === 'number' &&
            delta.syncCursorMs > 0
          ) {
            lastDeltaSyncMsRef.current = delta.syncCursorMs;
          }
          const upserted = Array.isArray(delta?.upsertedBooks)
            ? delta.upsertedBooks
            : [];
          if (upserted.length > 0) {
            useEntityCacheStore
              .getState()
              .upsertBooksDelta(targetLibId, upserted);
            const upsertedById = new Map(upserted.map(b => [b.id, b]));
            utilsRef.current?.book?.list?.setData(
              {libraryId: targetLibId},
              old => {
                if (!old || !Array.isArray(old.books)) {
                  return old;
                }
                return {
                  ...old,
                  books: old.books.map(b => upsertedById.get(b.id) ?? b),
                };
              },
            );
            return;
          }
        }
        await utilsRef.current?.book?.list?.invalidate({
          libraryId: targetLibId,
        });
      } catch {
        void utilsRef.current?.book?.list?.invalidate({libraryId: targetLibId});
      } finally {
        isPullingDeltaRef.current = false;
      }
    },
    [],
  );

  const handleSseFrame = useCallback(
    (
      frame: ParsedSseFrame,
      targetLibId: string,
      expectedJobId?: string,
    ): boolean => {
      if (frame.event === 'job:snapshot') {
        try {
          const snap = parseSseJson<SseJobSnapshotPayload>(frame.data);
          if (!snap) {
            return false;
          }
          if (expectedJobId && snap.jobId && snap.jobId !== expectedJobId) {
            return false;
          }
          setActiveJobId(snap.jobId || null);
          if (snap.enrichmentType) {
            setActiveEnrichmentType(snap.enrichmentType);
          }
          setActiveWave(snap.activeWave ?? null);
          if (snap.perBookStates) {
            setPerBookStates(snap.perBookStates);
          }
          if (snap.providerTelemetry) {
            setProviderTelemetry(snap.providerTelemetry);
            setInFlightCount(snap.providerTelemetry.totalInFlight || 0);
          }
          if (typeof snap.totalBooks === 'number' && snap.totalBooks > 0) {
            setProgress({
              completed: snap.completedBooks || 0,
              failed: (snap.failedBooks || 0) + (snap.skippedBooks || 0),
              total: snap.totalBooks,
            });
          }
          if (snap.status === 'running' || snap.status === 'cancelling') {
            isRunningRef.current = true;
            setIsBackfilling(true);
            const snapCompleted = snap.completedBooks || 0;
            if (snapCompleted > lastPatchedCompletedCountRef.current) {
              lastPatchedCompletedCountRef.current = snapCompleted;
              void reconcileCrossReplicaDelta(targetLibId);
            }
          } else if (
            snap.status === 'completed' ||
            snap.status === 'cancelled' ||
            snap.status === 'failed'
          ) {
            isRunningRef.current = false;
            setIsBackfilling(false);
            setInFlightCount(0);
            setActiveWave(null);
            void reconcileCrossReplicaDelta(targetLibId);
            void utilsRef.current?.book?.list?.invalidate({
              libraryId: targetLibId,
            });
            if (snap.status === 'completed' && successToastRef.current) {
              toast.success(successToastRef.current);
            }
            onCompleteRef.current?.();
            closeStreamConnection();
            return true;
          }
        } catch {
          // Ignore malformed SSE payload
        }
        return false;
      }

      if (frame.event === 'book:progress') {
        try {
          const data = parseSseJson<SseBookProgressPayload>(frame.data);
          if (!data) {
            return false;
          }
          if (expectedJobId && data.jobId && data.jobId !== expectedJobId) {
            return false;
          }
          const bookEntry = data.book;
          if (bookEntry?.bookId) {
            setPerBookStates(prev => ({
              ...prev,
              [bookEntry.bookId]: bookEntry,
            }));
          }
          if (typeof data.totalBooks === 'number') {
            setProgress({
              completed: data.completedBooks || 0,
              failed: (data.failedBooks || 0) + (data.skippedBooks || 0),
              total: data.totalBooks,
            });
          }
        } catch {
          // Ignore malformed SSE payload
        }
        return false;
      }

      if (frame.event === 'provider:telemetry') {
        try {
          const data = parseSseJson<SseProviderTelemetryPayload>(frame.data);
          if (data?.telemetry) {
            setProviderTelemetry(data.telemetry);
            setInFlightCount(data.telemetry.totalInFlight || 0);
          }
        } catch {
          // Ignore malformed SSE payload
        }
        return false;
      }

      if (frame.event === 'batch:committed') {
        let patchedInPlace = false;
        try {
          const data = parseSseJson<SseBatchCommittedPayload>(frame.data);
          if (!data) {
            return false;
          }
          if (expectedJobId && data.jobId && data.jobId !== expectedJobId) {
            return false;
          }
          if (data.activeWave) {
            setActiveWave(data.activeWave);
          }
          if (typeof data.completedBooks === 'number') {
            lastPatchedCompletedCountRef.current = Math.max(
              lastPatchedCompletedCountRef.current,
              data.completedBooks,
            );
          }
          const results = Array.isArray(data.results) ? data.results : [];
          enrichmentLogger.info(
            `Micro-batch committed (${results.length} books patched in cache)`,
            {
              jobId: data.jobId,
              committedCount: results.length,
              completedBooks: data.completedBooks,
              totalBooks: data.totalBooks,
            },
          );
          if (results.length > 0) {
            patchedInPlace = applyBookPatchesToCaches(
              targetLibId,
              results,
              utilsRef.current,
            );
          }
        } catch {
          // Ignore malformed SSE payload
        }
        if (!patchedInPlace) {
          void utilsRef.current?.book?.list?.invalidate({
            libraryId: targetLibId,
          });
        }
        return false;
      }

      if (frame.event === 'job:completed') {
        try {
          const snap = parseSseJson<SseJobSnapshotPayload>(frame.data);
          if (snap) {
            if (expectedJobId && snap.jobId && snap.jobId !== expectedJobId) {
              return false;
            }
            enrichmentLogger.info(
              `Job ${snap.jobId || ''} completed (${snap.completedBooks || 0}/${snap.totalBooks || 0} books)`,
              {
                jobId: snap.jobId,
                completedBooks: snap.completedBooks,
                failedBooks: snap.failedBooks,
                skippedBooks: snap.skippedBooks,
              },
            );
            if (snap.perBookStates) {
              setPerBookStates(snap.perBookStates);
            }
            if (snap.providerTelemetry) {
              setProviderTelemetry(snap.providerTelemetry);
            }
            if (typeof snap.totalBooks === 'number') {
              setProgress({
                completed: snap.completedBooks || 0,
                failed: (snap.failedBooks || 0) + (snap.skippedBooks || 0),
                total: snap.totalBooks,
              });
            }
          }
        } catch {
          // Ignore parse error
        }
        isRunningRef.current = false;
        setIsBackfilling(false);
        setInFlightCount(0);
        setActiveWave(null);
        void reconcileCrossReplicaDelta(targetLibId);
        void utilsRef.current?.book?.list?.invalidate({
          libraryId: targetLibId,
        });
        if (successToastRef.current) {
          toast.success(successToastRef.current);
        }
        onCompleteRef.current?.();
        closeStreamConnection();
        return true;
      }

      return false;
    },
    [closeStreamConnection, reconcileCrossReplicaDelta],
  );

  const connectSseStream = useCallback(
    async (targetLibId: string, expectedJobId?: string) => {
      if (typeof fetch !== 'function') {
        isSseConnectedRef.current = false;
        return;
      }
      closeStreamConnection();

      const abortController = new AbortController();
      streamAbortControllerRef.current = abortController;

      try {
        const token =
          (await (
            auth as {currentUser?: {getIdToken?: () => Promise<string>}}
          )?.currentUser?.getIdToken?.()) || '';
        if (!token || cancelledRef.current || abortController.signal.aborted) {
          isSseConnectedRef.current = false;
          return;
        }

        const url = `/api/enrichment/stream?libraryId=${encodeURIComponent(
          targetLibId,
        )}`;
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal: abortController.signal,
        });

        if (!response.ok || !response.body) {
          isSseConnectedRef.current = false;
          return;
        }

        isSseConnectedRef.current = true;

        if (DebugTelemetryEngine.isHudActive()) {
          sseListenerUnregisterRef.current =
            DebugTelemetryEngine.getInstance().registerListener(
              `SSE:${canonicalType}`,
              url,
            );
          enrichmentLogger.info(
            `Connected Bearer SSE stream for ${canonicalType} on library ${targetLibId}`,
            {libraryId: targetLibId, jobId: expectedJobId},
          );
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (!abortController.signal.aborted) {
          const {done, value} = await reader.read();
          if (done) {
            break;
          }
          buffer += decoder.decode(value, {stream: true});
          const {frames, remainder} = consumeSseFrames(buffer);
          buffer = remainder;
          for (const frame of frames) {
            const reachedTerminal = handleSseFrame(
              frame,
              targetLibId,
              expectedJobId,
            );
            if (reachedTerminal) {
              return;
            }
          }
        }

        isSseConnectedRef.current = false;
      } catch {
        isSseConnectedRef.current = false;
      }
    },
    [closeStreamConnection, canonicalType, handleSseFrame],
  );

  const cancelEnrichment = useCallback(async () => {
    cancelledRef.current = true;
    isRunningRef.current = false;
    setIsBackfilling(false);
    setInFlightCount(0);
    setActiveWave(null);
    closeStreamConnection();

    if (libraryId && trpcVanilla.enrichment?.cancelJob?.mutate) {
      try {
        await trpcVanilla.enrichment.cancelJob.mutate({
          libraryId,
          jobId: activeJobId || undefined,
        });
      } catch {
        // Ignore cancellation errors
      }
    }
  }, [libraryId, activeJobId, closeStreamConnection]);

  const triggerBackfill = useCallback(async () => {
    if (isRunningRef.current) {
      return;
    }
    if (!user || !libraryId || !canEdit) {
      return;
    }
    if (booksToBackfill.length === 0) {
      return;
    }

    const bookIds = Array.from(
      new Set(booksToBackfill.map(b => b.id).filter(Boolean)),
    );
    if (bookIds.length === 0) {
      return;
    }

    const now = Date.now();
    cancelledRef.current = false;
    isRunningRef.current = true;
    setActiveEnrichmentType(canonicalType);
    lastPatchedCompletedCountRef.current = 0;
    lastDeltaSyncMsRef.current = now;
    setIsBackfilling(true);
    setInFlightCount(Math.min(bookIds.length, 5));
    setProgress({
      completed: 0,
      failed: 0,
      total: bookIds.length,
    });

    const initialStates: Record<string, BookJobTelemetry> = {};
    for (const id of bookIds) {
      initialStates[id] = {
        bookId: id,
        stage: 'queued',
        updatedAt: now,
      };
    }
    setPerBookStates(prev => ({...prev, ...initialStates}));

    const enrichmentClient = trpcVanilla.enrichment;

    try {
      const canUseSseJob =
        typeof fetch === 'function' &&
        Boolean(enrichmentClient?.startJob?.mutate) &&
        Boolean(
          (auth as {currentUser?: {getIdToken?: () => Promise<string>}})
            ?.currentUser?.getIdToken,
        );

      if (canUseSseJob && enrichmentClient?.startJob) {
        const snap = await enrichmentClient.startJob.mutate({
          libraryId,
          enrichmentType: canonicalType,
          bookIds,
          overwrite,
          customGenres,
        });

        if (cancelledRef.current) {
          return;
        }

        isRunningRef.current = true;
        setIsBackfilling(true);
        setActiveJobId(snap.jobId);
        if (snap.enrichmentType) {
          setActiveEnrichmentType(snap.enrichmentType);
        }
        setActiveWave(snap.activeWave ?? null);
        lastPatchedCompletedCountRef.current = snap.completedBooks || 0;
        if (snap.perBookStates) {
          setPerBookStates(prev => ({...prev, ...snap.perBookStates}));
        }
        if (snap.providerTelemetry) {
          setProviderTelemetry(snap.providerTelemetry);
          setInFlightCount(snap.providerTelemetry.totalInFlight ?? 0);
        }
        if (typeof snap.totalBooks === 'number' && snap.totalBooks > 0) {
          setProgress({
            completed: snap.completedBooks || 0,
            failed: (snap.failedBooks || 0) + (snap.skippedBooks || 0),
            total: snap.totalBooks,
          });
        }

        if (
          snap.status === 'completed' ||
          snap.status === 'cancelled' ||
          snap.status === 'failed'
        ) {
          closeStreamConnection();
          isRunningRef.current = false;
          setIsBackfilling(false);
          setInFlightCount(0);
          setActiveWave(null);
          await reconcileCrossReplicaDelta(libraryId);
          await utilsRef.current?.book?.list?.invalidate({libraryId});
          if (successToastRef.current) {
            toast.success(successToastRef.current);
          }
          onCompleteRef.current?.();
        } else {
          void connectSseStream(libraryId, snap.jobId);
        }
      } else if (enrichmentClient?.trigger?.mutate) {
        const triggerBatchIds = bookIds.slice(0, 100);
        const response = await enrichmentClient.trigger.mutate({
          libraryId,
          enrichmentType: canonicalType,
          bookIds: triggerBatchIds,
          overwrite,
          customGenres,
        });

        if (cancelledRef.current) {
          return;
        }

        const results = (response?.results || []) as Array<
          Record<string, unknown> & {id: string}
        >;
        const resultsById = new Map(results.map(r => [r.id, r]));

        if (results.length > 0) {
          applyBookPatchesToCaches(libraryId, results, utilsRef.current);
        }

        await utilsRef.current?.book?.list?.invalidate({libraryId});

        const completedCount = response?.processedCount ?? results.length;
        const failedCount = Math.max(0, bookIds.length - completedCount);
        const doneAt = Date.now();

        setPerBookStates(prev => {
          const next = {...prev};
          for (const id of bookIds) {
            next[id] = {
              bookId: id,
              stage: resultsById.has(id) ? 'completed' : 'skipped',
              updatedAt: doneAt,
            };
          }
          return next;
        });

        setProgress({
          completed: completedCount,
          failed: failedCount,
          total: bookIds.length,
        });
        isRunningRef.current = false;
        setIsBackfilling(false);
        setInFlightCount(0);

        if (successToastRef.current) {
          toast.success(successToastRef.current);
        }
        onCompleteRef.current?.();
      }
    } catch {
      closeStreamConnection();
      if (!cancelledRef.current) {
        isRunningRef.current = false;
        setIsBackfilling(false);
        setInFlightCount(0);
        if (errorToastRef.current) {
          toast.error(errorToastRef.current);
        }
      }
    }
  }, [
    user,
    libraryId,
    canEdit,
    booksToBackfill,
    canonicalType,
    overwrite,
    customGenres,
    connectSseStream,
    closeStreamConnection,
    reconcileCrossReplicaDelta,
  ]);

  // Mount-time discovery & automatic reattachment to active server enrichment jobs
  useEffect(() => {
    if (!shouldAutoReattach || !libraryId || !user) {
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      return;
    }
    if (isRunningRef.current) {
      return;
    }

    const enrichmentClient = trpcVanilla.enrichment;
    if (!enrichmentClient?.getJobStatus?.query) {
      return;
    }

    const checkKey = `${libraryId}:${reattachAnyType ? '*' : canonicalType}`;
    if (reattachCheckedKeyRef.current === checkKey) {
      return;
    }
    reattachCheckedKeyRef.current = checkKey;
    isCheckingReattachRef.current = true;

    let isMounted = true;
    void (async () => {
      try {
        const snap = await enrichmentClient.getJobStatus.query({libraryId});
        if (!isMounted || isRunningRef.current || !snap) {
          return;
        }
        const isActive =
          snap.status === 'running' || snap.status === 'cancelling';
        const matchesType =
          reattachAnyType ||
          !snap.enrichmentType ||
          snap.enrichmentType === canonicalType;

        if (!isActive || !matchesType) {
          return;
        }

        cancelledRef.current = false;
        isRunningRef.current = true;
        autoTriggeredForLibRef.current = `${libraryId}:${canonicalType}`;
        lastPatchedCompletedCountRef.current = snap.completedBooks || 0;
        lastDeltaSyncMsRef.current = Date.now();
        setIsBackfilling(true);
        setActiveJobId(snap.jobId || null);
        if (snap.enrichmentType) {
          setActiveEnrichmentType(snap.enrichmentType);
        }
        setActiveWave(snap.activeWave ?? null);
        if (snap.perBookStates) {
          setPerBookStates(snap.perBookStates);
        }
        if (snap.providerTelemetry) {
          setProviderTelemetry(snap.providerTelemetry);
          setInFlightCount(snap.providerTelemetry.totalInFlight ?? 0);
        }
        if (typeof snap.totalBooks === 'number' && snap.totalBooks > 0) {
          setProgress({
            completed: snap.completedBooks || 0,
            failed: (snap.failedBooks || 0) + (snap.skippedBooks || 0),
            total: snap.totalBooks,
          });
        }
        void connectSseStream(libraryId, snap.jobId);
      } catch {
        // Ignore transient status lookup failures on mount
      } finally {
        isCheckingReattachRef.current = false;
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [
    shouldAutoReattach,
    libraryId,
    user,
    reattachAnyType,
    canonicalType,
    connectSseStream,
  ]);

  useEffect(() => {
    if (!isBackfilling || !libraryId || !activeJobId) {
      return;
    }

    const enrichmentClient = trpcVanilla.enrichment;
    if (!enrichmentClient?.getJobStatus?.query) {
      return;
    }

    const interval = setInterval(() => {
      void (async () => {
        if (
          cancelledRef.current ||
          !isRunningRef.current ||
          isSseConnectedRef.current
        ) {
          return;
        }
        try {
          const snap = await enrichmentClient.getJobStatus.query({libraryId});
          if (!snap || (activeJobId && snap.jobId !== activeJobId)) {
            return;
          }

          if (snap.enrichmentType) {
            setActiveEnrichmentType(snap.enrichmentType);
          }
          setActiveWave(snap.activeWave ?? null);
          if (snap.perBookStates) {
            setPerBookStates(snap.perBookStates);
          }
          if (snap.providerTelemetry) {
            setProviderTelemetry(snap.providerTelemetry);
            setInFlightCount(snap.providerTelemetry.totalInFlight ?? 0);
          }
          if (typeof snap.totalBooks === 'number' && snap.totalBooks > 0) {
            setProgress({
              completed: snap.completedBooks || 0,
              failed: (snap.failedBooks || 0) + (snap.skippedBooks || 0),
              total: snap.totalBooks,
            });
          }
          const polledCompleted = snap.completedBooks || 0;
          if (
            (snap.status === 'running' || snap.status === 'cancelling') &&
            polledCompleted > lastPatchedCompletedCountRef.current
          ) {
            lastPatchedCompletedCountRef.current = polledCompleted;
            void reconcileCrossReplicaDelta(libraryId);
          }
          if (
            snap.status === 'completed' ||
            snap.status === 'cancelled' ||
            snap.status === 'failed'
          ) {
            isRunningRef.current = false;
            setIsBackfilling(false);
            setInFlightCount(0);
            setActiveWave(null);
            closeStreamConnection();
            void reconcileCrossReplicaDelta(libraryId);
            void utilsRef.current?.book?.list?.invalidate({libraryId});
            if (snap.status === 'completed' && successToastRef.current) {
              toast.success(successToastRef.current);
            }
            onCompleteRef.current?.();
          }
        } catch {
          // Ignore transient poll errors
        }
      })();
    }, 1500);

    return () => clearInterval(interval);
  }, [
    isBackfilling,
    libraryId,
    activeJobId,
    closeStreamConnection,
    reconcileCrossReplicaDelta,
  ]);

  useEffect(() => {
    if (!autoTrigger) {
      return;
    }
    if (isBooksLoading || !libraryId || !user || !canEdit) {
      return;
    }
    if (isRunningRef.current || isCheckingReattachRef.current) {
      return;
    }
    if (booksToBackfill.length === 0) {
      return;
    }

    const autoKey = `${libraryId}:${canonicalType}`;
    if (autoTriggeredForLibRef.current === autoKey) {
      return;
    }
    autoTriggeredForLibRef.current = autoKey;

    void triggerBackfill();
  }, [
    autoTrigger,
    isBooksLoading,
    libraryId,
    user,
    canEdit,
    booksToBackfill.length,
    canonicalType,
    triggerBackfill,
  ]);

  useEffect(() => {
    return () => {
      closeStreamConnection();
      isRunningRef.current = false;
    };
  }, [closeStreamConnection]);

  return {
    booksToBackfill,
    isBackfilling,
    progress,
    inFlightCount,
    triggerBackfill,
    cancelEnrichment,
    activeJobId,
    activeEnrichmentType,
    activeWave,
    perBookStates,
    providerTelemetry,
  };
}
