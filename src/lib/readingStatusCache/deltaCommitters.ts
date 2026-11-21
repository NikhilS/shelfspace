import {
  useEntityCacheStore,
  type EntityRollbackSnapshot,
} from '../../stores/entityCacheStore';
import type {
  Book,
  ReadingShelfSummary,
  TrackedBookItem,
  UnreadLibraryBookItem,
} from '../../types';
import {
  adjustLibraryBookCountInCaches,
  normalizeReadingStatus,
  patchBookInListCache,
  recalculateShelfCounts,
  resolveBookRecordFromCaches,
  resolveLibraryNameFromCache,
} from './snapshotHelpers';
import type {
  CommitBookDeleteDeltaParams,
  CommitBookReviewDeltaParams,
  CommitBookUpsertDeltaParams,
  CommitReadingStatusDeltaParams,
  ReadingStatusCacheUtils,
} from './types';

/**
 * Commits an authoritative reading-status mutation response into the normalized
 * `useEntityCacheStore` and coupled TanStack Query views without full-collection refetches.
 */
export function commitReadingStatusDelta(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitReadingStatusDeltaParams,
): void {
  commitReadingStatusDeltaInternal(utils, params, {isOptimistic: false});
}

export function commitReadingStatusDeltaInternal(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitReadingStatusDeltaParams,
  options?: {isOptimistic?: boolean; skipEntityPatch?: boolean},
): {version: number; snapshot: EntityRollbackSnapshot} | undefined {
  if (!utils || !params.libraryId || !params.bookId) {
    return undefined;
  }

  const {
    libraryId,
    bookId,
    reviewedAt,
    rating,
    startedAt,
    finishedAt,
    bookSnapshot,
    bookHint,
  } = params;
  const normalizedStatus = normalizeReadingStatus(params.status);

  const mergedHint: (Partial<Book> & {libraryName?: string}) | undefined =
    bookSnapshot || bookHint
      ? {
          ...bookHint,
          ...(bookSnapshot
            ? {
                title: bookSnapshot.title ?? bookHint?.title,
                author: bookSnapshot.author ?? bookHint?.author,
                isbn: bookSnapshot.isbn ?? bookHint?.isbn,
                cleanIsbn: bookSnapshot.cleanIsbn ?? bookHint?.cleanIsbn,
                coverUrl: bookSnapshot.coverUrl ?? bookHint?.coverUrl,
                publishedDate:
                  bookSnapshot.publishedDate ?? bookHint?.publishedDate,
                primaryGenre:
                  bookSnapshot.primaryGenre ?? bookHint?.primaryGenre,
                subgenres: bookHint?.subgenres,
                series: bookSnapshot.series ?? bookHint?.series,
                synopsis: bookHint?.synopsis,
                format: bookSnapshot.format ?? bookHint?.format,
                ownershipStatus:
                  bookSnapshot.ownershipStatus ?? bookHint?.ownershipStatus,
                libraryName: bookSnapshot.libraryName ?? bookHint?.libraryName,
              }
            : {}),
        }
      : undefined;

  const resolvedBook = resolveBookRecordFromCaches(
    utils,
    libraryId,
    bookId,
    mergedHint,
  );

  const entityPatch = options?.skipEntityPatch
    ? undefined
    : useEntityCacheStore.getState().patchReadingState({
        libraryId,
        bookId,
        status: normalizedStatus,
        reviewedAt,
        rating,
        startedAt,
        finishedAt,
        isbn: resolvedBook?.isbn ?? bookSnapshot?.isbn,
        cleanIsbn: resolvedBook?.cleanIsbn ?? bookSnapshot?.cleanIsbn,
        isOptimistic: Boolean(options?.isOptimistic),
      });

  // 1. Patch `book.get`
  utils.book?.get?.setData?.({libraryId, bookId}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    const next: Record<string, unknown> = {
      ...(old as Record<string, unknown>),
      readingStatus: normalizedStatus,
    };
    if (reviewedAt !== undefined) {
      next.readStatusReviewedAt = reviewedAt;
    }
    if (rating !== undefined) {
      next.userRating = rating;
    }
    return next;
  });

  // 2. Patch `book.list`
  utils.book?.list?.setData?.({libraryId}, (old: unknown) =>
    patchBookInListCache(old, bookId, existing => {
      const next: Book = {
        ...existing,
        readingStatus: normalizedStatus,
      };
      if (reviewedAt !== undefined) {
        next.readStatusReviewedAt = reviewedAt;
      }
      if (rating !== undefined) {
        next.userRating = rating;
      }
      return next;
    }),
  );

  // 3. Patch `readingTracker.getShelf({ shelf: 'all' })`
  utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    const summary = old as ReadingShelfSummary;
    if (!Array.isArray(summary.items)) {
      return old;
    }

    const exactIdx = summary.items.findIndex(
      item => item.id === bookId && item.libraryId === libraryId,
    );
    const existingIdx =
      exactIdx !== -1
        ? exactIdx
        : summary.items.findIndex(item => item.id === bookId);

    let nextItems: TrackedBookItem[];
    if (normalizedStatus === 'unset') {
      if (existingIdx === -1) {
        return old;
      }
      nextItems = summary.items.filter((_, idx) => idx !== existingIdx);
    } else if (existingIdx !== -1) {
      const existingItem = summary.items[existingIdx];
      const updatedItem: TrackedBookItem = {
        ...existingItem,
        ...(resolvedBook
          ? {
              synopsis: resolvedBook.synopsis ?? existingItem.synopsis,
              coverUrl: resolvedBook.coverUrl ?? existingItem.coverUrl,
            }
          : {}),
        readingStatus: normalizedStatus,
        ...(reviewedAt !== undefined ? {readStatusReviewedAt: reviewedAt} : {}),
        ...(rating !== undefined ? {userRating: rating} : {}),
        ...(startedAt !== undefined ? {startedAt: startedAt ?? undefined} : {}),
        ...(finishedAt !== undefined
          ? {finishedAt: finishedAt ?? undefined}
          : {}),
      };
      nextItems = summary.items.map((item, idx) =>
        idx === existingIdx ? updatedItem : item,
      );
    } else if (resolvedBook && resolvedBook.title) {
      const isVirtual = libraryId.startsWith('virtual_');
      const newItem: TrackedBookItem = {
        id: bookId,
        libraryId,
        libraryName: resolveLibraryNameFromCache(
          utils,
          libraryId,
          resolvedBook.libraryName,
        ),
        isVirtual,
        ownershipStatus:
          resolvedBook.ownershipStatus ?? (isVirtual ? 'unowned' : 'owned'),
        title: resolvedBook.title,
        author: resolvedBook.author || 'Unknown Author',
        coverUrl: resolvedBook.coverUrl,
        coverUrlRaw: resolvedBook.coverUrlRaw,
        isbn: resolvedBook.isbn,
        publishedDate: resolvedBook.publishedDate,
        primaryGenre: resolvedBook.primaryGenre,
        subgenres: resolvedBook.subgenres,
        series: resolvedBook.series,
        synopsis: resolvedBook.synopsis,
        format: resolvedBook.format ?? 'physical',
        addedAt: resolvedBook.addedAt ?? new Date().toISOString(),
        readingStatus: normalizedStatus,
        ...(reviewedAt !== undefined ? {readStatusReviewedAt: reviewedAt} : {}),
        ...(rating !== undefined ? {userRating: rating} : {}),
        ...(startedAt ? {startedAt} : {}),
        ...(finishedAt ? {finishedAt} : {}),
      };
      nextItems = [newItem, ...summary.items];
    } else {
      return old;
    }

    return {
      ...summary,
      items: nextItems,
      counts: recalculateShelfCounts(nextItems),
    } satisfies ReadingShelfSummary;
  });

  // 4. Patch `readingTracker.getUnreadLibraryBooks`
  if (
    normalizedStatus === 'reading' ||
    normalizedStatus === 'finished' ||
    normalizedStatus === 'abandoned'
  ) {
    utils.readingTracker?.getUnreadLibraryBooks?.setData?.(
      undefined,
      (old: unknown) => {
        if (!old) {
          return old;
        }
        if (Array.isArray(old)) {
          return (old as UnreadLibraryBookItem[]).filter(
            item => !(item.id === bookId && item.libraryId === libraryId),
          );
        }
        if (
          typeof old === 'object' &&
          Array.isArray((old as {books?: unknown}).books)
        ) {
          const container = old as {
            books: UnreadLibraryBookItem[];
            [k: string]: unknown;
          };
          return {
            ...container,
            books: container.books.filter(
              item => !(item.id === bookId && item.libraryId === libraryId),
            ),
          };
        }
        return old;
      },
    );
  } else if (
    !libraryId.startsWith('virtual_') &&
    resolvedBook &&
    resolvedBook.title &&
    resolvedBook.ownershipStatus !== 'unowned'
  ) {
    const unreadStatus: 'unset' | 'want_to_read' =
      normalizedStatus === 'want_to_read' ? 'want_to_read' : 'unset';
    const unreadCandidate: UnreadLibraryBookItem = {
      id: bookId,
      libraryId,
      libraryName: resolveLibraryNameFromCache(
        utils,
        libraryId,
        resolvedBook.libraryName,
      ),
      title: resolvedBook.title,
      author: resolvedBook.author || 'Unknown Author',
      coverUrl: resolvedBook.coverUrl,
      coverUrlRaw: resolvedBook.coverUrlRaw,
      isbn: resolvedBook.isbn,
      publishedDate: resolvedBook.publishedDate,
      primaryGenre: resolvedBook.primaryGenre,
      subgenres: resolvedBook.subgenres,
      series: resolvedBook.series,
      synopsis: resolvedBook.synopsis,
      format: resolvedBook.format ?? 'physical',
      addedAt: resolvedBook.addedAt ?? new Date().toISOString(),
      readingStatus: unreadStatus,
    };

    utils.readingTracker?.getUnreadLibraryBooks?.setData?.(
      undefined,
      (old: unknown) => {
        if (!old) {
          return old;
        }
        const upsertUnreadList = (
          list: UnreadLibraryBookItem[],
        ): UnreadLibraryBookItem[] => {
          const idx = list.findIndex(
            item => item.id === bookId && item.libraryId === libraryId,
          );
          if (idx !== -1) {
            return list.map((item, i) =>
              i === idx ? {...item, readingStatus: unreadStatus} : item,
            );
          }
          return [unreadCandidate, ...list];
        };
        if (Array.isArray(old)) {
          return upsertUnreadList(old as UnreadLibraryBookItem[]);
        }
        if (
          typeof old === 'object' &&
          Array.isArray((old as {books?: unknown}).books)
        ) {
          const container = old as {
            books: UnreadLibraryBookItem[];
            [k: string]: unknown;
          };
          return {
            ...container,
            books: upsertUnreadList(container.books),
          };
        }
        return old;
      },
    );
  }

  return entityPatch;
}

