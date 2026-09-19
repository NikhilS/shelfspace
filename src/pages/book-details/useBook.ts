import {useState, useEffect, useMemo} from 'react';
import {uploadBase64Image} from '../../services/db/storage';
import {Book, BookDetailsPayload, FirestoreDate} from '../../types';
export type {Book, BookDetailsPayload, FirestoreDate};
import {useAuth} from '../../stores/authStore';
import {useQuery, useMutation, useQueryClient} from '@tanstack/react-query';
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

  // 2. Book query via tRPC
  const trpcBookQuery = trpc.book.get.useQuery(
    {libraryId: libraryId || '', bookId: bookId || ''},
    {
      enabled: Boolean(libraryId && bookId && isLive),
      initialData: () => {
        const cached = queryClient.getQueryData<Book>([
          'bookBase',
          libraryId,
          bookId,
        ]);
        if (cached) return cached;
        const cachedBooks = libraryId
          ? queryClient.getQueryData<Book[]>(['books', libraryId])
          : undefined;
        return cachedBooks?.find(b => b.id === bookId);
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

  const rawBook = trpcBookQuery.data;

  // Sync to query cache
  useEffect(() => {
    if (!libraryId || !bookId || !rawBook) return;
    const b = rawBook as Book;
    queryClient.setQueryData(['bookBase', libraryId, bookId], b);
    queryClient.setQueryData(['bookDetails', libraryId, bookId], {
      synopsis: (rawBook as {synopsis?: string}).synopsis,
      authorBio: (rawBook as {authorBio?: string}).authorBio,
      embedding: (rawBook as {embedding?: number[]}).embedding,
      clusterCoordinates: (
        rawBook as {clusterCoordinates?: {x: number; y: number}}
      ).clusterCoordinates,
    });
  }, [libraryId, bookId, rawBook, queryClient]);

  const bookBase = useQuery<Book | null>({
    queryKey: ['bookBase', libraryId, bookId],
    queryFn: () => (rawBook as Book) || null,
    initialData: () => (rawBook as Book) || null,
    staleTime: 1000 * 60 * 5,
  }).data;

  const bookDetails = useQuery<BookDetailsPayload | null>({
    queryKey: ['bookDetails', libraryId, bookId],
    queryFn: () => ({
      synopsis: (rawBook as {synopsis?: string})?.synopsis,
      authorBio: (rawBook as {authorBio?: string})?.authorBio,
      embedding: (rawBook as {embedding?: number[]})?.embedding,
      clusterCoordinates: (
        rawBook as {clusterCoordinates?: {x: number; y: number}}
      )?.clusterCoordinates,
    }),
    initialData: () => ({
      synopsis: (rawBook as {synopsis?: string})?.synopsis,
      authorBio: (rawBook as {authorBio?: string})?.authorBio,
      embedding: (rawBook as {embedding?: number[]})?.embedding,
      clusterCoordinates: (
        rawBook as {clusterCoordinates?: {x: number; y: number}}
      )?.clusterCoordinates,
    }),
    staleTime: 1000 * 60 * 5,
  }).data;

  const book = useMemo(() => {
    if (!bookBase) return null;
    return {...bookBase, ...bookDetails};
  }, [bookBase, bookDetails]);

  const reviews = useMemo(() => {
    if (trpcReviewsQuery.data?.reviews) {
      return trpcReviewsQuery.data.reviews as unknown as Review[];
    }
    const cached = queryClient.getQueryData<Review[]>([
      'bookReviews',
      libraryId,
      bookId,
    ]);
    return cached || [];
  }, [trpcReviewsQuery.data, queryClient, libraryId, bookId]);

  const isLoading = trpcBookQuery.isLoading && !book;

  // Mutations
  const deleteBookMutation = useMutation({
    mutationFn: async () => {
      if (!libraryId || !bookId) return;
      await deleteBookAtomic(libraryId, bookId);
    },
    onSuccess: () => {
      queryClient.setQueryData(['bookBase', libraryId, bookId], null);
      queryClient.setQueryData(['bookDetails', libraryId, bookId], null);
      void queryClient.invalidateQueries({
        queryKey: ['books', libraryId],
      });
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
      if (!user) return;
      const prev = queryClient.getQueryData<Book>([
        'bookBase',
        libraryId,
        bookId,
      ]);
      queryClient.setQueryData(
        ['bookBase', libraryId, bookId],
        (old: Book | null) => {
          if (!old) return old;
          return {
            ...old,
            userStatuses: {
              ...(old.userStatuses || {}),
              [user.uid]: newStatus,
            },
          };
        },
      );
      return {prev};
    },
    onError: (err, newStatus, context) => {
      const ctx = context as {prev?: Book | null};
      if (ctx?.prev) {
        queryClient.setQueryData(['bookBase', libraryId, bookId], ctx.prev);
      }
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
      void trpcReviewsQuery.refetch();
    },
    onMutate: async newReview => {
      if (!user) return;
      const tempId = `temp-${Date.now()}`;
      const rev: Review = {
        id: tempId,
        userId: user.uid,
        userName: user.displayName || user.email || 'Unknown User',
        rating: newReview.rating,
        text: newReview.text,
        createdAt: new Date().toISOString(),
      };

      const prevReviews = queryClient.getQueryData<Review[]>([
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
