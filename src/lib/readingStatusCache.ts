import {
  userReadingStateBookSnapshotSchema,
  type UserReadingStateBookSnapshot,
} from '../schemas/readingState';
import type {
  Book,
  Library,
  ReadingShelfSummary,
  ReadingStatusValue,
  TrackedBookItem,
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../types';

export type CanonicalReadingStatus = TrackedShelfStatus | 'unset';

export interface TrpcCacheSlot<Input, Data> {
  getData?(input?: Input): Data | undefined;
  setData?(
    input: Input,
    updater: Data | ((old: Data | undefined) => Data | undefined),
  ): void;
  invalidate?(input?: Input): Promise<unknown> | unknown;
}

export interface ReadingStatusCacheUtils {
  book?: {
    get?: TrpcCacheSlot<{libraryId: string; bookId: string}, unknown>;
    list?: TrpcCacheSlot<{libraryId: string}, unknown>;
    listReviews?: TrpcCacheSlot<{libraryId: string; bookId: string}, unknown>;
  };
  readingTracker?: {
    getShelf?: TrpcCacheSlot<
      {shelf?: TrackedShelfStatus | 'all'} | undefined,
      unknown
    >;
    getUnreadLibraryBooks?: TrpcCacheSlot<undefined, unknown>;
    getRecommendations?: TrpcCacheSlot<undefined, unknown>;
  };
  library?: {
    get?: TrpcCacheSlot<{libraryId: string}, unknown>;
    list?: TrpcCacheSlot<
      {scopes?: Array<'owned' | 'shared' | 'all'>} | undefined,
      unknown
    >;
  };
}

export interface OptimisticReadingStatusParams {
  libraryId: string;
  bookId: string;
  status: ReadingStatusValue | string | null | undefined;
  reviewedAtIso?: string | null;
  bookHint?: Partial<Book> & {libraryName?: string};
}

export interface CommitReadingStatusDeltaParams {
  libraryId: string;
  bookId: string;
  status: ReadingStatusValue | string | null | undefined;
  reviewedAt?: string | null;
  rating?: number;
  startedAt?: string | null;
  finishedAt?: string | null;
  bookSnapshot?: Partial<UserReadingStateBookSnapshot>;
  bookHint?: Partial<Book> & {libraryName?: string};
}

export interface CommitBookUpsertDeltaParams {
  libraryId: string;
  book: Partial<Book> & {id: string; title: string; author: string};
  libraryName?: string;
  bookCountDelta?: number;
}

export interface CommitBookDeleteDeltaParams {
  libraryId: string;
  bookId: string;
  bookCountDelta?: number;
}

export interface CommitBookReviewDeltaParams {
  libraryId: string;
  bookId: string;
  review: {
    id: string;
    userId: string;
    userName: string;
    rating: number;
    text: string;
    createdAt: string;
  };
}

/**
 * Builds a strict-schema-validated `UserReadingStateBookSnapshot` hint from a
 * client-cached book record so `book.updateStatus` and `book.recordReadSwipeReview`
 * skip pre-write Firestore reads (`0` pre-write server reads).
 */
export function buildBookSnapshotHint(
  book: (Partial<Book> & {libraryName?: string}) | null | undefined,
  options?: {libraryId?: string; libraryName?: string; bookId?: string},
): UserReadingStateBookSnapshot | undefined {
  if (!book || !book.title) {
    return undefined;
  }

  const title = String(book.title).trim().slice(0, 500);
  if (!title) {
    return undefined;
  }
  const author = String(book.author || 'Unknown Author')
    .trim()
    .slice(0, 500);
  const rawIsbn = typeof book.isbn === 'string' ? book.isbn.trim() : '';
  const cleanIsbn = rawIsbn.replace(/[^0-9X]/gi, '').toUpperCase();
  const resolvedLibraryId = options?.libraryId || book.libraryId;
  const resolvedBookId = options?.bookId || book.id;
  const resolvedLibraryName = options?.libraryName || book.libraryName;

  const candidate: Record<string, unknown> = {
    title,
    author,
    ...(rawIsbn ? {isbn: rawIsbn.slice(0, 64)} : {}),
    ...(cleanIsbn ? {cleanIsbn: cleanIsbn.slice(0, 64)} : {}),
    ...(typeof book.coverUrl === 'string' && book.coverUrl.trim().length > 0
      ? {coverUrl: book.coverUrl.trim()}
      : {}),
    ...(typeof book.publishedDate === 'string' && book.publishedDate.length > 0
      ? {publishedDate: book.publishedDate.slice(0, 100)}
      : {}),
    ...(typeof book.primaryGenre === 'string' && book.primaryGenre.length > 0
      ? {primaryGenre: book.primaryGenre.slice(0, 200)}
      : {}),
    ...(Array.isArray(book.subgenres) && book.subgenres.length > 0
      ? {
          subgenres: book.subgenres
            .filter((s): s is string => typeof s === 'string' && s.length > 0)
            .map(s => s.slice(0, 200))
            .slice(0, 50),
        }
      : {}),
    ...(typeof book.series === 'string' && book.series.length > 0
      ? {series: book.series.slice(0, 300)}
      : {}),
    ...(book.format === 'physical' || book.format === 'digital'
      ? {format: book.format}
      : {}),
    ...(typeof book.synopsis === 'string' && book.synopsis.length > 0
      ? {synopsis: book.synopsis.slice(0, 50000)}
      : {}),
    ...(typeof book.authorBio === 'string' && book.authorBio.length > 0
      ? {authorBio: book.authorBio.slice(0, 50000)}
      : {}),
    ...(resolvedLibraryId ? {libraryId: resolvedLibraryId} : {}),
    ...(typeof resolvedLibraryName === 'string' &&
    resolvedLibraryName.length > 0
      ? {libraryName: resolvedLibraryName.slice(0, 200)}
      : {}),
    ...(resolvedBookId && !resolvedBookId.includes(':')
      ? {bookId: resolvedBookId}
      : {}),
    ...(book.ownershipStatus === 'owned' || book.ownershipStatus === 'unowned'
      ? {ownershipStatus: book.ownershipStatus}
      : {}),
  };

  const parsed = userReadingStateBookSnapshotSchema.safeParse(candidate);
  if (parsed.success) {
    return parsed.data;
  }

  // Fallback minimal snapshot if optional URL/ID failed strict schema check
  const minimal = userReadingStateBookSnapshotSchema.safeParse({
    title,
    author,
    ...(rawIsbn ? {isbn: rawIsbn.slice(0, 64)} : {}),
    ...(cleanIsbn ? {cleanIsbn: cleanIsbn.slice(0, 64)} : {}),
  });
  return minimal.success ? minimal.data : undefined;
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
    const container = oldData as {
      books: Book[];
      totalCount?: number;
      [k: string]: unknown;
    };
    const nextBooks = container.books
      .map(b => (b.id === bookId ? updater(b) : b))
      .filter((b): b is Book => b !== null);
    const lengthDelta = nextBooks.length - container.books.length;
    return {
      ...container,
      books: nextBooks,
      ...(typeof container.totalCount === 'number' && lengthDelta !== 0
        ? {totalCount: Math.max(0, container.totalCount + lengthDelta)}
        : {}),
    };
  }
  return oldData;
}