/**
 * Surgically upserts a newly created or edited book into `useEntityCacheStore`,
 * `book.get`, `book.list`, `readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`,
 * and library counts.
 */
export function commitBookUpsertDelta(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitBookUpsertDeltaParams,
): void {
  if (!utils || !params.libraryId || !params.book?.id) {
    return;
  }

  const {libraryId, book, libraryName, bookCountDelta = 0} = params;
  const bookId = book.id;
  const normalizedBook: Book = {
    format: 'physical',
    addedAt: new Date().toISOString(),
    ...book,
    id: bookId,
    libraryId,
  };

  useEntityCacheStore.getState().upsertBooksDelta(libraryId, [normalizedBook], {
    bookCountDelta,
  });

  // 1. Upsert `book.get`
  utils.book?.get?.setData?.({libraryId, bookId}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return normalizedBook;
    }
    return {
      ...(old as Record<string, unknown>),
      ...normalizedBook,
    };
  });

  // 2. Upsert `book.list` (for real libraries)
  if (!libraryId.startsWith('virtual_')) {
    utils.book?.list?.setData?.({libraryId}, (old: unknown) => {
      if (!old) {
        return old;
      }
      const upsertArray = (list: Book[]): {next: Book[]; inserted: boolean} => {
        const idx = list.findIndex(b => b.id === bookId);
        if (idx !== -1) {
          return {
            next: list.map((b, i) =>
              i === idx ? {...b, ...normalizedBook} : b,
            ),
            inserted: false,
          };
        }
        return {
          next: [normalizedBook, ...list],
          inserted: true,
        };
      };

      if (Array.isArray(old)) {
        return upsertArray(old as Book[]).next;
      }
      if (
        typeof old === 'object' &&
        Array.isArray((old as {books?: unknown}).books)
      ) {
        const container = old as {
          books: Book[];
          totalCount?: number;
          [k: string]: unknown;
        };
        const {next, inserted} = upsertArray(container.books);
        return {
          ...container,
          books: next,
          ...(inserted && typeof container.totalCount === 'number'
            ? {totalCount: container.totalCount + 1}
            : {}),
        };
      }
      return old;
    });
  }

  // 3. Synchronize reading shelf & unread shelf if status is set or item already tracked
  const effectiveStatus = normalizeReadingStatus(normalizedBook.readingStatus);
  if (effectiveStatus !== 'unset') {
    commitReadingStatusDeltaInternal(
      utils,
      {
        libraryId,
        bookId,
        status: effectiveStatus,
        bookHint: {...normalizedBook, libraryName},
      },
      {isOptimistic: false},
    );
  } else {
    utils.readingTracker?.getShelf?.setData?.(
      {shelf: 'all'},
      (old: unknown) => {
        if (!old || typeof old !== 'object') {
          return old;
        }
        const summary = old as ReadingShelfSummary;
        if (!Array.isArray(summary.items)) {
          return old;
        }
        const idx = summary.items.findIndex(
          item => item.id === bookId && item.libraryId === libraryId,
        );
        if (idx === -1) {
          return old;
        }
        const nextItems = summary.items.map((item, i) =>
          i === idx
            ? {
                ...item,
                title: normalizedBook.title,
                author: normalizedBook.author,
                coverUrl: normalizedBook.coverUrl ?? item.coverUrl,
                isbn: normalizedBook.isbn ?? item.isbn,
                primaryGenre: normalizedBook.primaryGenre ?? item.primaryGenre,
                subgenres: normalizedBook.subgenres ?? item.subgenres,
                series: normalizedBook.series ?? item.series,
                synopsis: normalizedBook.synopsis ?? item.synopsis,
              }
            : item,
        );
        return {
          ...summary,
          items: nextItems,
        };
      },
    );

    if (
      !libraryId.startsWith('virtual_') &&
      normalizedBook.ownershipStatus !== 'unowned'
    ) {
      commitReadingStatusDeltaInternal(
        utils,
        {
          libraryId,
          bookId,
          status: 'unset',
          bookHint: {...normalizedBook, libraryName},
        },
        {isOptimistic: false, skipEntityPatch: true},
      );
    }
  }

  // 4. Adjust library bookCount
  if (bookCountDelta !== 0) {
    adjustLibraryBookCountInCaches(utils, libraryId, bookCountDelta);
  }
}

