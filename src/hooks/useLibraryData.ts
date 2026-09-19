import {useEffect, useState, useMemo} from 'react';
import {Library, Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {useQueryClient} from '@tanstack/react-query';
import {trpc} from '../lib/trpc';

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
  navigate: (path: string) => void,
) {
  const queryClient = useQueryClient();

  const [isCachedFirstPaint] = useState(() => {
    const existing = queryClient.getQueryData<Book[]>(['books', libraryId]);
    return Boolean(existing && existing.length > 0);
  });

  // Fetch library document via tRPC gateway
  const trpcLibraryQuery = trpc.library.get.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: Boolean(libraryId && userId),
      staleTime: 1000 * 60 * 5,
    },
  );

  // Books fetched solely through trpc.book.list
  const trpcBooksQuery = trpc.book.list.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: Boolean(libraryId && userId),
      initialData: () => {
        const cached = queryClient.getQueryData<Book[]>(['books', libraryId]);
        return cached ? {books: cached} : undefined;
      },
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days IndexedDB retention
      networkMode: 'offlineFirst',
      retry: false,
    },
  );

  // Synchronize tRPC library result with the canonical ['library', libraryId] cache key
  useEffect(() => {
    if (!libraryId || !trpcLibraryQuery.data) return;
    const libData = trpcLibraryQuery.data as unknown as Library;
    queryClient.setQueryData(['library', libraryId], libData);

    const libBytes = calculatePayloadBytes(libData);
    DebugTelemetryEngine.getInstance().addLog(
      'api_request',
      `Queried library document via tRPC: "libraries/${libraryId}" (${(libBytes / 1024).toFixed(1)} KB)`,
      {
        path: `libraries/${libraryId}`,
        fromCache: trpcLibraryQuery.isStale === false,
        size: 1,
        bytes: libBytes,
        docCount: 1,
      },
    );
  }, [libraryId, trpcLibraryQuery.data, trpcLibraryQuery.isStale, queryClient]);

  // Handle library error
  useEffect(() => {
    if (trpcLibraryQuery.error) {
      toast.error('Library not found or access denied');
      navigate('/');
    }
  }, [trpcLibraryQuery.error, navigate]);

  // Synchronize tRPC book results with the canonical ['books', libraryId] cache key
  useEffect(() => {
    if (!libraryId || !trpcBooksQuery?.data) return;
    const rawData = trpcBooksQuery.data;
    const bookList = (
      Array.isArray(rawData)
        ? (rawData as Book[])
        : (rawData as {books?: Book[]}).books || []
    ) as Book[];

    queryClient.setQueryData(['books', libraryId], bookList);

    const payloadBytes = calculatePayloadBytes(bookList);
    DebugTelemetryEngine.getInstance().addLog(
      'api_request',
      `Queried books collection via tRPC (${bookList.length} docs, ${(payloadBytes / 1024).toFixed(1)} KB)`,
      {
        path: `libraries/${libraryId}/books`,
        fromCache: trpcBooksQuery.isStale === false,
        size: bookList.length,
        bytes: payloadBytes,
        docCount: bookList.length,
      },
    );
  }, [libraryId, trpcBooksQuery?.data, trpcBooksQuery?.isStale, queryClient]);

  const library =
    (trpcLibraryQuery.data as unknown as Library) ||
    queryClient.getQueryData<Library>(['library', libraryId]) ||
    null;

  const books = useMemo(() => {
    if (trpcBooksQuery?.data) {
      const raw = trpcBooksQuery.data;
      return (
        Array.isArray(raw) ? raw : (raw as {books?: Book[]}).books || []
      ) as Book[];
    }
    return queryClient.getQueryData<Book[]>(['books', libraryId]) || [];
  }, [trpcBooksQuery?.data, queryClient, libraryId]);

  const isLoading = trpcLibraryQuery.isLoading && !library;
  const isBooksLoading =
    Boolean(trpcBooksQuery?.isLoading) && books.length === 0;

  const isSyncing = Boolean(
    trpcBooksQuery?.isFetching && !trpcBooksQuery?.isLoading,
  );

  return {
    library,
    books,
    isLoading,
    isBooksLoading,
    isSyncing,
    isCachedFirstPaint,
  };
}
