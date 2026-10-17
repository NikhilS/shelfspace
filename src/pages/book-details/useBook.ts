import {useState, useEffect, useMemo, useCallback} from 'react';
import {uploadBase64Image} from '../../services/db/storage';
import {Book, BookDetailsPayload, FirestoreDate} from '../../types';
export type {Book, BookDetailsPayload, FirestoreDate};
import {useAuth} from '../../stores/authStore';
import {useMutation} from '@tanstack/react-query';
import {deleteBookAtomic} from '../../services/db/books';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {instrumentMutation} from '../../lib/telemetry';

export interface Review {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt: FirestoreDate | string;
}

type FullBookRecord = Book & BookDetailsPayload;

function extractBookList(cachedData: unknown): Book[] | undefined {
  if (Array.isArray(cachedData)) {
    return cachedData as Book[];
  }
  if (
    cachedData &&
    typeof cachedData === 'object' &&
    Array.isArray((cachedData as {books?: unknown}).books)
  ) {
    return (cachedData as {books: Book[]}).books;
  }
  return undefined;
}

function patchBookInListCache(
  oldData: unknown,
  bookId: string,
  updater: (book: Book) => Book | null,
): unknown {
  if (!oldData) return oldData;
  if (Array.isArray(oldData)) {
    return (oldData as Book[])
      .map(b => (b.id === bookId ? updater(b) : b))
      .filter((b): b is Book => b !== null);
  }
  if (
    typeof oldData === 'object' &&
    Array.isArray((oldData as {books?: unknown}).books)
  ) {
    const container = oldData as {books: Book[]; [k: string]: unknown};
    return {
      ...container,
      books: container.books
        .map(b => (b.id === bookId ? updater(b) : b))
        .filter((b): b is Book => b !== null),
    };
  }
  return oldData;
}

