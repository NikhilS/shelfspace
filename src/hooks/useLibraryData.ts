import {useEffect, useState} from 'react';
import {
  doc,
  collection,
  onSnapshot,
  query,
  orderBy,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Library, Book} from '../types';
import {toast} from 'sonner';
import {parseGenres} from '../lib/utils';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {useQuery, useQueryClient} from '@tanstack/react-query';

export function useLibraryData(
  libraryId: string | undefined,
  userId: string | undefined,
  navigate: (path: string) => void,
) {
  const queryClient = useQueryClient();
  const [isSyncing, setIsSyncing] = useState(false);

  const libraryQuery = useQuery({
    queryKey: ['library', libraryId],
    enabled: !!libraryId && !!userId,
    queryFn: () =>
      new Promise<Library | null>(resolve => {
        // the initial value is populated by the snapshot listener below, but this fn is needed so useQuery doesn't complain.
        // Alternatively, we can just use the initial snapshot if the listener takes more time
        resolve(queryClient.getQueryData(['library', libraryId]) || null);
      }),
    staleTime: Infinity,
  });

  const booksQuery = useQuery({
    queryKey: ['books', libraryId],
    enabled: !!libraryId && !!userId,
    queryFn: () =>
      new Promise<Book[]>(resolve => {
        resolve(queryClient.getQueryData(['books', libraryId]) || []);
      }),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!libraryId || !userId) return;

    setIsLoading(true);
    setIsBooksLoading(true);

    const libRef = doc(db, 'libraries', libraryId);
    const unsubscribeLib = onSnapshot(
      libRef,
      {includeMetadataChanges: true},
      docSnap => {
        const fromCache = docSnap.metadata.fromCache;
        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Read library document: "libraries/${libraryId}"`,
          {path: `libraries/${libraryId}`, fromCache, exists: docSnap.exists()},
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
        setIsLoading(false);
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}`,
        );
      },
    );

    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const q = query(booksRef, orderBy('addedAt', 'desc'));

    const unsubscribeBooks = onSnapshot(
      q,
      {includeMetadataChanges: true},
      snapshot => {
        setIsSyncing(snapshot.metadata.hasPendingWrites);

        const fromCache = snapshot.metadata.fromCache;
        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Queried books collection of length ${snapshot.size}`,
          {
            path: `libraries/${libraryId}/books`,
            fromCache,
            size: snapshot.size,
          },
        );

        const bks: Book[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          const rawGenres =
            data.genres ||
            data.genre ||
            data.categories ||
            data.category ||
            data.tags ||
            data.subjects;

          const parsedGenres = parseGenres(rawGenres);

          const bookData = {id: doc.id, ...data, genres: parsedGenres} as Book;

          if (bookData.temporalMetadata) {
            if (
              bookData.temporalMetadata.startYear !== undefined &&
              bookData.temporalMetadata.endYear === undefined
            ) {
              bookData.temporalMetadata.endYear =
                bookData.temporalMetadata.startYear;
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

          bks.push(bookData);
        });

        // Push directly to tanstack cache
        queryClient.setQueryData(['books', libraryId], bks);
        setIsBooksLoading(false);
      },
      error => {
        setIsBooksLoading(false);
        handleFirestoreError(
          error,
          OperationType.LIST,
          `libraries/${libraryId}/books`,
        );
      },
    );

    return () => {
      unsubscribeLib();
      unsubscribeBooks();
      // Optional: clear cache on unmount? Better let react-query manage it.
    };
  }, [libraryId, userId, navigate, queryClient]);

  const [isLoading, setIsLoading] = useState(true);
  const [isBooksLoading, setIsBooksLoading] = useState(true);

  const library = libraryQuery.data || null;
  const books = booksQuery.data || [];

  // Auto-reconcile parent library's bookCount when actual books are loaded in memory

  useEffect(() => {
    if (!library || isBooksLoading || isLoading) return;
    if (library.bookCount !== books.length) {
      const libRef = doc(db, 'libraries', library.id);
      updateDoc(libRef, {
        bookCount: books.length,
        updatedAt: serverTimestamp(),
      }).catch(err => {
        console.error(
          '[useLibraryData] Failed to auto-reconcile bookCount:',
          err,
        );
      });
    }
  }, [
    library?.id,
    library?.bookCount,
    books.length,
    isBooksLoading,
    isLoading,
  ]);

  return {library, books, isLoading, isBooksLoading, isSyncing};
}
