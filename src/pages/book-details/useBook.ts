import {useState, useEffect, useMemo} from 'react';
import {
  doc,
  collection,
  query,
  onSnapshot,
  orderBy,
  updateDoc,
  setDoc,
  serverTimestamp,
  addDoc,
  getDocFromCache,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {uploadBase64Image} from '../../services/db/storage';
import {Book, BookDetailsPayload, FirestoreDate} from '../../types';
export type {Book, BookDetailsPayload, FirestoreDate};
import {useAuth} from '../../stores/authStore';
import {
  useQuery,
  useMutation,
  useQueryClient,
  skipToken,
} from '@tanstack/react-query';

import {deleteBookAtomic} from '../../services/db/books';
import {
  DebugTelemetryEngine,
  calculatePayloadBytes,
  instrumentMutation,
} from '../../lib/telemetry';
import {mapDocToBook} from '../../hooks/useLibraryData';

export interface Review {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt: FirestoreDate;
}

export function useBook(
  libraryId: string | undefined,
  bookId: string | undefined,
  passedCanEdit?: boolean,
  isLive: boolean = true,
) {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [canEditLocal, setCanEditLocal] = useState(false);

  const canEdit = passedCanEdit !== undefined ? passedCanEdit : canEditLocal;

  const qBookBase = useQuery<Book | null>({
    queryKey: ['bookBase', libraryId, bookId],
    queryFn: skipToken,
    initialData: () => {
      const direct = queryClient.getQueryData<Book>([
        'bookBase',
        libraryId,
        bookId,
      ]);
      if (direct) return direct;
      const cachedBooks = libraryId
        ? queryClient.getQueryData<Book[]>(['books', libraryId])
        : undefined;
      return cachedBooks?.find(b => b.id === bookId) || null;
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  const qBookDetails = useQuery<BookDetailsPayload | null>({
    queryKey: ['bookDetails', libraryId, bookId],
    queryFn: skipToken,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  const qReviews = useQuery<Review[]>({
    queryKey: ['bookReviews', libraryId, bookId],
    queryFn: skipToken,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60, // 1 hour
  });

  const [isLoading, setIsLoading] = useState(() => {
    if (queryClient.getQueryData(['bookBase', libraryId, bookId])) return false;
    const cachedBooks = libraryId
      ? queryClient.getQueryData<Book[]>(['books', libraryId])
      : undefined;
    return !cachedBooks?.some(b => b.id === bookId);
  });

  const bookBase = qBookBase.data || null;
  const bookDetails = qBookDetails.data || null;
  const reviews = qReviews.data || [];

  const book = useMemo(() => {
    if (!bookBase) return null;
    return {...bookBase, ...bookDetails};
  }, [bookBase, bookDetails]);

  useEffect(() => {
    if (passedCanEdit !== undefined) return;
    if (!libraryId || !user || !isLive) return;

    const unregisterLib = DebugTelemetryEngine.getInstance().registerListener(
      'useBook:lib',
      `libraries/${libraryId}`,
    );
    const unsubscribe = onSnapshot(
      doc(db, 'libraries', libraryId),
      {includeMetadataChanges: true},
      libDoc => {
        const fromCache = libDoc.metadata.fromCache;
        const libData = libDoc.exists() ? libDoc.data() : null;
        const libBytes = libData ? calculatePayloadBytes(libData) : 0;

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Read library permissions: "libraries/${libraryId}" (${(libBytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}`,
            fromCache,
            exists: libDoc.exists(),
            bytes: libBytes,
            docCount: 1,
          },
        );

        if (libDoc.exists()) {
          const data = libDoc.data();
          setCanEditLocal(
            data.ownerId === user.uid ||
              (user.email &&
                data.access &&
                data.access[user.email.toLowerCase()] &&
                (data.access[user.email.toLowerCase()] === 'owner' ||
                  data.access[user.email.toLowerCase()] === 'editor')),
          );
        }
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}`,
        );
      },
    );

    return () => {
      unregisterLib();
      unsubscribe();
    };
  }, [libraryId, user, passedCanEdit, isLive]);

  useEffect(() => {
    if (!libraryId || !bookId) return;

    let isMounted = true;
    let hasNetworkUpdate = false;

    // Inactive/adjacent carousel slides: do NOT open live onSnapshot listeners.
    // Hydrate from TanStack Query or cache if missing, then exit cleanly.
    if (!isLive) {
      if (!queryClient.getQueryData(['bookBase', libraryId, bookId])) {
        const cachedBooks = queryClient.getQueryData<Book[]>([
          'books',
          libraryId,
        ]);
        const foundInLib = cachedBooks?.find(b => b.id === bookId);
        if (foundInLib) {
          queryClient.setQueryData(['bookBase', libraryId, bookId], foundInLib);
          setIsLoading(false);
        } else {
          const bookRef = doc(db, 'libraries', libraryId, 'books', bookId);
          getDocFromCache(bookRef)
            .then(cachedSnap => {
              if (isMounted && cachedSnap.exists()) {
                const bookData = mapDocToBook(cachedSnap);
                queryClient.setQueryData(
                  ['bookBase', libraryId, bookId],
                  bookData,
                );
                setIsLoading(false);
              }
            })
            .catch(() => {});
        }
      }
      return () => {
        isMounted = false;
      };
    }

    if (!queryClient.getQueryData(['bookBase', libraryId, bookId])) {
      const cachedBooks = queryClient.getQueryData<Book[]>([
        'books',
        libraryId,
      ]);
      if (!cachedBooks?.some(b => b.id === bookId)) {
        setIsLoading(true);
        const bookRef = doc(db, 'libraries', libraryId, 'books', bookId);
        getDocFromCache(bookRef)
          .then(cachedSnap => {
            if (isMounted && !hasNetworkUpdate && cachedSnap.exists()) {
              const bookData = mapDocToBook(cachedSnap);
              queryClient.setQueryData(
                ['bookBase', libraryId, bookId],
                bookData,
              );
              setIsLoading(false);
            }
          })
          .catch(() => {});
      }
    }

    const unregisterBook = DebugTelemetryEngine.getInstance().registerListener(
      'useBook:book',
      `libraries/${libraryId}/books/${bookId}`,
    );
    const unsubscribeBook = onSnapshot(
      doc(db, 'libraries', libraryId, 'books', bookId),
      {includeMetadataChanges: true},
      docSnap => {
        if (!isMounted) return;
        const parseStartTime = performance.now();
        const fromCache = docSnap.metadata.fromCache;
        if (!fromCache) {
          hasNetworkUpdate = true;
        }

        if (docSnap.exists()) {
          const data = docSnap.data();
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

          const parseDurationMs = Math.round(
            performance.now() - parseStartTime,
          );
          const payloadBytes = calculatePayloadBytes(bookData);

          DebugTelemetryEngine.getInstance().addLog(
            'db_read',
            `Read single book: "${bookData.title}" (${(payloadBytes / 1024).toFixed(1)} KB, ${parseDurationMs}ms)`,
            {
              path: `libraries/${libraryId}/books/${bookId}`,
              fromCache,
              exists: true,
              bytes: payloadBytes,
              docCount: 1,
              parseDurationMs,
            },
          );

          queryClient.setQueryData(['bookBase', libraryId, bookId], bookData);
        } else {
          queryClient.setQueryData(['bookBase', libraryId, bookId], null);
        }
        setIsLoading(false);
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/books/${bookId}`,
        );
        setIsLoading(false);
      },
    );

    const unregisterDetails =
      DebugTelemetryEngine.getInstance().registerListener(
        'useBook:bookDetails',
        `libraries/${libraryId}/bookDetails/${bookId}`,
      );
    const unsubscribeDetails = onSnapshot(
      doc(db, 'libraries', libraryId, 'bookDetails', bookId),
      {includeMetadataChanges: true},
      docSnap => {
        const fromCache = docSnap.metadata.fromCache;
        const detailsData = docSnap.exists() ? docSnap.data() : null;
        const detailsBytes = detailsData
          ? calculatePayloadBytes(detailsData)
          : 0;

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Read book details: "libraries/${libraryId}/bookDetails/${bookId}" (${(detailsBytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}/bookDetails/${bookId}`,
            fromCache,
            exists: docSnap.exists(),
            bytes: detailsBytes,
            docCount: 1,
          },
        );

        if (docSnap.exists()) {
          queryClient.setQueryData(
            ['bookDetails', libraryId, bookId],
            docSnap.data() as BookDetailsPayload,
          );
        } else {
          queryClient.setQueryData(['bookDetails', libraryId, bookId], null);
        }
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/bookDetails/${bookId}`,
        );
      },
    );

    const reviewsRef = collection(
      db,
      'libraries',
      libraryId,
      'books',
      bookId,
      'reviews',
    );
    const q = query(reviewsRef, orderBy('createdAt', 'desc'));
    const unregisterReviews =
      DebugTelemetryEngine.getInstance().registerListener(
        'useBook:reviews',
        `libraries/${libraryId}/books/${bookId}/reviews`,
      );
    const unsubscribeReviews = onSnapshot(
      q,
      {includeMetadataChanges: true},
      snapshot => {
        const fromCache = snapshot.metadata.fromCache;
        const revs: Review[] = [];
        snapshot.forEach(doc => {
          revs.push({id: doc.id, ...doc.data()} as Review);
        });
        const revBytes = calculatePayloadBytes(revs);

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Read book reviews (${snapshot.size} reviews, ${(revBytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}/books/${bookId}/reviews`,
            fromCache,
            size: snapshot.size,
            bytes: revBytes,
            docCount: snapshot.size,
          },
        );

        queryClient.setQueryData(['bookReviews', libraryId, bookId], revs);
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/books/${bookId}/reviews`,
        );
      },
    );

    return () => {
      isMounted = false;
      unregisterBook();
      unsubscribeBook();
      unregisterDetails();
      unsubscribeDetails();
      unregisterReviews();
      unsubscribeReviews();
    };
  }, [libraryId, bookId, queryClient, isLive]);

  const deleteBookMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId || !bookId) return;

      try {
        await deleteBookAtomic(libraryId, bookId);
      } catch (e) {
        handleFirestoreError(
          e,
          OperationType.DELETE,
          `libraries/${libraryId}/books/${bookId}`,
        );
        throw e;
      }
    },
    onMutate: () => {
      // Optimistic delete: remove it from current hook
      queryClient.setQueryData(['bookBase', libraryId, bookId], null);

      // Attempt to delete it from the main library view globally
      const currentBooks = queryClient.getQueryData<Book[]>([
        'books',
        libraryId,
      ]);
      if (currentBooks) {
        queryClient.setQueryData(
          ['books', libraryId],
          currentBooks.filter(b => b.id !== bookId),
        );
      }
    },
  });

  const updateReadingStatusMutation = useMutation({
    mutationFn: async (
      status: 'unset' | 'reading' | 'finished' | 'abandoned',
    ) => {
      if (!libraryId || !bookId || !user || !book) return;

      try {
        const updatePayload = {
          [`userStatuses.${user.uid}`]: status,
          addedBy: book.addedBy || user.uid,
          addedAt: book.addedAt || serverTimestamp(),
        };
        await instrumentMutation(
          'update',
          `libraries/${libraryId}/books/${bookId}`,
          updatePayload,
          () =>
            updateDoc(
              doc(db, 'libraries', libraryId, 'books', bookId),
              updatePayload,
            ),
        );
      } catch (e) {
        handleFirestoreError(
          e,
          OperationType.UPDATE,
          `libraries/${libraryId}/books/${bookId}`,
        );
        throw e;
      }
    },
    onMutate: async status => {
      if (!user) return;
      const prevBook = queryClient.getQueryData([
        'bookBase',
        libraryId,
        bookId,
      ]);
      queryClient.setQueryData(
        ['bookBase', libraryId, bookId],
        (old: Book | null) => ({
          ...old,
          userStatuses: {
            ...(old?.userStatuses || {}),
            [user.uid]: status,
          },
        }),
      );
      return {prevBook};
    },
    onError: (err, newStatus, context) => {
      const ctx = context as {prevBook?: Book | null};
      if (ctx?.prevBook) {
        queryClient.setQueryData(['bookBase', libraryId, bookId], ctx.prevBook);
      }
    },
  });

  const addReviewMutation = useMutation({
    mutationFn: async ({rating, text}: {rating: number; text: string}) => {
      if (!libraryId || !bookId || !user)
        throw new Error('Missing review context');
      try {
        const revPayload = {
          userId: user.uid,
          userName: user.displayName || user.email || 'Unknown User',
          rating,
          text,
          createdAt: serverTimestamp(),
        };
        await instrumentMutation(
          'create',
          `libraries/${libraryId}/books/${bookId}/reviews`,
          revPayload,
          () =>
            addDoc(
              collection(
                db,
                'libraries',
                libraryId,
                'books',
                bookId,
                'reviews',
              ),
              revPayload,
            ),
        );
      } catch (e) {
        handleFirestoreError(
          e,
          OperationType.CREATE,
          `libraries/${libraryId}/books/${bookId}/reviews`,
        );
        throw e;
      }
    },
    onMutate: async newReview => {
      if (!user) return;
      const tempId = `temp-${Date.now()}`;
      const rev = {
        id: tempId,
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown User',
        rating: newReview.rating,
        text: newReview.text,
        createdAt: new Date() as unknown as FirestoreDate,
      };

      const prevReviews = queryClient.getQueryData([
        'bookReviews',
        libraryId,
        bookId,
      ]);
      queryClient.setQueryData(
        ['bookReviews', libraryId, bookId],
        (old: Review[] | undefined) => [rev, ...(old || [])],
      );
      return {prevReviews};
    },
    onError: (err, newReview, context) => {
      const ctx = context as {prevReviews?: Review[]};
      if (ctx?.prevReviews) {
        queryClient.setQueryData(
          ['bookReviews', libraryId, bookId],
          ctx.prevReviews,
        );
      }
    },
  });

  const updateBookMutation = useMutation({
    mutationFn: async (cleanForm: Partial<Book & BookDetailsPayload>) => {
      if (!libraryId || !bookId || !book) return;
      try {
        const cargo = {...cleanForm};

        if (cargo.coverUrl && cargo.coverUrl.startsWith('data:')) {
          const storagePath = `libraries/${libraryId}/books/${bookId}/cover.png`;
          cargo.coverUrl = await uploadBase64Image(cargo.coverUrl, storagePath);
        }

        if (cargo.coverUrlRaw && cargo.coverUrlRaw.startsWith('data:')) {
          const storagePath = `libraries/${libraryId}/books/${bookId}/cover_raw.png`;
          cargo.coverUrlRaw = await uploadBase64Image(
            cargo.coverUrlRaw,
            storagePath,
          );
        }

        // Separate heavy fields from core book update
        const heavyUpdate: Record<string, unknown> = {};
        if (cargo.synopsis !== undefined) heavyUpdate.synopsis = cargo.synopsis;
        if (cargo.authorBio !== undefined)
          heavyUpdate.authorBio = cargo.authorBio;
        if (cargo.embedding !== undefined)
          heavyUpdate.embedding = cargo.embedding;
        if (cargo.clusterCoordinates !== undefined)
          heavyUpdate.clusterCoordinates = cargo.clusterCoordinates;

        delete cargo.synopsis;
        delete cargo.authorBio;
        delete cargo.embedding;
        delete cargo.clusterCoordinates;

        if (Object.keys(heavyUpdate).length > 0) {
          heavyUpdate.updatedAt = new Date().toISOString();
          await instrumentMutation(
            'update',
            `libraries/${libraryId}/bookDetails/${bookId}`,
            heavyUpdate,
            () =>
              setDoc(
                doc(db, 'libraries', libraryId, 'bookDetails', bookId),
                heavyUpdate,
                {merge: true},
              ),
          );

          cargo.bookDetailsMetadata = {
            ...(book.bookDetailsMetadata || {}),
            ...(heavyUpdate.synopsis !== undefined
              ? {hasSynopsis: Boolean(heavyUpdate.synopsis)}
              : {}),
            ...(heavyUpdate.authorBio !== undefined
              ? {hasAuthorBio: Boolean(heavyUpdate.authorBio)}
              : {}),
            ...(heavyUpdate.embedding !== undefined
              ? {
                  hasEmbedding: Boolean(
                    (heavyUpdate.embedding as number[])?.length,
                  ),
                }
              : {}),
            ...(heavyUpdate.clusterCoordinates !== undefined
              ? {hasClusterCoordinates: Boolean(heavyUpdate.clusterCoordinates)}
              : {}),
          };
        }

        await instrumentMutation(
          'update',
          `libraries/${libraryId}/books/${bookId}`,
          cargo,
          () =>
            updateDoc(doc(db, 'libraries', libraryId, 'books', bookId), cargo),
        );
      } catch (e) {
        handleFirestoreError(
          e,
          OperationType.UPDATE,
          `libraries/${libraryId}/books/${bookId}`,
        );
        throw e;
      }
    },
    onMutate: async partialBook => {
      const prevBase = queryClient.getQueryData([
        'bookBase',
        libraryId,
        bookId,
      ]);
      const prevDetails = queryClient.getQueryData([
        'bookDetails',
        libraryId,
        bookId,
      ]);

      queryClient.setQueryData(
        ['bookBase', libraryId, bookId],
        (old: Book | null) => (old ? {...old, ...partialBook} : old),
      );
      queryClient.setQueryData(
        ['bookDetails', libraryId, bookId],
        (old: BookDetailsPayload | null) =>
          old ? {...old, ...partialBook} : old,
      );
      return {prevBase, prevDetails};
    },
    onError: (err, newBook, context: unknown) => {
      const ctx = context as {
        prevBase?: Book | null;
        prevDetails?: BookDetailsPayload | null;
      };
      if (ctx?.prevBase)
        queryClient.setQueryData(['bookBase', libraryId, bookId], ctx.prevBase);
      if (ctx?.prevDetails)
        queryClient.setQueryData(
          ['bookDetails', libraryId, bookId],
          ctx.prevDetails,
        );
    },
  });

  return {
    book,
    bookBase,
    bookDetails,
    reviews,
    isLoading,
    canEdit,
    deleteBook: () => deleteBookMutation.mutateAsync(),
    updateReadingStatus: (
      status: 'unset' | 'reading' | 'finished' | 'abandoned',
    ) => updateReadingStatusMutation.mutateAsync(status),
    addReview: (rating: number, text: string) =>
      addReviewMutation.mutateAsync({rating, text}),
    updateBook: (cleanForm: Partial<Book & BookDetailsPayload>) =>
      updateBookMutation.mutateAsync(cleanForm),
    updateBookOptimistically: (
      partialBook: Partial<Book & BookDetailsPayload>,
    ) => {
      // Kept for backward compatibility, but not technically needed if we always use mutation
      queryClient.setQueryData(
        ['bookBase', libraryId, bookId],
        (old: Book | null) => (old ? {...old, ...partialBook} : old),
      );
      queryClient.setQueryData(
        ['bookDetails', libraryId, bookId],
        (old: BookDetailsPayload | null) =>
          old ? {...old, ...partialBook} : old,
      );
    },
    setReviewsOptimistically: (newReviews: Review[]) => {
      queryClient.setQueryData(['bookReviews', libraryId, bookId], newReviews);
    },
  };
}
