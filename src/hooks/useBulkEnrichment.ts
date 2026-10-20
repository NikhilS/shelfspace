import {useState, useRef, useEffect, useCallback, useMemo} from 'react';
import {toast} from 'sonner';
import {Book} from '../types';
import {trpc, trpcVanilla} from '../lib/trpc';
import {useAuth} from '../stores/authStore';
import {auth} from '../firebase';
import {CanonicalEnrichmentType} from '../schemas/libraryApi';
import {createLogger, DebugTelemetryEngine} from '../lib/telemetry';

const enrichmentLogger = createLogger('Enrichment');

export type PerBookJobStage =
  | 'queued'
  | 'fetching_catalog'
  | 'fetching_ai'
  | 'completed'
  | 'skipped'
  | 'failed';

export interface BookJobTelemetry {
  bookId: string;
  stage: PerBookJobStage;
  winningProviders?: Record<string, string>;
  updatedFields?: string[];
  error?: string;
  updatedAt: number;
}

export interface ProviderTelemetrySummary {
  activeProviders: string[];
  delayedProviders: string[];
  cooldownProviders: Array<{providerId: string; cooldownRemainingMs: number}>;
  exhaustedProviders: string[];
  totalInFlight: number;
  maxGlobalConcurrent: number;
}

export interface BulkEnrichmentProgress {
  completed: number;
  failed: number;
  total: number;
}

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
  canEdit?: boolean;
  customGenres?: string[];
  successToastMessage?: string;
  errorToastMessage?: string;
  onComplete?: () => void;
}