/**
 * Commits a book deletion across `useEntityCacheStore`, `book.get`, `book.list`,
 * `readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`, and library counts.
 */
export function commitBookDeleteDelta(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitBookDeleteDeltaParams,
): void {
  if (!utils || !params.libraryId || !params.bookId) {
    return;
  }
  const {
    libraryId,
    bookId,
    bookCountDelta = -1,
    alreadyRemovedOptimistically = false,
  } = params;
  if (!alreadyRemovedOptimistically) {
    removeBookFromReadingCaches(utils, {libraryId, bookId});
  }
  utils.book?.get?.setData?.({libraryId, bookId}, undefined);
  if (bookCountDelta !== 0) {
    useEntityCacheStore
      .getState()
      .adjustLibraryBookCount(libraryId, bookCountDelta);
    adjustLibraryBookCountInCaches(utils, libraryId, bookCountDelta);
  }
}

/**
 * Commits a newly saved book review into `useEntityCacheStore` and `book.listReviews`
 * (replacing any optimistic `temp-*` entry or existing review by the same `userId`)
 * and synchronizes `userRating` across `book.get`, `book.list`, and `readingTracker.getShelf`.
 */
export function commitBookReviewDelta(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitBookReviewDeltaParams,
): void {
  if (!utils || !params.libraryId || !params.bookId) {
    return;
  }
  const {libraryId, bookId, review} = params;

  useEntityCacheStore.getState().upsertBookReview(libraryId, bookId, review);

  utils.book?.listReviews?.setData?.({libraryId, bookId}, (old: unknown) => {
    const existingList: Array<{
      id: string;
      userId: string;
      userName: string;
      rating: number;
      text: string;
      createdAt: string;
    }> = Array.isArray(old)
      ? (old as Array<{
          id: string;
          userId: string;
          userName: string;
          rating: number;
          text: string;
          createdAt: string;
        }>)
      : old &&
          typeof old === 'object' &&
          Array.isArray((old as {reviews?: unknown}).reviews)
        ? (
            old as {
              reviews: Array<{
                id: string;
                userId: string;
                userName: string;
                rating: number;
                text: string;
                createdAt: string;
              }>;
            }
          ).reviews
        : [];

    const filtered = existingList.filter(
      r =>
        r.userId !== review.userId &&
        r.id !== review.id &&
        !String(r.id).startsWith('temp-'),
    );
    return {
      reviews: [review, ...filtered],
    };
  });

  utils.book?.get?.setData?.({libraryId, bookId}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    return {
      ...(old as Record<string, unknown>),
      userRating: review.rating,
    };
  });

  utils.book?.list?.setData?.({libraryId}, (old: unknown) =>
    patchBookInListCache(old, bookId, existing => ({
      ...existing,
      userRating: review.rating,
    })),
  );

  utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    const summary = old as ReadingShelfSummary;
    if (!Array.isArray(summary.items)) {
      return old;
    }
    const idx = summary.items.findIndex(
      item => item.id === bookId && item.libraryId === libraryId,
    );
    if (idx === -1) {
      return old;
    }
    return {
      ...summary,
      items: summary.items.map((item, i) =>
        i === idx ? {...item, userRating: review.rating} : item,
      ),
    };
  });
}