function adjustLibraryBookCountInCaches(
  utils: ReadingStatusCacheUtils,
  libraryId: string,
  delta: number,
): void {
  if (!delta || !libraryId || libraryId.startsWith('virtual_')) {
    return;
  }

  utils.library?.get?.setData?.({libraryId}, (old: unknown) => {
    if (!old || typeof old !== 'object') {
      return old;
    }
    const lib = old as Library;
    const current = typeof lib.bookCount === 'number' ? lib.bookCount : 0;
    return {
      ...lib,
      bookCount: Math.max(0, current + delta),
    };
  });

  const patchLibraryList = (old: unknown): unknown => {
    if (!old) {
      return old;
    }
    const updateLib = (lib: Library): Library => {
      if (lib.id !== libraryId) {
        return lib;
      }
      const current = typeof lib.bookCount === 'number' ? lib.bookCount : 0;
      return {
        ...lib,
        bookCount: Math.max(0, current + delta),
      };
    };
    if (Array.isArray(old)) {
      return (old as Library[]).map(updateLib);
    }
    if (
      typeof old === 'object' &&
      Array.isArray((old as {libraries?: unknown}).libraries)
    ) {
      const container = old as {libraries: Library[]; [k: string]: unknown};
      return {
        ...container,
        libraries: container.libraries.map(updateLib),
      };
    }
    return old;
  };

  const listInputs: Array<
    {scopes?: Array<'owned' | 'shared' | 'all'>} | undefined
  > = [undefined, {scopes: ['owned', 'shared']}, {scopes: ['all']}];

  for (const listInput of listInputs) {
    try {
      utils.library?.list?.setData?.(listInput, patchLibraryList);
    } catch {
      // Ignore unmounted input variants in isolated test mocks
    }
  }
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
  const libListRaw =
    utils.library?.list?.getData?.(undefined) ??
    utils.library?.list?.getData?.({scopes: ['owned', 'shared']});
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

  commitReadingStatusDelta(utils, {
    libraryId,
    bookId,
    status: normalizedStatus,
    reviewedAt: reviewedAtIso,
    bookHint,
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
 * Commits an authoritative reading-status mutation response into all coupled
 * client caches via `setData` without triggering full-collection network refetches.
 */
export function commitReadingStatusDelta(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitReadingStatusDeltaParams,
): void {
  if (!utils || !params.libraryId || !params.bookId) {
    return;
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
                coverUrl: bookSnapshot.coverUrl ?? bookHint?.coverUrl,
                publishedDate:
                  bookSnapshot.publishedDate ?? bookHint?.publishedDate,
                primaryGenre:
                  bookSnapshot.primaryGenre ?? bookHint?.primaryGenre,
                subgenres: bookSnapshot.subgenres ?? bookHint?.subgenres,
                series: bookSnapshot.series ?? bookHint?.series,
                synopsis: bookSnapshot.synopsis ?? bookHint?.synopsis,
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
}

/**
 * Surgically upserts a newly created or edited book into `book.get`, `book.list`,
 * `readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`, and library counts.
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
    commitReadingStatusDelta(utils, {
      libraryId,
      bookId,
      status: effectiveStatus,
      bookHint: {...normalizedBook, libraryName},
    });
  } else {
    // Patch metadata in getShelf if item exists, or insert into unread library books if new
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
      commitReadingStatusDelta(utils, {
        libraryId,
        bookId,
        status: 'unset',
        bookHint: {...normalizedBook, libraryName},
      });
    }
  }

  // 4. Adjust library bookCount
  if (bookCountDelta !== 0) {
    adjustLibraryBookCountInCaches(utils, libraryId, bookCountDelta);
  }
}

/**
 * Commits a book deletion across `book.get`, `book.list`, `readingTracker.getShelf`,
 * `readingTracker.getUnreadLibraryBooks`, and library counts without refetching.
 */
export function commitBookDeleteDelta(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitBookDeleteDeltaParams,
): void {
  if (!utils || !params.libraryId || !params.bookId) {
    return;
  }
  const {libraryId, bookId, bookCountDelta = -1} = params;
  removeBookFromReadingCaches(utils, {libraryId, bookId});
  utils.book?.get?.setData?.({libraryId, bookId}, undefined);
  adjustLibraryBookCountInCaches(utils, libraryId, bookCountDelta);
}

/**
 * Commits a newly saved book review into `book.listReviews` (replacing any optimistic
 * `temp-*` entry or existing review by the same `userId`) and synchronizes `userRating`
 * across `book.get`, `book.list`, and `readingTracker.getShelf`.
 */
export function commitBookReviewDelta(
  utils: ReadingStatusCacheUtils | undefined,
  params: CommitBookReviewDeltaParams,
): void {
  if (!utils || !params.libraryId || !params.bookId) {
    return;
  }
  const {libraryId, bookId, review} = params;

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
