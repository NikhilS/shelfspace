import {useState, useEffect, useMemo, useCallback} from 'react';
import {uploadBase64Image} from '../../lib/storage';
import {Book, BookDetailsPayload, FirestoreDate} from '../../types';
export type {Book, BookDetailsPayload, FirestoreDate};
import {useAuth} from '../../stores/authStore';
import {useMutation} from '@tanstack/react-query';
import {deleteBookAtomic} from '../../lib/bookActions';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {instrumentMutation} from '../../lib/telemetry';
import {
  applyOptimisticBookEditPatch,
  applyOptimisticReadingStatusPatch,
  buildBookSnapshotHint,
  commitBookDeleteDelta,
  commitBookReviewDelta,
  commitBookUpsertDelta,
  commitReadingStatusDelta,
  removeBookFromReadingCaches,
} from '../../lib/readingStatusCache';
import {useCoverTransitionStore} from '../../stores/coverTransitionStore';
import {
  selectBookWithOverlay,
  useEntityCacheStore,
} from '../../stores/entityCacheStore';

export interface Review {
  id: string;
  userId: string;
  userName: string;
  rating: number;
  text: string;
  createdAt: FirestoreDate | string;
}

type FullBookRecord = Omit<Book, keyof BookDetailsPayload> &
  Omit<BookDetailsPayload, 'updatedAt'> & {updatedAt?: FirestoreDate};

export type OptimisticBookPatch = Partial<FullBookRecord>;

