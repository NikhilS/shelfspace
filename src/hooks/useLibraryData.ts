import {useEffect, useMemo, useRef} from 'react';
import {Library, Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {trpc} from '../lib/trpc';

export interface UseLibraryDataResult {
  library: Library | null;
  books: Book[];
  isLoading: boolean;
  isBooksLoading: boolean;
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
    if (!libraryId || !userId || !currentUtils?.library) return undefined;
    const getFn = currentUtils.library.get?.getData;
    const fromGet = getFn?.({libraryId}) as Library | undefined;
    if (fromGet) return fromGet;

    const listFn = currentUtils.library.list?.getData;
    const rawOwned = listFn?.({scopes: ['owned', 'shared']})?.libraries;
    const ownedShared = rawOwned as Library[] | undefined;
    const fromOwnedShared = ownedShared?.find(l => l.id === libraryId);
    if (fromOwnedShared) return fromOwnedShared;

    const rawAll = listFn?.({scopes: ['all']})?.libraries;
    const allLibs = rawAll as Library[] | undefined;
    const fromAll = allLibs?.find(l => l.id === libraryId);
    if (fromAll) return fromAll;

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

  // 2. Declarative Books Collection Query
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

  // 3. Normalized Data Derivation
  const library = useMemo(() => {
    return (libraryQuery.data as unknown as Library) ?? cachedLibrary ?? null;
  }, [libraryQuery.data, cachedLibrary]);

  const books = useMemo(() => {
    if (!booksQuery.data) return [];
    const raw = booksQuery.data;
    if (Array.isArray(raw)) return raw as Book[];
    if ('books' in raw && Array.isArray((raw as {books: unknown}).books)) {
      return (raw as {books: Book[]}).books;
    }
    return [];
  }, [booksQuery.data]);

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

  // 5. Navigation Guard on Fatal Error (only when no cached library fallback exists and caller requested redirect)
  useEffect(() => {
    if (libraryQuery.isError && !library) {
      toast.error('Library not found or access denied');
      if (navigate) {
        navigate('/');
      }
    }
  }, [libraryQuery.isError, library, navigate]);

  // 6. Granular State Derivation directly from TanStack Query
  const isLoading = libraryQuery.isLoading && !library;
  const isBooksLoading = booksQuery.isLoading;
  const isSyncing = booksQuery.isFetching && !booksQuery.isLoading;
  const isCachedFirstPaint = !booksQuery.isLoading && books.length > 0;

  const refetch = async () => {
    await Promise.all([libraryQuery.refetch(), booksQuery.refetch()]);
  };

  return {
    library,
    books,
    isLoading,
    isBooksLoading,
    isSyncing,
    isCachedFirstPaint,
    isError: libraryQuery.isError || booksQuery.isError,
    error: libraryQuery.error || booksQuery.error,
    refetch,
  };
}
