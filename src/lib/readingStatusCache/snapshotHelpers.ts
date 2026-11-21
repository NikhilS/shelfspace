import {
  userReadingStateBookSnapshotSchema,
  type UserReadingStateBookSnapshot,
} from '../../schemas/readingState';
import {
  selectBookWithOverlay,
  useEntityCacheStore,
} from '../../stores/entityCacheStore';
import type {
  Book,
  Library,
  ReadingShelfSummary,
  ReadingStatusValue,
  TrackedBookItem,
  UnreadLibraryBookItem,
} from '../../types';
import type {CanonicalReadingStatus, ReadingStatusCacheUtils} from './types';

/**
 * Builds a strict-schema-validated `< 2KB` `MinimalBookStub` (`UserReadingStateBookSnapshot`)
 * hint from a client-cached book record so `book.updateStatus` and `book.recordReadSwipeReview`
 * skip pre-write Firestore reads (`0` pre-write server reads) without duplicating 50KB prose.
 */
export function buildBookSnapshotHint(
  book: (Partial<Book> & {libraryName?: string}) | null | undefined,
  options?: {libraryId?: string; libraryName?: string; bookId?: string},
): UserReadingStateBookSnapshot | undefined {
  if (!book || !book.title) {
    return undefined;
  }

  const title = String(book.title).trim().slice(0, 300);
  if (!title) {
    return undefined;
  }
  const author = String(book.author || 'Unknown Author')
    .trim()
    .slice(0, 300);
  const rawIsbn = typeof book.isbn === 'string' ? book.isbn.trim() : '';
  const cleanIsbn = rawIsbn.replace(/[^0-9X]/gi, '').toUpperCase();
  const resolvedLibraryId = options?.libraryId || book.libraryId;
  const resolvedBookId = options?.bookId || book.id;
  const resolvedLibraryName = options?.libraryName || book.libraryName;

  const rawCoverUrl =
    typeof book.coverUrl === 'string' ? book.coverUrl.trim() : '';
  const isSafeCoverUrl =
    rawCoverUrl.length > 0 &&
    rawCoverUrl.length <= 2048 &&
    !(rawCoverUrl.startsWith('data:') && rawCoverUrl.length > 1500);

  const candidate: Record<string, unknown> = {
    title,
    author,
    ...(rawIsbn ? {isbn: rawIsbn.slice(0, 64)} : {}),
    ...(cleanIsbn ? {cleanIsbn: cleanIsbn.slice(0, 64)} : {}),
    ...(isSafeCoverUrl ? {coverUrl: rawCoverUrl} : {}),
    ...(typeof book.publishedDate === 'string' && book.publishedDate.length > 0
      ? {publishedDate: book.publishedDate.slice(0, 100)}
      : {}),
    ...(typeof book.primaryGenre === 'string' && book.primaryGenre.length > 0
      ? {primaryGenre: book.primaryGenre.slice(0, 200)}
      : {}),
    ...(typeof book.series === 'string' && book.series.length > 0
      ? {series: book.series.slice(0, 200)}
      : {}),
    ...(book.format === 'physical' || book.format === 'digital'
      ? {format: book.format}
      : {}),
    ...(resolvedLibraryId && resolvedLibraryId !== 'external'
      ? {libraryId: resolvedLibraryId}
      : {}),
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
  if (raw === 'finished') {
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

export function extractBooksFromListCache(
  cachedData: unknown,
): Book[] | undefined {
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

export function adjustLibraryBookCountInCaches(
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
    utils.library?.list?.setData?.(listInput, patchLibraryList);
  }
}

export function resolveLibraryNameFromCache(
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
  const normalizedEntityLib =
    useEntityCacheStore.getState().librariesById[libraryId];
  if (normalizedEntityLib?.name) {
    return normalizedEntityLib.name;
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

export function resolveBookRecordFromCaches(
  utils: ReadingStatusCacheUtils,
  libraryId: string,
  bookId: string,
  bookHint?: Partial<Book> & {libraryName?: string},
): (Partial<Book> & {libraryName?: string}) | undefined {
  const fromEntityStore = selectBookWithOverlay(
    useEntityCacheStore.getState(),
    libraryId,
    bookId,
  );
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

  if (
    !fromEntityStore &&
    !fromGet &&
    !fromList &&
    !fromShelf &&
    !fromUnread &&
    !bookHint
  ) {
    return undefined;
  }

  return {
    ...fromUnread,
    ...fromShelf,
    ...fromEntityStore,
    ...fromList,
    ...fromGet,
    ...bookHint,
    id: bookId,
    libraryId,
  };
}