/**
 * Optimistically removes a deleted book across `useEntityCacheStore`, `book.list`,
 * `readingTracker.getShelf`, and `readingTracker.getUnreadLibraryBooks`, returning
 * a version-guarded rollback function.
 */
export function removeBookFromReadingCaches(
  utils: ReadingStatusCacheUtils | undefined,
  params: {libraryId: string; bookId: string},
): () => void {
  if (!utils || !params.libraryId || !params.bookId) {
    return () => {};
  }
  const {libraryId, bookId} = params;
  const prevBookGet = utils.book?.get?.getData?.({libraryId, bookId});
  const prevBookList = utils.book?.list?.getData?.({libraryId});
  const prevShelfAll = utils.readingTracker?.getShelf?.getData?.({
    shelf: 'all',
  });
  const prevUnread =
    utils.readingTracker?.getUnreadLibraryBooks?.getData?.(undefined);

  const removeExpectedVersion =
    useEntityCacheStore.getState().nextMutationVersion;
  const [entitySnapshot] = useEntityCacheStore
    .getState()
    .removeBooks(libraryId, [bookId]);

  utils.book?.list?.setData?.({libraryId}, (old: unknown) =>
    patchBookInListCache(old, bookId, () => null),
  );

  utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    const summary = old as ReadingShelfSummary;
    if (!Array.isArray(summary.items)) {
      return old;
    }
    const nextItems = summary.items.filter(
      item => !(item.id === bookId && item.libraryId === libraryId),
    );
    if (nextItems.length === summary.items.length) {
      return old;
    }
    return {
      ...summary,
      items: nextItems,
      counts: recalculateShelfCounts(nextItems),
    } satisfies ReadingShelfSummary;
  });

  utils.readingTracker?.getUnreadLibraryBooks?.setData?.(
    undefined,
    (old: unknown) => {
      if (!old) {
        return old;
      }
      if (Array.isArray(old)) {
        return (old as UnreadLibraryBookItem[]).filter(
          item => !(item.id === bookId && item.libraryId === libraryId),
        );
      }
      if (
        typeof old === 'object' &&
        Array.isArray((old as {books?: unknown}).books)
      ) {
        const container = old as {
          books: UnreadLibraryBookItem[];
          [k: string]: unknown;
        };
        return {
          ...container,
          books: container.books.filter(
            item => !(item.id === bookId && item.libraryId === libraryId),
          ),
        };
      }
      return old;
    },
  );

  return () => {
    if (entitySnapshot) {
      const didRollback = useEntityCacheStore
        .getState()
        .rollbackEntitySnapshot(entitySnapshot, removeExpectedVersion);
      if (!didRollback) {
        return;
      }
    }
    if (prevBookGet !== undefined) {
      utils.book?.get?.setData?.({libraryId, bookId}, prevBookGet);
    }
    if (prevBookList !== undefined) {
      utils.book?.list?.setData?.({libraryId}, prevBookList);
    }
    if (prevShelfAll !== undefined) {
      utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, prevShelfAll);
    }
    if (prevUnread !== undefined) {
      utils.readingTracker?.getUnreadLibraryBooks?.setData?.(
        undefined,
        prevUnread,
      );
    }
  };
}

