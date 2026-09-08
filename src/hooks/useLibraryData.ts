import {useEffect, useState} from 'react';
import {
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
  getDocsFromCache,
  getDocFromCache,
  DocumentData,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Library, Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {useQuery, useQueryClient, skipToken} from '@tanstack/react-query';

export function mapDocToBook(docSnap: {
  id: string;
  data: () => DocumentData | undefined;
}): Book {
  const data = docSnap.data() || {};
  const bookData = {
    id: docSnap.id,
    ...data,
    primaryGenre: data.primaryGenre || undefined,
    subgenres: data.subgenres || [],
    isCustomPrimary: Boolean(data.isCustomPrimary),
  } as Book;

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
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCachedFirstPaint, setIsCachedFirstPaint] = useState(() =>
    Boolean(queryClient.getQueryData(['books', libraryId])),
  );

  const libraryQuery = useQuery<Library | null>({
    queryKey: ['library', libraryId],
    queryFn: skipToken,
    initialData: () =>
      queryClient.getQueryData<Library>(['library', libraryId]) || undefined,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  const booksQuery = useQuery<Book[]>({
    queryKey: ['books', libraryId],
    queryFn: skipToken,
    initialData: () =>
      queryClient.getQueryData<Book[]>(['books', libraryId]) || undefined,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  const [isLoading, setIsLoading] = useState(
    () => !queryClient.getQueryData(['library', libraryId]),
  );
  const [isBooksLoading, setIsBooksLoading] = useState(
    () => !queryClient.getQueryData(['books', libraryId]),
  );

  useEffect(() => {
    if (!libraryId || !userId) return;

    let isMounted = true;
    let hasReceivedNetworkLibUpdate = false;
    let hasReceivedNetworkBooksUpdate = false;

    if (!queryClient.getQueryData(['library', libraryId])) {
      setIsLoading(true);
    }
    if (!queryClient.getQueryData(['books', libraryId])) {
      setIsBooksLoading(true);
    }

    const libRef = doc(db, 'libraries', libraryId);
    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const q = query(booksRef, orderBy('addedAt', 'desc'));

    // Stage 1: Synchronous / Immediate IndexedDB Cache Paint
    const hydrateFromCache = async () => {
      // 1. Library document cache paint
      if (!queryClient.getQueryData(['library', libraryId])) {
        try {
          const cachedLibSnap = await getDocFromCache(libRef);
          if (
            isMounted &&
            !hasReceivedNetworkLibUpdate &&
            cachedLibSnap.exists()
          ) {
            const libData = cachedLibSnap.data();
            const libBytes = calculatePayloadBytes(libData);
            DebugTelemetryEngine.getInstance().addLog(
              'db_read',
              `Hydrated library document from cache: "libraries/${libraryId}" (${(libBytes / 1024).toFixed(1)} KB)`,
              {
                path: `libraries/${libraryId}`,
                fromCache: true,
                exists: true,
                bytes: libBytes,
                docCount: 1,
              },
            );
            const newLib = {id: cachedLibSnap.id, ...libData} as Library;
            queryClient.setQueryData(['library', libraryId], newLib);
            setIsLoading(false);
          }
        } catch {
          // Cache miss or first visit - proceed smoothly to onSnapshot
        }
      }

      // 2. Books collection cache paint
      if (!queryClient.getQueryData(['books', libraryId])) {
        try {
          const cachedSnapshot = await getDocsFromCache(q);
          if (
            isMounted &&
            !hasReceivedNetworkBooksUpdate &&
            !cachedSnapshot.empty
          ) {
            const parseStartTime = performance.now();
            const cachedBooks = cachedSnapshot.docs.map(mapDocToBook);
            const parseDurationMs = Math.round(
              performance.now() - parseStartTime,
            );
            const payloadBytes = calculatePayloadBytes(cachedBooks);

            DebugTelemetryEngine.getInstance().addLog(
              'db_read',
              `Hydrated books collection from cache (${cachedSnapshot.size} docs, ${(payloadBytes / 1024).toFixed(1)} KB, ${parseDurationMs}ms)`,
              {
                path: `libraries/${libraryId}/books`,
                fromCache: true,
                size: cachedSnapshot.size,
                bytes: payloadBytes,
                docCount: cachedSnapshot.size,
                parseDurationMs,
              },
            );

            queryClient.setQueryData(['books', libraryId], cachedBooks);
            setIsCachedFirstPaint(true);
            setIsBooksLoading(false);
          }
        } catch {
          // Cache miss or first visit - proceed smoothly to onSnapshot
        }
      }
    };

    void hydrateFromCache();

    // Stage 2: Network onSnapshot Delta Reconciliation
    const unregisterLibTelemetry =
      DebugTelemetryEngine.getInstance().registerListener(
        'useLibraryData:lib',
        `libraries/${libraryId}`,
      );
    const unsubscribeLib = onSnapshot(
      libRef,
      {includeMetadataChanges: true},
      docSnap => {
        if (!isMounted) return;
        const fromCache = docSnap.metadata.fromCache;
        if (!fromCache) {
          hasReceivedNetworkLibUpdate = true;
        }
        const libData = docSnap.exists() ? docSnap.data() : null;
        const libBytes = libData ? calculatePayloadBytes(libData) : 0;

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Read library document: "libraries/${libraryId}" (${(libBytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}`,
            fromCache,
            exists: docSnap.exists(),
            bytes: libBytes,
            docCount: 1,
          },
        );

        if (docSnap.exists()) {
          const newLib = {id: docSnap.id, ...docSnap.data()} as Library;
          queryClient.setQueryData(['library', libraryId], newLib);
        } else {
          toast.error('Library not found');
          navigate('/');
        }
        setIsLoading(false);
      },
      error => {
        if (!isMounted) return;
        setIsLoading(false);
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}`,
        );
      },
    );

    const unregisterBooksTelemetry =
      DebugTelemetryEngine.getInstance().registerListener(
        'useLibraryData:books',
        `libraries/${libraryId}/books`,
      );
    const unsubscribeBooks = onSnapshot(
      q,
      {includeMetadataChanges: true},
      snapshot => {
        if (!isMounted) return;
        const parseStartTime = performance.now();
        setIsSyncing(snapshot.metadata.hasPendingWrites);

        const fromCache = snapshot.metadata.fromCache;
        if (!fromCache) {
          hasReceivedNetworkBooksUpdate = true;
        }

        const bks = snapshot.docs.map(mapDocToBook);
        const parseDurationMs = Math.round(performance.now() - parseStartTime);
        const payloadBytes = calculatePayloadBytes(bks);

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Queried books collection (${snapshot.size} docs, ${(payloadBytes / 1024).toFixed(1)} KB, ${parseDurationMs}ms)`,
          {
            path: `libraries/${libraryId}/books`,
            fromCache,
            size: snapshot.size,
            bytes: payloadBytes,
            docCount: snapshot.size,
            parseDurationMs,
          },
        );

        // Seamlessly reconcile new or edited books without screen flash
        queryClient.setQueryData(['books', libraryId], bks);
        setIsBooksLoading(false);
      },
      error => {
        if (!isMounted) return;
        setIsBooksLoading(false);
        handleFirestoreError(
          error,
          OperationType.LIST,
          `libraries/${libraryId}/books`,
        );
      },
    );

    return () => {
      isMounted = false;
      unregisterLibTelemetry();
      unsubscribeLib();
      unregisterBooksTelemetry();
      unsubscribeBooks();
    };
  }, [libraryId, userId, navigate, queryClient]);

  const library = libraryQuery.data || null;
  const books = booksQuery.data || [];

  return {
    library,
    books,
    isLoading,
    isBooksLoading,
    isSyncing,
    isCachedFirstPaint,
  };
}
