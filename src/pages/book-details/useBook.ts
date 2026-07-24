import {useState, useEffect, useMemo} from 'react';
import {
  doc,
  collection,
  query,
  onSnapshot,
  orderBy,
  writeBatch,
  increment,
  getDocs,
  updateDoc,
  serverTimestamp,
  addDoc,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {uploadBase64Image} from '../../services/db/storage';
import {Book, BookDetailsPayload, FirestoreDate} from '../../types';
export type {Book, BookDetailsPayload, FirestoreDate};
import {useAuth} from '../../stores/authStore';
import {parseGenres} from '../../lib/utils';
import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query';

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
) {
  const {user} = useAuth();
  const queryClient = useQueryClient();
  const [canEditLocal, setCanEditLocal] = useState(false);

  const canEdit = passedCanEdit !== undefined ? passedCanEdit : canEditLocal;

  const qBookBase = useQuery({
    queryKey: ['bookBase', libraryId, bookId],
    enabled: !!libraryId && !!bookId,
    queryFn: () =>
      (queryClient.getQueryData([
        'bookBase',
        libraryId,
        bookId,
      ]) as Book | null) || null,
    staleTime: Infinity,
  });

  const qBookDetails = useQuery({
    queryKey: ['bookDetails', libraryId, bookId],
    enabled: !!libraryId && !!bookId,
    queryFn: () =>
      (queryClient.getQueryData([
        'bookDetails',
        libraryId,
        bookId,
      ]) as BookDetailsPayload | null) || null,
    staleTime: Infinity,
  });

  const qReviews = useQuery({
    queryKey: ['bookReviews', libraryId, bookId],
    enabled: !!libraryId && !!bookId,
    queryFn: () =>
      (queryClient.getQueryData([
        'bookReviews',
        libraryId,
        bookId,
      ]) as Review[]) || [],
    staleTime: Infinity,
  });

  const [isLoading, setIsLoading] = useState(true);

  const bookBase = qBookBase.data || null;
  const bookDetails = qBookDetails.data || null;
  const reviews = qReviews.data || [];

  const book = useMemo(() => {
    if (!bookBase) return null;
    return {...bookBase, ...bookDetails};
  }, [bookBase, bookDetails]);

  useEffect(() => {
    if (passedCanEdit !== undefined) return;
    if (!libraryId || !user) return;

    const unsubscribe = onSnapshot(
      doc(db, 'libraries', libraryId),
      libDoc => {
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

    return () => unsubscribe();
  }, [libraryId, user, passedCanEdit]);

  useEffect(() => {
    if (!libraryId || !bookId) return;

    setIsLoading(true);

    const unsubscribeBook = onSnapshot(
      doc(db, 'libraries', libraryId, 'books', bookId),
      docSnap => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          const rawGenres =
            data.genres ||
            data.genre ||
            data.categories ||
            data.category ||
            data.tags ||
            data.subjects;
          const parsedGenres = parseGenres(rawGenres);

          const bookData = {
            id: docSnap.id,
            ...data,
            genres: parsedGenres,
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

    const unsubscribeDetails = onSnapshot(
      doc(db, 'libraries', libraryId, 'bookDetails', bookId),
      docSnap => {
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
    const unsubscribeReviews = onSnapshot(
      q,
      snapshot => {
        const revs: Review[] = [];
        snapshot.forEach(doc => {
          revs.push({id: doc.id, ...doc.data()} as Review);
        });
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
      unsubscribeBook();
      unsubscribeDetails();
      unsubscribeReviews();
    };
  }, [libraryId, bookId, queryClient]);

  const deleteBookMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId || !bookId) return;

      const batch = writeBatch(db);
      batch.delete(doc(db, 'libraries', libraryId, 'books', bookId));
      batch.delete(doc(db, 'libraries', libraryId, 'bookDetails', bookId));
      batch.update(doc(db, 'libraries', libraryId), {
        bookCount: increment(-1),
        updatedAt: serverTimestamp(),
      });

      // Cleanup reviews (small scale deletion)
      try {
        const reviewsRef = collection(
          db,
          'libraries',
          libraryId,
          'books',
          bookId,
          'reviews',
        );
        const reviewsSnap = await getDocs(reviewsRef);
        reviewsSnap.forEach(revDoc => {
          batch.delete(revDoc.ref);
        });
      } catch (e) {
        handleFirestoreError(
          e,
          OperationType.GET,
          `libraries/${libraryId}/books/${bookId}/reviews`,
        );
      }

      try {
        await batch.commit();
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
        await updateDoc(doc(db, 'libraries', libraryId, 'books', bookId), {
          [`userStatuses.${user.uid}`]: status,
          addedBy: book.addedBy || user.uid,
          addedAt: book.addedAt || serverTimestamp(),
        });
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
        await addDoc(
          collection(db, 'libraries', libraryId, 'books', bookId, 'reviews'),
          {
            userId: user.uid,
            userName: user.displayName || user.email || 'Unknown User',
            rating,
            text,
            createdAt: serverTimestamp(),
          },
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

        await updateDoc(
          doc(db, 'libraries', libraryId, 'books', bookId),
          cargo,
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
