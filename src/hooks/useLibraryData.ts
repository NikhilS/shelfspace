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
import {useAuth} from '../stores/authStore';

export function useLibraryData(
  libraryId: string | undefined,
  userId: string | undefined,
  navigate: (path: string) => void,
) {
  const queryClient = useQueryClient();
  const {user} = useAuth();
  const [isSyncing, setIsSyncing] = useState(false);

  const libraryQuery = useQuery({
    queryKey: ['library', libraryId],
    enabled: !!libraryId && !!userId,
    initialData: () =>
      queryClient.getQueryData<Library>(['library', libraryId]) || undefined,
    queryFn: () =>
      queryClient.getQueryData<Library>(['library', libraryId]) || null,
    staleTime: Infinity,
  });

  const booksQuery = useQuery({
    queryKey: ['books', libraryId],
    enabled: !!libraryId && !!userId,
    initialData: () =>
      queryClient.getQueryData<Book[]>(['books', libraryId]) || undefined,
    queryFn: () => queryClient.getQueryData<Book[]>(['books', libraryId]) || [],
    staleTime: Infinity,
  });

  const [isLoading, setIsLoading] = useState(
    () => !queryClient.getQueryData(['library', libraryId]),
  );
  const [isBooksLoading, setIsBooksLoading] = useState(
    () => !queryClient.getQueryData(['books', libraryId]),
  );

  useEffect(() => {
    if (!libraryId || !userId) return;

    if (!queryClient.getQueryData(['library', libraryId])) {
      setIsLoading(true);
    }
    if (!queryClient.getQueryData(['books', libraryId])) {
      setIsBooksLoading(true);
    }

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
    };
  }, [libraryId, userId, navigate, queryClient]);

  const library = libraryQuery.data || null;
  const books = booksQuery.data || [];

  // Auto-reconcile parent library's bookCount when actual books are loaded in memory
  useEffect(() => {
    if (!library || isBooksLoading || isLoading) return;

    // Only owners or editors have write permission to update the library document
    const userEmail = user?.email?.toLowerCase();
    const isOwner = library.ownerId === userId;
    const isEditor =
      userEmail &&
      (library.access?.[userEmail] === 'editor' ||
        library.access?.[userEmail] === 'owner');

    if (!isOwner && !isEditor) return;

    if (library.bookCount !== books.length) {
      const libRef = doc(db, 'libraries', library.id);
      updateDoc(libRef, {
        bookCount: books.length,
        updatedAt: serverTimestamp(),
      }).catch(err => {
        console.warn(
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
    userId,
    user?.email,
  ]);

  return {library, books, isLoading, isBooksLoading, isSyncing};
}
