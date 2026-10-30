import type {Book, Library, ReadingStatusValue} from '../types';
import type {
  ReadingShelfSummary,
  TrackedBookItem,
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../server/services/readingTracker';

export type CanonicalReadingStatus = TrackedShelfStatus | 'unset';

export interface TrpcCacheSlot<TInput, TData> {
  getData?: (input?: TInput) => TData | undefined;
  setData?: (
    input: TInput,
    updater: TData | ((old: TData | undefined) => TData | undefined),
  ) => void;
  invalidate?: (input?: TInput) => Promise<unknown> | unknown;
}

export interface ReadingStatusCacheUtils {
  book?: {
    get?: TrpcCacheSlot<{libraryId: string; bookId: string}, unknown>;
    list?: TrpcCacheSlot<{libraryId: string}, unknown>;
  };
  readingTracker?: {
    getShelf?: TrpcCacheSlot<{shelf?: string} | undefined, unknown>;
    getUnreadLibraryBooks?: TrpcCacheSlot<undefined, unknown>;
    getRecommendations?: TrpcCacheSlot<unknown, unknown>;
  };
  library?: {
    get?: TrpcCacheSlot<{libraryId: string}, unknown>;
    list?: TrpcCacheSlot<undefined, unknown>;
  };
}

export interface OptimisticReadingStatusParams {
  libraryId: string;
  bookId: string;
  status: ReadingStatusValue | string | null | undefined;
  reviewedAtIso?: string | null;
  bookHint?: Partial<Book> & {libraryName?: string};
}

export function normalizeReadingStatus(
  raw: ReadingStatusValue | string | null | undefined,
): CanonicalReadingStatus {
  if (!raw || raw === 'unset') {
    return 'unset';
  }
  if (raw === 'completed' || raw === 'finished') {
    return 'finished';
  }
  if (raw === 'reading') {
    return 'reading';
  }
  if (raw === 'want_to_read') {
    return 'want_to_read';
  }
  if (raw === 'abandoned') {
    return 'abandoned';
  }
  return 'unset';
}

export function recalculateShelfCounts(
  items: TrackedBookItem[],
): ReadingShelfSummary['counts'] {
  const counts: ReadingShelfSummary['counts'] = {
    all: items.length,
    want_to_read: 0,
    reading: 0,
    finished: 0,
    abandoned: 0,
  };
  for (const item of items) {
    if (item.readingStatus === 'want_to_read') {
      counts.want_to_read += 1;
    } else if (item.readingStatus === 'reading') {
      counts.reading += 1;
    } else if (item.readingStatus === 'finished') {
      counts.finished += 1;
    } else if (item.readingStatus === 'abandoned') {
      counts.abandoned += 1;
    }
  }
  return counts;
}

function extractBooksFromListCache(cachedData: unknown): Book[] | undefined {
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

export function patchBookInListCache(
  oldData: unknown,
  bookId: string,
  updater: (book: Book) => Book | null,
): unknown {
  if (!oldData) {
    return oldData;
  }
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

function resolveLibraryNameFromCache(
  utils: ReadingStatusCacheUtils,
  libraryId: string,
  fallback?: string,
): string {
  if (fallback && fallback.trim().length > 0) {
    return fallback;
  }
  if (libraryId.startsWith('virtual_')) {
    return 'Reading Shelf';
  }
  const singleLib = utils.library?.get?.getData?.({libraryId}) as
    Partial<Library> | undefined;
  if (singleLib?.name) {
    return singleLib.name;
  }
  const libListRaw = utils.library?.list?.getData?.(undefined);
  const libList: Library[] | undefined = Array.isArray(libListRaw)
    ? (libListRaw as Library[])
    : libListRaw &&
        typeof libListRaw === 'object' &&
        Array.isArray((libListRaw as {libraries?: unknown}).libraries)
      ? (libListRaw as {libraries: Library[]}).libraries
      : undefined;
  const matched = libList?.find(l => l.id === libraryId);
  if (matched?.name) {
    return matched.name;
  }
  return 'Library';
}

function resolveBookRecordFromCaches(
  utils: ReadingStatusCacheUtils,
  libraryId: string,
  bookId: string,
  bookHint?: Partial<Book> & {libraryName?: string},
): (Partial<Book> & {libraryName?: string}) | undefined {
  const fromGet = utils.book?.get?.getData?.({libraryId, bookId}) as
    Partial<Book> | undefined;
  const fromList = extractBooksFromListCache(
    utils.book?.list?.getData?.({libraryId}),
  )?.find(b => b.id === bookId);

  const shelfSummary = utils.readingTracker?.getShelf?.getData?.({
    shelf: 'all',
  }) as ReadingShelfSummary | undefined;
  const fromShelf =
    shelfSummary?.items?.find(
      item => item.id === bookId && item.libraryId === libraryId,
    ) ?? shelfSummary?.items?.find(item => item.id === bookId);

  const unreadRaw =
    utils.readingTracker?.getUnreadLibraryBooks?.getData?.(undefined);
  const unreadList: UnreadLibraryBookItem[] | undefined = Array.isArray(
    unreadRaw,
  )
    ? (unreadRaw as UnreadLibraryBookItem[])
    : unreadRaw &&
        typeof unreadRaw === 'object' &&
        Array.isArray((unreadRaw as {books?: unknown}).books)
      ? (unreadRaw as {books: UnreadLibraryBookItem[]}).books
      : undefined;
  const fromUnread = unreadList?.find(
    item => item.id === bookId && item.libraryId === libraryId,
  );

  if (!fromGet && !fromList && !fromShelf && !fromUnread && !bookHint) {
    return undefined;
  }

  return {
    ...fromUnread,
    ...fromShelf,
    ...fromList,
    ...fromGet,
    ...bookHint,
    id: bookId,
    libraryId,
  };
}

/**
 * Optimistically synchronizes a reading status change across all client caches:
 * - `book.get({ libraryId, bookId })`
 * - `book.list({ libraryId })`
 * - `readingTracker.getShelf({ shelf: 'all' })`
 * - `readingTracker.getUnreadLibraryBooks(undefined)`
 *
 * Returns a rollback function that restores all four caches to their pre-mutation state.
 */
export function applyOptimisticReadingStatusPatch(
  utils: ReadingStatusCacheUtils | undefined,
  params: OptimisticReadingStatusParams,
): () => void {
  if (!utils || !params.libraryId || !params.bookId) {
    return () => {};
  }

  const {libraryId, bookId, reviewedAtIso, bookHint} = params;
  const normalizedStatus = normalizeReadingStatus(params.status);

  const prevBookGet = utils.book?.get?.getData?.({libraryId, bookId});
  const prevBookList = utils.book?.list?.getData?.({libraryId});
  const prevShelfAll = utils.readingTracker?.getShelf?.getData?.({
    shelf: 'all',
  });
  const prevUnread =
    utils.readingTracker?.getUnreadLibraryBooks?.getData?.(undefined);

  const resolvedBook = resolveBookRecordFromCaches(
    utils,
    libraryId,
    bookId,
    bookHint,
  );

  // 1. Patch `book.get`
  utils.book?.get?.setData?.({libraryId, bookId}, old => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    const next: Record<string, unknown> = {
      ...(old as Record<string, unknown>),
      readingStatus: normalizedStatus,
    };
    if (reviewedAtIso !== undefined) {
      next.readStatusReviewedAt = reviewedAtIso;
    }
    return next;
  });

  // 2. Patch `book.list`
  utils.book?.list?.setData?.({libraryId}, old =>
    patchBookInListCache(old, bookId, existing => {
      const next: Book = {
        ...existing,
        readingStatus: normalizedStatus,
      };
      if (reviewedAtIso !== undefined) {
        next.readStatusReviewedAt = reviewedAtIso;
      }
      return next;
    }),
  );

  // 3. Patch `readingTracker.getShelf({ shelf: 'all' })`
  utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, old => {
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
      const updatedItem: TrackedBookItem = {
        ...summary.items[existingIdx],
        ...(resolvedBook
          ? {
              synopsis:
                resolvedBook.synopsis ?? summary.items[existingIdx].synopsis,
            }
          : {}),
        readingStatus: normalizedStatus,
        ...(reviewedAtIso !== undefined
          ? {readStatusReviewedAt: reviewedAtIso}
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
        format: resolvedBook.format,
        addedAt: resolvedBook.addedAt,
        readingStatus: normalizedStatus,
        ...(reviewedAtIso !== undefined
          ? {readStatusReviewedAt: reviewedAtIso}
          : {}),
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
    utils.readingTracker?.getUnreadLibraryBooks?.setData?.(undefined, old => {
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
    });
  }

  return () => {
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
 * Optimistically removes a deleted book across `book.list`, `readingTracker.getShelf`,
 * and `readingTracker.getUnreadLibraryBooks`, returning a rollback function.
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

  utils.book?.list?.setData?.({libraryId}, old =>
    patchBookInListCache(old, bookId, () => null),
  );

  utils.readingTracker?.getShelf?.setData?.({shelf: 'all'}, old => {
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

  utils.readingTracker?.getUnreadLibraryBooks?.setData?.(undefined, old => {
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
  });

  return () => {
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
 * Invalidates all reading-status-dependent queries across both the Personal Reading
 * Room (`readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`) and
 * Library views (`book.list`, `book.get`, and optionally `library.list` / `library.get`).
 */
export async function invalidateReadingStatusQueries(
  utils: ReadingStatusCacheUtils | undefined,
  options?: {
    libraryId?: string;
    bookId?: string;
    includeLibraries?: boolean;
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
  if (utils.readingTracker?.getRecommendations?.invalidate) {
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