function extractBookList(cachedData: unknown): FullBookRecord[] | undefined {
  if (Array.isArray(cachedData)) {
    return cachedData as FullBookRecord[];
  }
  if (cachedData && typeof cachedData === 'object') {
    if (Array.isArray((cachedData as {books?: unknown}).books)) {
      return (cachedData as {books: FullBookRecord[]}).books;
    }
    if (Array.isArray((cachedData as {items?: unknown}).items)) {
      return (cachedData as {items: FullBookRecord[]}).items;
    }
  }
  return undefined;
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
    if (passedCanEdit !== undefined) {
      return;
    }
    if (!libraryQuery.data || !user) {
      return;
    }

    const data = libraryQuery.data as Record<string, unknown>;
    const isOwner =
      data.callerRole === 'owner' ||
      data.callerRole === 'admin' ||
      data.ownerId === user.uid;
    const isEditor = data.callerRole === 'editor' || data.canEdit === true;
    setCanEditLocal(isOwner || isEditor);
  }, [libraryQuery.data, user, passedCanEdit]);

  // 2. Book query via tRPC (Single source of truth for book & heavy details)
  const resolveCachedBook = useCallback((): FullBookRecord | undefined => {
    if (!libraryId || !bookId) {
      return undefined;
    }
    const cachedDetail = utils.book?.get?.getData?.({
      libraryId,
      bookId,
    }) as FullBookRecord | undefined;
    const fromEntityStore = selectBookWithOverlay(
      useEntityCacheStore.getState(),
      libraryId,
      bookId,
    ) as FullBookRecord | undefined;
    if (cachedDetail) {
      if (!fromEntityStore) {
        return cachedDetail;
      }
      return {
        ...cachedDetail,
        ...fromEntityStore,
        synopsis: fromEntityStore.synopsis ?? cachedDetail.synopsis,
        authorBio: fromEntityStore.authorBio ?? cachedDetail.authorBio,
        embedding: fromEntityStore.embedding ?? cachedDetail.embedding,
        clusterCoordinates:
          fromEntityStore.clusterCoordinates ?? cachedDetail.clusterCoordinates,
      };
    }
    if (fromEntityStore) {
      return fromEntityStore;
    }
    const cachedData = utils.book?.list?.getData?.({libraryId});
    const cachedBooks = extractBookList(cachedData);
    const fromLibraryList = cachedBooks?.find(b => b.id === bookId);
    if (fromLibraryList) {
      return fromLibraryList;
    }
    const readingTrackerUtils = (
      utils as {
        readingTracker?: {
          getShelf?: {getData?: (input?: {shelf?: string}) => unknown};
          getUnreadLibraryBooks?: {getData?: () => unknown};
        };
      }
    ).readingTracker;
    const shelfData =
      readingTrackerUtils?.getShelf?.getData?.({shelf: 'all'}) ??
      readingTrackerUtils?.getShelf?.getData?.();
    const shelfBooks = extractBookList(shelfData);
    const fromShelf = shelfBooks?.find(b => b.id === bookId);
    if (fromShelf) {
      return fromShelf;
    }

    const unreadData = readingTrackerUtils?.getUnreadLibraryBooks?.getData?.();
    const unreadBooks = extractBookList(unreadData);
    const fromUnread = unreadBooks?.find(b => b.id === bookId);
    if (fromUnread) {
      return {
        ...fromUnread,
        addedAt: fromUnread.addedAt ?? '',
      };
    }

    const activeTransition =
      useCoverTransitionStore.getState().activeTransition;
    if (
      activeTransition &&
      activeTransition.libraryId === libraryId &&
      activeTransition.bookId === bookId
    ) {
      const preview = activeTransition.coverPreview;
      return {
        id: bookId,
        libraryId,
        title: preview.title,
        author: preview.author,
        coverUrl: preview.coverUrl,
        publishedDate: preview.publishedDate,
        primaryGenre: preview.primaryGenre,
        subgenres: preview.subgenres,
        series: preview.series,
        synopsis: preview.synopsis,
        readingStatus: preview.readingStatus as Book['readingStatus'],
        ownershipStatus: preview.ownershipStatus,
        format: preview.format,
        isbn: preview.isbn,
        addedAt: '',
      };
    }

    return undefined;
  }, [libraryId, bookId, utils]);

  const hasFullCachedDetail = Boolean(
    libraryId &&
    bookId &&
    utils.book?.get?.getData?.({
      libraryId,
      bookId,
    }),
  );

  const trpcBookQuery = trpc.book.get.useQuery(
    {libraryId: libraryId || '', bookId: bookId || ''},
    {
      enabled: Boolean(libraryId && bookId && isLive),
      initialData: () =>
        resolveCachedBook() as unknown as ReturnType<
          typeof utils.book.get.getData
        >,
      initialDataUpdatedAt: hasFullCachedDetail ? undefined : 0,
      staleTime: 1000 * 60 * 5,
    },
  );

  // 3. Reviews query via tRPC (only active on the settled center slide)
  const trpcReviewsQuery = trpc.book.listReviews.useQuery(
    {libraryId: libraryId || '', bookId: bookId || ''},
    {
      enabled: Boolean(libraryId && bookId && isLive),
      staleTime: 1000 * 60 * 2,
    },
  );

  const rawBook =
    (trpcBookQuery.data as FullBookRecord | null | undefined) ??
    resolveCachedBook() ??
    null;

  const bookBase = useMemo<Book | null>(() => {
    if (!rawBook) {
      return null;
    }
    const base = {...rawBook};
    delete base.synopsis;
    delete base.authorBio;
    delete base.embedding;
    delete base.clusterCoordinates;
    return base as Book;
  }, [rawBook]);

  const bookDetails = useMemo<BookDetailsPayload | null>(() => {
    if (!rawBook) {
      return null;
    }
    return {
      synopsis: rawBook.synopsis,
      authorBio: rawBook.authorBio,
      embedding: rawBook.embedding,
      clusterCoordinates: rawBook.clusterCoordinates,
    };
  }, [rawBook]);

  const book = useMemo<Book | null>(() => {
    if (!rawBook) {
      return null;
    }
    return {
      ...rawBook,
      synopsis: rawBook.synopsis ?? undefined,
      authorBio: rawBook.authorBio ?? undefined,
      embedding: rawBook.embedding ?? undefined,
      clusterCoordinates: rawBook.clusterCoordinates ?? undefined,
    };
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
    (partialBook: OptimisticBookPatch): (() => void) => {
      if (!libraryId || !bookId) {
        return () => {};
      }
      return applyOptimisticBookEditPatch(utils, {
        libraryId,
        bookId,
        patch: partialBook as Partial<Book>,
        bookHint: book ?? undefined,
      });
    },
    [libraryId, bookId, utils, book],
  );

  // Mutations
  const deleteBookMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId || !bookId) {
        return;
      }
      await deleteBookAtomic(libraryId, bookId);
    },
    onMutate: async () => {
      if (!libraryId || !bookId) {
        return {};
      }
      const rollback = removeBookFromReadingCaches(utils, {
        libraryId,
        bookId,
      });
      return {rollback};
    },
    onError: (_err, _vars, context) => {
      context?.rollback?.();
    },
    onSuccess: () => {
      if (libraryId && bookId) {
        commitBookDeleteDelta(utils, {
          libraryId,
          bookId,
          bookCountDelta: -1,
        });
      }
    },
  });

  const updateReadingStatusMutation = useMutation({
    mutationFn: async (
      status: 'unset' | 'want_to_read' | 'reading' | 'finished' | 'abandoned',
    ) => {
      if (!libraryId || !bookId || !user) {
        return undefined;
      }
      const snapshotHint = buildBookSnapshotHint(book ?? undefined, {
        libraryId,
        bookId,
      });
      return instrumentMutation(
        'update',
        `users/${user.uid}/readingStates`,
        {libraryId, bookId, status},
        () =>
          trpcVanilla.book.updateStatus.mutate({
            libraryId,
            bookId,
            status,
            ...(snapshotHint ? {bookSnapshot: snapshotHint} : {}),
          }),
      );
    },
    onMutate: async newStatus => {
      if (!user || !libraryId || !bookId) {
        return {};
      }
      const rollback = applyOptimisticReadingStatusPatch(utils, {
        libraryId,
        bookId,
        status: newStatus,
        bookHint: book ?? undefined,
      });

      return {rollback};
    },
    onError: (_err, _newStatus, context) => {
      context?.rollback?.();
    },
    onSuccess: (result, requestedStatus) => {
      if (!libraryId || !bookId) {
        return;
      }
      commitReadingStatusDelta(utils, {
        libraryId,
        bookId,
        status: result?.status ?? requestedStatus,
        reviewedAt: result?.reviewedAt,
        rating: result?.rating,
        startedAt: result?.startedAt,
        finishedAt: result?.finishedAt,
        bookSnapshot: result?.bookSnapshot,
        bookHint: book ?? undefined,
      });
    },
  });

  const addReviewMutation = useMutation({
    mutationFn: async ({rating, text}: {rating: number; text: string}) => {
      if (!libraryId || !bookId || !user) {
        return undefined;
      }
      return instrumentMutation(
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
      if (!user || !libraryId || !bookId) {
        return {};
      }
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
          {
            id: rev.id,
            userId: rev.userId,
            userName: rev.userName,
            rating: rev.rating,
            text: rev.text,
            createdAt:
              typeof rev.createdAt === 'string'
                ? rev.createdAt
                : new Date().toISOString(),
          },
          ...(old?.reviews || []),
        ],
      }));
      return {prevReviews};
    },
    onError: (_err, _newReview, context) => {
      if (!libraryId || !bookId || !context?.prevReviews) {
        return;
      }
      utils.book?.listReviews?.setData?.(
        {libraryId, bookId},
        context.prevReviews,
      );
    },
    onSuccess: (result, submitted) => {
      if (!libraryId || !bookId || !user) {
        return;
      }
      commitBookReviewDelta(utils, {
        libraryId,
        bookId,
        review: {
          id: result?.id || user.uid,
          userId: user.uid,
          userName:
            result?.userName ||
            user.displayName ||
            user.email ||
            'Unknown User',
          rating: result?.rating ?? submitted.rating,
          text: result?.reviewText ?? submitted.text,
          createdAt: result?.reviewedAt || new Date().toISOString(),
        },
      });
    },
  });

  const updateBookMutation = useMutation({
    mutationFn: async (cleanForm: Partial<FullBookRecord>) => {
      if (!libraryId || !bookId || !book) {
        return undefined;
      }
      const cargo = {
        ...cleanForm,
        synopsis: cleanForm.synopsis ?? undefined,
        authorBio: cleanForm.authorBio ?? undefined,
        embedding: cleanForm.embedding ?? undefined,
        clusterCoordinates: cleanForm.clusterCoordinates ?? undefined,
        updatedAt:
          typeof cleanForm.updatedAt === 'string'
            ? cleanForm.updatedAt
            : undefined,
      };

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

      const result = await instrumentMutation(
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
      return {result, cargo};
    },
    onMutate: async partialBook => {
      if (!libraryId || !bookId) {
        return {};
      }
      const rollback = applyOptimisticBookPatch(partialBook);
      return {rollback};
    },
    onError: (_err, _newBook, context) => {
      context?.rollback?.();
    },
    onSuccess: payload => {
      if (!libraryId || !bookId || !book || !payload) {
        return;
      }
      const mergedBook: Book = {
        ...book,
        ...payload.cargo,
        id: bookId,
        libraryId,
        title: payload.cargo.title ?? book.title,
        author: payload.cargo.author ?? book.author,
        updatedAt: payload.result?.updatedAt ?? new Date().toISOString(),
      };
      commitBookUpsertDelta(utils, {
        libraryId,
        book: mergedBook,
        bookCountDelta: 0,
      });
    },
  });

  return {
    book,
    bookBase,
    bookDetails,
    reviews,
    isLoading,
    canEdit,
    deleteBook: async (): Promise<void> => {
      await deleteBookMutation.mutateAsync();
    },
    updateReadingStatus: async (
      status: 'unset' | 'want_to_read' | 'reading' | 'finished' | 'abandoned',
    ): Promise<void> => {
      await updateReadingStatusMutation.mutateAsync(status);
    },
    addReview: async (rating: number, text: string): Promise<void> => {
      await addReviewMutation.mutateAsync({rating, text});
    },
    updateBook: async (cleanForm: Partial<FullBookRecord>): Promise<void> => {
      await updateBookMutation.mutateAsync(cleanForm);
    },
    updateBookOptimistically: (partialBook: Partial<FullBookRecord>) => {
      applyOptimisticBookPatch(partialBook);
    },
    setReviewsOptimistically: (newReviews: Review[]) => {
      if (!libraryId || !bookId) {
        return;
      }
      utils.book?.listReviews?.setData?.(
        {libraryId, bookId},
        {
          reviews: newReviews.map(r => ({
            id: r.id,
            userId: r.userId,
            userName: r.userName,
            rating: r.rating,
            text: r.text,
            createdAt:
              typeof r.createdAt === 'string'
                ? r.createdAt
                : new Date().toISOString(),
          })),
        },
      );
    },
  };
}