/**
 * Invalidates reading-status-dependent queries when bulk mutations (`batchUpsert`,
 * `mergeDuplicates`, or background enrichment) modify multiple books simultaneously.
 */
export async function invalidateReadingStatusQueries(
  utils: ReadingStatusCacheUtils | undefined,
  options?: {
    libraryId?: string;
    bookId?: string;
    includeLibraries?: boolean;
    includeRecommendations?: boolean;
  },
): Promise<void> {
  if (!utils) {
    return;
  }

  const tasks: Array<Promise<unknown> | unknown> = [];

  if (utils.readingTracker?.getShelf?.invalidate) {
    tasks.push(utils.readingTracker.getShelf.invalidate());
  }
  if (utils.readingTracker?.getUnreadLibraryBooks?.invalidate) {
    tasks.push(utils.readingTracker.getUnreadLibraryBooks.invalidate());
  }
  if (
    options?.includeRecommendations !== false &&
    utils.readingTracker?.getRecommendations?.invalidate
  ) {
    tasks.push(utils.readingTracker.getRecommendations.invalidate());
  }

  if (options?.libraryId) {
    if (utils.book?.list?.invalidate) {
      tasks.push(utils.book.list.invalidate({libraryId: options.libraryId}));
    }
    if (options.bookId && utils.book?.get?.invalidate) {
      tasks.push(
        utils.book.get.invalidate({
          libraryId: options.libraryId,
          bookId: options.bookId,
        }),
      );
    }
    if (options.includeLibraries && utils.library?.get?.invalidate) {
      tasks.push(utils.library.get.invalidate({libraryId: options.libraryId}));
    }
  } else if (utils.book?.list?.invalidate) {
    tasks.push(utils.book.list.invalidate());
  }

  if (options?.includeLibraries && utils.library?.list?.invalidate) {
    tasks.push(utils.library.list.invalidate());
  }

  await Promise.allSettled(tasks);
}