export function useBook(
  libraryId: string | undefined,
  bookId: string | undefined,
  passedCanEdit?: boolean,
  isLive: boolean = true,
) {
  const {user} = useAuth();
  const utils = trpc.useUtils();
  const [canEditLocal, setCanEditLocal] = useState(false);

  const canEdit = passedCanEdit !== undefined ? passedCanEdit : canEditLocal;

  // 1. Library query for permissions
  const libraryQuery = trpc.library.get.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: Boolean(
        passedCanEdit === undefined && libraryId && user && isLive,
      ),
      staleTime: 1000 * 60 * 5,
    },
  );

  useEffect(() => {
    if (passedCanEdit !== undefined) return;
    if (!libraryQuery.data || !user) return;

    const data = libraryQuery.data as Record<string, unknown>;
    const isOwner = data.callerRole === 'owner' || data.ownerId === user.uid;
    const isEditor = data.callerRole === 'editor' || data.canEdit === true;
    setCanEditLocal(isOwner || isEditor);
  }, [libraryQuery.data, user, passedCanEdit]);

  // 2. Book query via tRPC (Single source of truth for book & heavy details)
  const trpcBookQuery = trpc.book.get.useQuery(
    {libraryId: libraryId || '', bookId: bookId || ''},
    {
      enabled: Boolean(libraryId && bookId && isLive),
      initialData: () => {
        if (!libraryId || !bookId) return undefined;
        const cachedData = utils.book?.list?.getData?.({libraryId});
        const cachedBooks = extractBookList(cachedData);
        const match = cachedBooks?.find(b => b.id === bookId);
        return match as unknown as ReturnType<typeof utils.book.get.getData>;
      },
      staleTime: 1000 * 60 * 5,
    },
  );

  // 3. Reviews query via tRPC
  const trpcReviewsQuery = trpc.book.listReviews.useQuery(
    {libraryId: libraryId || '', bookId: bookId || ''},
    {
      enabled: Boolean(libraryId && bookId && isLive),
      staleTime: 1000 * 60 * 2,
    },
  );

  const rawBook = trpcBookQuery.data as FullBookRecord | null | undefined;

  const bookBase = useMemo<Book | null>(() => {
    if (!rawBook) return null;
    const base = {...rawBook};
    delete base.synopsis;
    delete base.authorBio;
    delete base.embedding;
    delete base.clusterCoordinates;
    delete base.description;
    return base as Book;
  }, [rawBook]);

  const bookDetails = useMemo<BookDetailsPayload | null>(() => {
    if (!rawBook) return null;
    return {
      synopsis: rawBook.synopsis,
      authorBio: rawBook.authorBio,
      embedding: rawBook.embedding,
      clusterCoordinates: rawBook.clusterCoordinates,
      description: rawBook.description,
    };
  }, [rawBook]);

  const book = useMemo<FullBookRecord | null>(() => {
    if (!rawBook) return null;
    return rawBook;
  }, [rawBook]);

  const reviews = useMemo<Review[]>(() => {
    const data = trpcReviewsQuery.data as
      {reviews?: Review[]} | Review[] | undefined;
    if (Array.isArray(data)) {
      return data;
    }
    if (data && Array.isArray(data.reviews)) {
      return data.reviews;
    }
    return [];
  }, [trpcReviewsQuery.data]);

  const isLoading = trpcBookQuery.isLoading && !book;

  const applyOptimisticBookPatch = useCallback(
    (partialBook: Partial<FullBookRecord>) => {
      if (!libraryId || !bookId) return;

      utils.book?.get?.setData?.({libraryId, bookId}, old => {
        if (!old) return old;
        return {...old, ...partialBook} as typeof old;
      });

      utils.book?.list?.setData?.(
        {libraryId},
        old =>
          patchBookInListCache(old, bookId, existing => ({
            ...existing,
            ...partialBook,
          })) as typeof old,
      );
    },
    [libraryId, bookId, utils.book],
  );

  // Mutations
  const deleteBookMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId || !bookId) return;
      await deleteBookAtomic(libraryId, bookId);
    },
    onMutate: async () => {
      if (!libraryId || !bookId) return {};
      const prevBook = utils.book?.get?.getData?.({libraryId, bookId});
      const prevList = utils.book?.list?.getData?.({libraryId});

      utils.book?.list?.setData?.(
        {libraryId},
        old => patchBookInListCache(old, bookId, () => null) as typeof old,
      );

      return {prevBook, prevList};
    },
    onError: (_err, _vars, context) => {
      if (!libraryId || !bookId || !context) return;
      if (context.prevBook !== undefined) {
        utils.book?.get?.setData?.({libraryId, bookId}, context.prevBook);
      }
      if (context.prevList !== undefined) {
        utils.book?.list?.setData?.({libraryId}, context.prevList);
      }
    },
    onSettled: () => {
      if (libraryId) {
        void utils.book?.list?.invalidate?.({libraryId});
        void utils.library?.get?.invalidate?.({libraryId});
        void utils.library?.list?.invalidate?.();
      }
    },
  });

  const updateReadingStatusMutation = useMutation({
    mutationFn: async (
      status: 'unset' | 'reading' | 'finished' | 'abandoned',
    ) => {
      if (!libraryId || !bookId || !user) return;
      const updates = {[`userStatuses.${user.uid}`]: status};
      await instrumentMutation(
        'update',
        `libraries/${libraryId}/books/${bookId}`,
        updates,
        () =>
          trpcVanilla.book.update.mutate({
            libraryId,
            bookId,
            updates,
          }),
      );
    },
    onMutate: async newStatus => {
      if (!user || !libraryId || !bookId) return {};
      const prevBook = utils.book?.get?.getData?.({libraryId, bookId});
      const prevList = utils.book?.list?.getData?.({libraryId});

      const nextUserStatuses = {
        ...((prevBook as FullBookRecord | undefined)?.userStatuses ||
          book?.userStatuses ||
          {}),
        [user.uid]: newStatus,
      };

      applyOptimisticBookPatch({userStatuses: nextUserStatuses});

      return {prevBook, prevList};
    },
    onError: (_err, _newStatus, context) => {
      if (!libraryId || !bookId || !context) return;
      if (context.prevBook !== undefined) {
        utils.book?.get?.setData?.({libraryId, bookId}, context.prevBook);
      }
      if (context.prevList !== undefined) {
        utils.book?.list?.setData?.({libraryId}, context.prevList);
      }
    },
    onSettled: () => {
      if (!libraryId || !bookId) return;
      void utils.book?.get?.invalidate?.({libraryId, bookId});
      void utils.book?.list?.invalidate?.({libraryId});
    },
  });

  const addReviewMutation = useMutation({
    mutationFn: async ({rating, text}: {rating: number; text: string}) => {
      if (!libraryId || !bookId || !user) return;
      await instrumentMutation(
        'create',
        `libraries/${libraryId}/books/${bookId}/reviews`,
        {rating, text},
        () =>
          trpcVanilla.book.addReview.mutate({
            libraryId,
            bookId,
            rating,
            text,
          }),
      );
    },
    onMutate: async newReview => {
      if (!user || !libraryId || !bookId) return {};
      const tempId = `temp-${Date.now()}`;
      const rev: Review = {
        id: tempId,
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown User',
        rating: newReview.rating,
        text: newReview.text,
        createdAt: new Date().toISOString(),
      };

      const prevReviews = utils.book?.listReviews?.getData?.({
        libraryId,
        bookId,
      });
      utils.book?.listReviews?.setData?.({libraryId, bookId}, old => ({
        reviews: [
          rev as unknown as NonNullable<typeof old>['reviews'][number],
          ...(old?.reviews || []),
        ],
      }));
      return {prevReviews};
    },
    onError: (_err, _newReview, context) => {
      if (!libraryId || !bookId || !context?.prevReviews) return;
      utils.book?.listReviews?.setData?.(
        {libraryId, bookId},
        context.prevReviews,
      );
    },
    onSettled: () => {
      if (!libraryId || !bookId) return;
      if (utils.book?.listReviews?.invalidate) {
        void utils.book.listReviews.invalidate({libraryId, bookId});
      } else {
        void trpcReviewsQuery.refetch?.();
      }
    },
  });

  const updateBookMutation = useMutation({
    mutationFn: async (cleanForm: Partial<FullBookRecord>) => {
      if (!libraryId || !bookId || !book) return;
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

      await instrumentMutation(
        'update',
        `libraries/${libraryId}/books/${bookId}`,
        cargo,
        () =>
          trpcVanilla.book.update.mutate({
            libraryId,
            bookId,
            updates: cargo,
          }),
      );
    },
    onMutate: async partialBook => {
      if (!libraryId || !bookId) return {};
      const prevBook = utils.book?.get?.getData?.({libraryId, bookId});
      const prevList = utils.book?.list?.getData?.({libraryId});

      applyOptimisticBookPatch(partialBook);

      return {prevBook, prevList};
    },
    onError: (_err, _newBook, context) => {
      if (!libraryId || !bookId || !context) return;
      if (context.prevBook !== undefined) {
        utils.book?.get?.setData?.({libraryId, bookId}, context.prevBook);
      }
      if (context.prevList !== undefined) {
        utils.book?.list?.setData?.({libraryId}, context.prevList);
      }
    },
    onSettled: () => {
      if (!libraryId || !bookId) return;
      void utils.book?.get?.invalidate?.({libraryId, bookId});
      void utils.book?.list?.invalidate?.({libraryId});
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
    updateBook: (cleanForm: Partial<FullBookRecord>) =>
      updateBookMutation.mutateAsync(cleanForm),
    updateBookOptimistically: (partialBook: Partial<FullBookRecord>) => {
      applyOptimisticBookPatch(partialBook);
    },
    setReviewsOptimistically: (newReviews: Review[]) => {
      if (!libraryId || !bookId) return;
      utils.book?.listReviews?.setData?.(
        {libraryId, bookId},
        {
          reviews: newReviews as unknown as [],
        },
      );
    },
  };
}