function mapToCanonicalType(raw: string): CanonicalEnrichmentType {
  switch (raw) {
    case 'geo':
    case 'geoMetadata':
      return 'geo';
    case 'temporal':
    case 'temporalMetadata':
      return 'temporal';
    case 'genre':
    case 'primaryGenre':
      return 'genre';
    case 'synopsis':
      return 'synopsis';
    case 'authorBio':
      return 'authorBio';
    case 'coverImage':
    case 'coverUrl':
      return 'coverImage';
    case 'series':
      return 'series';
    case 'embedding':
    case 'embeddings':
      return 'embedding';
    default:
      return 'geo';
  }
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
    canEdit = true,
    customGenres,
    successToastMessage,
    errorToastMessage,
    onComplete,
  } = options;

  const {user} = useAuth();
  let utils: ReturnType<typeof trpc.useUtils> | null = null;
  try {
    utils = trpc.useUtils();
  } catch {
    utils = null;
  }
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const successToastRef = useRef(successToastMessage);
  successToastRef.current = successToastMessage;

  const errorToastRef = useRef(errorToastMessage);
  errorToastRef.current = errorToastMessage;

  const canonicalType = mapToCanonicalType(metadataField || providerKey);

  const booksToBackfill = useMemo(() => {
    if (isBooksLoading || !books) return [];
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
  const [perBookStates, setPerBookStates] = useState<
    Record<string, BookJobTelemetry>
  >({});
  const [providerTelemetry, setProviderTelemetry] =
    useState<ProviderTelemetrySummary | null>(null);

  const isRunningRef = useRef(false);
  const cancelledRef = useRef(false);
  const autoTriggeredForLibRef = useRef<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const sseListenerUnregisterRef = useRef<(() => void) | null>(null);

  const closeEventSource = useCallback(() => {
    if (sseListenerUnregisterRef.current) {
      sseListenerUnregisterRef.current();
      sseListenerUnregisterRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  const connectSseStream = useCallback(
    async (targetLibId: string, expectedJobId?: string) => {
      if (typeof EventSource === 'undefined') return;
      closeEventSource();

      try {
        const token =
          (await (
            auth as {currentUser?: {getIdToken?: () => Promise<string>}}
          )?.currentUser?.getIdToken?.()) || '';
        if (!token || cancelledRef.current) return;

        const url = `/api/enrichment/stream?libraryId=${encodeURIComponent(
          targetLibId,
        )}&token=${encodeURIComponent(token)}`;
        const es = new EventSource(url);
        eventSourceRef.current = es;

        if (DebugTelemetryEngine.isHudActive()) {
          sseListenerUnregisterRef.current =
            DebugTelemetryEngine.getInstance().registerListener(
              `SSE:${canonicalType}`,
              `/api/enrichment/stream?libraryId=${targetLibId}`,
            );
          enrichmentLogger.info(
            `Connected SSE stream for ${canonicalType} on library ${targetLibId}`,
            {libraryId: targetLibId, jobId: expectedJobId},
          );
        }

        es.addEventListener('job:snapshot', (evt: MessageEvent) => {
          try {
            const snap = JSON.parse(evt.data);
            if (expectedJobId && snap.jobId && snap.jobId !== expectedJobId) {
              return;
            }
            setActiveJobId(snap.jobId || null);
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
            if (snap.status === 'running') {
              isRunningRef.current = true;
              setIsBackfilling(true);
            } else if (
              snap.status === 'completed' ||
              snap.status === 'cancelled' ||
              snap.status === 'failed'
            ) {
              isRunningRef.current = false;
              setIsBackfilling(false);
              setInFlightCount(0);
              void utilsRef.current?.book?.list?.invalidate({
                libraryId: targetLibId,
              });
              if (snap.status === 'completed' && successToastRef.current) {
                toast.success(successToastRef.current);
              }
              onCompleteRef.current?.();
              closeEventSource();
            }
          } catch {
            // Ignore malformed SSE payload
          }
        });

        es.addEventListener('book:progress', (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data);
            if (expectedJobId && data.jobId && data.jobId !== expectedJobId) {
              return;
            }
            if (data.book?.bookId) {
              setPerBookStates(prev => ({
                ...prev,
                [data.book.bookId]: data.book,
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
        });

        es.addEventListener('provider:telemetry', (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data);
            if (data.telemetry) {
              setProviderTelemetry(data.telemetry);
              setInFlightCount(data.telemetry.totalInFlight || 0);
            }
          } catch {
            // Ignore malformed SSE payload
          }
        });

        es.addEventListener('batch:committed', (evt: MessageEvent) => {
          try {
            const data = JSON.parse(evt.data);
            if (expectedJobId && data.jobId && data.jobId !== expectedJobId) {
              return;
            }
            const results = Array.isArray(data.results)
              ? (data.results as Array<Record<string, unknown> & {id: string}>)
              : [];
            enrichmentLogger.info(
              `Micro-batch committed (${results.length} books patched in cache)`,
              {
                jobId: data.jobId,
                committedCount: results.length,
                completedBooks: data.completedBooks,
                totalBooks: data.totalBooks,
              },
            );
            if (results.length > 0 && utilsRef.current?.book?.list?.setData) {
              const resultsById = new Map(results.map(r => [r.id, r]));
              utilsRef.current.book.list.setData(
                {libraryId: targetLibId},
                old => {
                  if (!old) return old;
                  if (Array.isArray(old)) {
                    return (old as Book[]).map(b => {
                      const patch = resultsById.get(b.id);
                      return patch ? ({...b, ...patch} as Book) : b;
                    }) as unknown as typeof old;
                  }
                  return {
                    ...old,
                    books: (old.books || []).map(b => {
                      const patch = resultsById.get(b.id);
                      return patch ? ({...b, ...patch} as Book) : b;
                    }),
                  };
                },
              );
            }
          } catch {
            // Ignore malformed SSE payload
          }
          void utilsRef.current?.book?.list?.invalidate({
            libraryId: targetLibId,
          });
        });

        es.addEventListener('job:completed', (evt: MessageEvent) => {
          try {
            const snap = JSON.parse(evt.data);
            if (expectedJobId && snap.jobId && snap.jobId !== expectedJobId) {
              return;
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
          } catch {
            // Ignore parse error
          }
          isRunningRef.current = false;
          setIsBackfilling(false);
          setInFlightCount(0);
          void utilsRef.current?.book?.list?.invalidate({
            libraryId: targetLibId,
          });
          if (successToastRef.current) {
            toast.success(successToastRef.current);
          }
          onCompleteRef.current?.();
          closeEventSource();
        });

        es.onerror = () => {
          if (!isRunningRef.current) {
            closeEventSource();
          }
        };
      } catch {
        // Non-fatal in test environments
      }
    },
    [closeEventSource, canonicalType],
  );

  const cancelEnrichment = useCallback(async () => {
    cancelledRef.current = true;
    isRunningRef.current = false;
    setIsBackfilling(false);
    setInFlightCount(0);
    closeEventSource();

    const enrichmentClient = trpcVanilla.enrichment as unknown as {
      cancelJob?: {
        mutate: (input: {
          libraryId: string;
          jobId?: string;
        }) => Promise<unknown>;
      };
    };

    if (libraryId && enrichmentClient?.cancelJob?.mutate) {
      try {
        await enrichmentClient.cancelJob.mutate({
          libraryId,
          jobId: activeJobId || undefined,
        });
      } catch {
        // Ignore cancellation errors
      }
    }
  }, [libraryId, activeJobId, closeEventSource]);

  const triggerBackfill = useCallback(async () => {
    if (isRunningRef.current) return;
    if (!user || !libraryId || !canEdit) return;
    if (booksToBackfill.length === 0) return;

    const bookIds = Array.from(
      new Set(booksToBackfill.map(b => b.id).filter(Boolean)),
    );
    if (bookIds.length === 0) return;

    cancelledRef.current = false;
    isRunningRef.current = true;
    setIsBackfilling(true);
    setInFlightCount(Math.min(bookIds.length, 5));
    setProgress({
      completed: 0,
      failed: 0,
      total: bookIds.length,
    });

    const now = Date.now();
    const initialStates: Record<string, BookJobTelemetry> = {};
    for (const id of bookIds) {
      initialStates[id] = {
        bookId: id,
        stage: 'queued',
        updatedAt: now,
      };
    }
    setPerBookStates(prev => ({...prev, ...initialStates}));

    const enrichmentClient = trpcVanilla.enrichment as unknown as {
      startJob?: {
        mutate: (input: {
          libraryId: string;
          enrichmentType: CanonicalEnrichmentType;
          bookIds: string[];
          overwrite?: boolean;
          customGenres?: string[];
        }) => Promise<{
          jobId: string;
          status: string;
          totalBooks: number;
          completedBooks: number;
          failedBooks: number;
          skippedBooks: number;
          perBookStates?: Record<string, BookJobTelemetry>;
          providerTelemetry?: ProviderTelemetrySummary;
        }>;
      };
      trigger?: {
        mutate: (input: {
          libraryId: string;
          enrichmentType: CanonicalEnrichmentType;
          bookIds: string[];
          overwrite?: boolean;
          customGenres?: string[];
        }) => Promise<{
          status: string;
          enrichmentType: string;
          processedCount: number;
          results?: Array<Record<string, unknown> & {id: string}>;
        }>;
      };
    };

    try {
      const canUseSseJob =
        typeof EventSource !== 'undefined' &&
        Boolean(enrichmentClient?.startJob?.mutate) &&
        Boolean(
          (auth as {currentUser?: {getIdToken?: () => Promise<string>}})
            ?.currentUser?.getIdToken,
        );

      if (canUseSseJob && enrichmentClient.startJob) {
        const snap = await enrichmentClient.startJob.mutate({
          libraryId,
          enrichmentType: canonicalType,
          bookIds,
          overwrite,
          customGenres,
        });

        if (cancelledRef.current) return;

        isRunningRef.current = true;
        setIsBackfilling(true);
        setActiveJobId(snap.jobId);
        if (snap.perBookStates) {
          setPerBookStates(prev => ({...prev, ...snap.perBookStates}));
        }
        if (snap.providerTelemetry) {
          setProviderTelemetry(snap.providerTelemetry);
          setInFlightCount(
            snap.providerTelemetry.totalInFlight ??
              (snap.providerTelemetry as {totalActiveRequests?: number})
                .totalActiveRequests ??
              0,
          );
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
          closeEventSource();
          isRunningRef.current = false;
          setIsBackfilling(false);
          setInFlightCount(0);
          await utilsRef.current?.book?.list?.invalidate({libraryId});
          if (successToastRef.current) {
            toast.success(successToastRef.current);
          }
          onCompleteRef.current?.();
        } else {
          void connectSseStream(libraryId, snap.jobId);
        }
      } else if (enrichmentClient?.trigger?.mutate) {
        const response = await enrichmentClient.trigger.mutate({
          libraryId,
          enrichmentType: canonicalType,
          bookIds,
          overwrite,
          customGenres,
        });

        if (cancelledRef.current) return;

        const results = response?.results || [];
        const resultsById = new Map(results.map(r => [r.id, r]));

        if (results.length > 0 && utilsRef.current?.book?.list?.setData) {
          utilsRef.current.book.list.setData({libraryId}, old => {
            if (!old) return old;
            if (Array.isArray(old)) {
              return (old as Book[]).map(b => {
                const patch = resultsById.get(b.id);
                return patch ? ({...b, ...patch} as Book) : b;
              }) as unknown as typeof old;
            }
            return {
              ...old,
              books: (old.books || []).map(b => {
                const patch = resultsById.get(b.id);
                return patch ? ({...b, ...patch} as Book) : b;
              }),
            };
          });
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
      closeEventSource();
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
    closeEventSource,
  ]);

  useEffect(() => {
    if (!isBackfilling || !libraryId || !activeJobId) return;

    const enrichmentClient = trpcVanilla.enrichment as unknown as {
      getJobStatus?: {
        query: (input: {libraryId: string}) => Promise<{
          jobId: string;
          status: string;
          totalBooks: number;
          completedBooks: number;
          failedBooks: number;
          skippedBooks: number;
          perBookStates?: Record<string, BookJobTelemetry>;
          providerTelemetry?: ProviderTelemetrySummary;
        } | null>;
      };
    };

    if (!enrichmentClient?.getJobStatus?.query) return;

    const interval = setInterval(async () => {
      if (cancelledRef.current || !isRunningRef.current) return;
      try {
        const snap = await enrichmentClient.getJobStatus!.query({libraryId});
        if (!snap || (activeJobId && snap.jobId !== activeJobId)) return;

        if (snap.perBookStates) {
          setPerBookStates(snap.perBookStates);
        }
        if (snap.providerTelemetry) {
          setProviderTelemetry(snap.providerTelemetry);
          setInFlightCount(
            snap.providerTelemetry.totalInFlight ??
              (snap.providerTelemetry as {totalActiveRequests?: number})
                .totalActiveRequests ??
              0,
          );
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
          isRunningRef.current = false;
          setIsBackfilling(false);
          setInFlightCount(0);
          closeEventSource();
          void utilsRef.current?.book?.list?.invalidate({libraryId});
          if (snap.status === 'completed' && successToastRef.current) {
            toast.success(successToastRef.current);
          }
          onCompleteRef.current?.();
        }
      } catch {
        // Ignore transient poll errors
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isBackfilling, libraryId, activeJobId, closeEventSource]);

  useEffect(() => {
    if (!autoTrigger) return;
    if (isBooksLoading || !libraryId || !user || !canEdit) return;
    if (isRunningRef.current) return;
    if (booksToBackfill.length === 0) return;

    const autoKey = `${libraryId}:${canonicalType}`;
    if (autoTriggeredForLibRef.current === autoKey) return;
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
      closeEventSource();
      isRunningRef.current = false;
    };
  }, [closeEventSource]);

  return {
    booksToBackfill,
    isBackfilling,
    progress,
    inFlightCount,
    triggerBackfill,
    cancelEnrichment,
    activeJobId,
    perBookStates,
    providerTelemetry,
  };
}
