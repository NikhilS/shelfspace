import {useEffect, useMemo, useRef, useState} from 'react';
import {Library, Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {trpc, trpcVanilla} from '../lib/trpc';
import {markLibraryVisited} from '../components/layout/SuspenseFallbackRouter';

export interface UseLibraryDataResult {
  library: Library | null;
  books: Book[];
  isLoading: boolean;
  isBooksLoading: boolean;
  isPaginating: boolean;
  isSyncing: boolean;
  isCachedFirstPaint: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<void>;
}

export function mapDocToBook(docSnap: {
  id: string;
  data: () => Record<string, unknown> | undefined;
}): Book {
  const data = docSnap.data() || {};
  const bookData = {
    id: docSnap.id,
    ...data,
    primaryGenre: data.primaryGenre || undefined,
    subgenres: data.subgenres || [],
    isCustomPrimary: Boolean(data.isCustomPrimary),
  } as unknown as Book;

  if (bookData.temporalMetadata) {
    if (
      bookData.temporalMetadata.startYear !== undefined &&
      bookData.temporalMetadata.endYear === undefined
    ) {
      bookData.temporalMetadata.endYear = bookData.temporalMetadata.startYear;
    }

    if (
      (bookData.temporalMetadata.startYear !== undefined &&
        (bookData.temporalMetadata.startYear < -10000 ||
          bookData.temporalMetadata.startYear > 2100)) ||
      (bookData.temporalMetadata.endYear !== undefined &&
        (bookData.temporalMetadata.endYear < -10000 ||
          bookData.temporalMetadata.endYear > 2100))
    ) {
      delete bookData.temporalMetadata;
    }
  }

  return bookData;
}

export function useLibraryData(
  libraryId: string | undefined,
  userId: string | undefined,
  navigate?: (path: string) => void,
): UseLibraryDataResult {
  const isEnabled = Boolean(libraryId && userId);

  let utils: ReturnType<typeof trpc.useUtils> | undefined;
  try {
    if (typeof trpc !== 'undefined' && typeof trpc.useUtils === 'function') {
      utils = trpc.useUtils();
    }
  } catch {
    utils = undefined;
  }
  const utilsRef = useRef(utils);
  utilsRef.current = utils;

  const cachedLibrary = useMemo((): Library | undefined => {
    const currentUtils = utilsRef.current;
    if (!libraryId || !userId || !currentUtils?.library) {
      return undefined;
    }
    const getFn = currentUtils.library.get?.getData;
    const fromGet = getFn?.({libraryId}) as Library | undefined;
    if (fromGet) {
      return fromGet;
    }

    const listFn = currentUtils.library.list?.getData;
    const rawOwned = listFn?.({scopes: ['owned', 'shared']})?.libraries;
    const ownedShared = rawOwned as Library[] | undefined;
    const fromOwnedShared = ownedShared?.find(l => l.id === libraryId);
    if (fromOwnedShared) {
      return fromOwnedShared;
    }

    const rawAll = listFn?.({scopes: ['all']})?.libraries;
    const allLibs = rawAll as Library[] | undefined;
    const fromAll = allLibs?.find(l => l.id === libraryId);
    if (fromAll) {
      return fromAll;
    }

    const defaultLibs = listFn?.()?.libraries as Library[] | undefined;
    return defaultLibs?.find(l => l.id === libraryId);
  }, [libraryId, userId]);

  // 1. Declarative Library Query
  const libraryQuery = trpc.library.get.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: isEnabled,
      ...(cachedLibrary ? {initialData: cachedLibrary} : {}),
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: 1000 * 60 * 60 * 24, // 24 hours in memory
    },
  );

  // 2. Declarative Books Collection Query (First 1,000 books for instant first paint)
  const booksQuery = trpc.book.list.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: isEnabled,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days IndexedDB retention
      networkMode: 'offlineFirst',
      retry: 2,
    },
  );

  const [drainedState, setDrainedState] = useState<{
    libraryId: string;
    startCursor: string;
    books: Book[];
    isComplete: boolean;
  }>({
    libraryId: '',
    startCursor: '',
    books: [],
    isComplete: false,
  });
  const [isDrainingCursor, setIsDrainingCursor] = useState(false);
  const [drainEpoch, setDrainEpoch] = useState(0);

  const baseBooks = useMemo(() => {
    if (!booksQuery.data) {
      return [];
    }
    const raw = booksQuery.data;
    if (Array.isArray(raw)) {
      return raw as Book[];
    }
    if ('books' in raw && Array.isArray((raw as {books: unknown}).books)) {
      return (raw as {books: Book[]}).books;
    }
    return [];
  }, [booksQuery.data]);

  const initialNextCursor = useMemo(() => {
    const raw = booksQuery.data;
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      'nextCursor' in raw &&
      typeof (raw as {nextCursor?: unknown}).nextCursor === 'string' &&
      (raw as {nextCursor: string}).nextCursor.length > 0
    ) {
      return (raw as {nextCursor: string}).nextCursor;
    }
    return undefined;
  }, [booksQuery.data]);

  const serverTotalCount = useMemo(() => {
    const raw = booksQuery.data;
    if (
      raw &&
      typeof raw === 'object' &&
      !Array.isArray(raw) &&
      'totalCount' in raw &&
      typeof (raw as {totalCount?: unknown}).totalCount === 'number'
    ) {
      return (raw as {totalCount: number}).totalCount;
    }
    return undefined;
  }, [booksQuery.data]);

  // 2b. Background Cursor Drain for Libraries > 1,000 Books
  useEffect(() => {
    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    if (
      !isEnabled ||
      !libraryId ||
      !initialNextCursor ||
      booksQuery.isLoading ||
      isOffline
    ) {
      setIsDrainingCursor(false);
      return undefined;
    }

    if (
      drainedState.libraryId === libraryId &&
      drainedState.startCursor === initialNextCursor &&
      drainedState.isComplete
    ) {
      setIsDrainingCursor(false);
      return undefined;
    }

    let cancelled = false;
    setIsDrainingCursor(true);

    async function drainRemainingPages(
      targetLibId: string,
      startCursor: string,
    ) {
      const visitedCursors = new Set<string>();
      let currentCursor: string | undefined = startCursor;
      const accumulatedExtra: Book[] = [];
      let latestTotalCount: number | undefined;

      try {
        while (
          currentCursor &&
          !visitedCursors.has(currentCursor) &&
          !cancelled
        ) {
          visitedCursors.add(currentCursor);
          const page = (await trpcVanilla.book.list.query({
            libraryId: targetLibId,
            cursor: currentCursor,
            limit: 1000,
          })) as
            | {books?: Book[]; nextCursor?: string; totalCount?: number}
            | undefined;

          if (cancelled || !page) {
            break;
          }

          if (typeof page.totalCount === 'number') {
            latestTotalCount = page.totalCount;
          }

          const pageBooks = Array.isArray(page.books) ? page.books : [];
          if (pageBooks.length === 0) {
            currentCursor = undefined;
          } else {
            accumulatedExtra.push(...pageBooks);
            currentCursor =
              page.nextCursor && page.nextCursor !== currentCursor
                ? page.nextCursor
                : undefined;
          }

          setDrainedState({
            libraryId: targetLibId,
            startCursor,
            books: [...accumulatedExtra],
            isComplete: !currentCursor,
          });
        }

        if (!cancelled) {
          setDrainedState({
            libraryId: targetLibId,
            startCursor,
            books: [...accumulatedExtra],
            isComplete: true,
          });

          const currentUtils = utilsRef.current;
          if (currentUtils?.book?.list?.setData) {
            let finalMergedLength = 0;
            currentUtils.book.list.setData({libraryId: targetLibId}, old => {
              if (!old || Array.isArray(old)) {
                return old;
              }
              const existing = Array.isArray(old.books) ? old.books : [];
              const seen = new Set<string>();
              const merged: Book[] = [];
              for (const b of existing) {
                if (b?.id && !seen.has(b.id)) {
                  seen.add(b.id);
                  merged.push(b);
                }
              }
              for (const b of accumulatedExtra) {
                if (b?.id && !seen.has(b.id)) {
                  seen.add(b.id);
                  merged.push(b);
                }
              }
              finalMergedLength = merged.length;
              return {
                ...old,
                books: merged,
                nextCursor: undefined,
                totalCount: latestTotalCount ?? merged.length,
              };
            });

            if (finalMergedLength > 0 && currentUtils.library?.get?.setData) {
              currentUtils.library.get.setData(
                {libraryId: targetLibId},
                oldLib => {
                  if (!oldLib) {
                    return oldLib;
                  }
                  return {
                    ...oldLib,
                    bookCount: finalMergedLength,
                  };
                },
              );
            }
          }
        }
      } catch (err) {
        console.warn(
          `[useLibraryData] Failed to drain additional book pages for library '${targetLibId}':`,
          err,
        );
      } finally {
        if (!cancelled) {
          setIsDrainingCursor(false);
        }
      }
    }

    void drainRemainingPages(libraryId, initialNextCursor);

    return () => {
      cancelled = true;
    };
  }, [
    isEnabled,
    libraryId,
    initialNextCursor,
    booksQuery.isLoading,
    drainEpoch,
    drainedState.libraryId,
    drainedState.startCursor,
    drainedState.isComplete,
  ]);

  // 3. Normalized Data Derivation
  const books = useMemo(() => {
    const extra =
      drainedState.libraryId === libraryId ? drainedState.books : [];
    if (extra.length === 0) {
      return baseBooks;
    }
    const seen = new Set<string>();
    const merged: Book[] = [];
    for (const b of baseBooks) {
      if (b?.id && !seen.has(b.id)) {
        seen.add(b.id);
        merged.push(b);
      }
    }
    for (const b of extra) {
      if (b?.id && !seen.has(b.id)) {
        seen.add(b.id);
        merged.push(b);
      }
    }
    return merged;
  }, [baseBooks, drainedState, libraryId]);

  const isCursorExhausted =
    !initialNextCursor ||
    (drainedState.libraryId === libraryId &&
      drainedState.startCursor === initialNextCursor &&
      drainedState.isComplete);
  const isPaginating = isDrainingCursor || !isCursorExhausted;

  const library = useMemo(() => {
    const rawLib =
      (libraryQuery.data as unknown as Library) ?? cachedLibrary ?? null;
    if (!rawLib) {
      return null;
    }
    const authoritativeCount =
      !isPaginating && !booksQuery.isLoading && books.length > 0
        ? books.length
        : typeof serverTotalCount === 'number'
          ? serverTotalCount
          : rawLib.bookCount;

    if (
      typeof authoritativeCount === 'number' &&
      rawLib.bookCount !== undefined &&
      rawLib.bookCount !== authoritativeCount
    ) {
      return {
        ...rawLib,
        bookCount: authoritativeCount,
      };
    }
    return rawLib;
  }, [
    libraryQuery.data,
    cachedLibrary,
    isPaginating,
    booksQuery.isLoading,
    books.length,
    serverTotalCount,
  ]);

  useEffect(() => {
    if (library && libraryId) {
      markLibraryVisited(libraryId);
    }
  }, [library, libraryId]);

  // 4. Telemetry Logging (Deferred execution, gated when Developer HUD is closed)
  useEffect(() => {
    if (library && libraryId && DebugTelemetryEngine.isHudActive()) {
      const schedule =
        typeof window !== 'undefined' && 'requestIdleCallback' in window
          ? window.requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 10);
      const cancel =
        typeof window !== 'undefined' && 'cancelIdleCallback' in window
          ? window.cancelIdleCallback
          : (id: number) => clearTimeout(id);

      const handle = schedule(() => {
        const bytes = calculatePayloadBytes(library);
        DebugTelemetryEngine.getInstance().addLog(
          'api_res',
          `Loaded library "${library.name}" via tRPC (${(bytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}`,
            size: 1,
            bytes,
            fromCache: !libraryQuery.isStale,
          },
        );
      });

      return () => {
        cancel(handle as number);
      };
    }
    return undefined;
  }, [library, libraryId, libraryQuery.isStale]);

  useEffect(() => {
    if (books.length > 0 && libraryId && DebugTelemetryEngine.isHudActive()) {
      const schedule =
        typeof window !== 'undefined' && 'requestIdleCallback' in window
          ? window.requestIdleCallback
          : (cb: () => void) => setTimeout(cb, 10);
      const cancel =
        typeof window !== 'undefined' && 'cancelIdleCallback' in window
          ? window.cancelIdleCallback
          : (id: number) => clearTimeout(id);

      const handle = schedule(() => {
        const bytes = calculatePayloadBytes(books);
        DebugTelemetryEngine.getInstance().addLog(
          'api_res',
          `Loaded ${books.length} books via tRPC (${(bytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}/books`,
            size: books.length,
            bytes,
            fromCache: !booksQuery.isStale,
          },
        );
      });

      return () => {
        cancel(handle as number);
      };
    }
    return undefined;
  }, [books, libraryId, booksQuery.isStale]);

  // 5. Navigation Guard on Fatal Error (only when online and no cached library fallback exists)
  useEffect(() => {
    const isOffline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    if (libraryQuery.isError && !library && !isOffline) {
      toast.error('Library not found or access denied');
      if (navigate) {
        navigate('/');
      }
    }
  }, [libraryQuery.isError, library, navigate]);

  // 6. Granular State Derivation directly from TanStack Query + Background Drain
  const isLoading = libraryQuery.isLoading && !library;
  const isBooksLoading = booksQuery.isLoading;
  const isSyncing =
    (booksQuery.isFetching && !booksQuery.isLoading) || isPaginating;
  const isCachedFirstPaint = !booksQuery.isLoading && books.length > 0;

  const refetch = async () => {
    setDrainedState({
      libraryId: '',
      startCursor: '',
      books: [],
      isComplete: false,
    });
    setDrainEpoch(prev => prev + 1);
    await Promise.all([libraryQuery.refetch(), booksQuery.refetch()]);
  };

  return {
    library,
    books,
    isLoading,
    isBooksLoading,
    isPaginating,
    isSyncing,
    isCachedFirstPaint,
    isError: libraryQuery.isError || booksQuery.isError,
    error: libraryQuery.error || booksQuery.error,
    refetch,
  };
}
