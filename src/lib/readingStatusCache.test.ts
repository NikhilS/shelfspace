import {describe, it, expect, vi} from 'vitest';
import {
  applyOptimisticReadingStatusPatch,
  invalidateReadingStatusQueries,
  normalizeReadingStatus,
  recalculateShelfCounts,
  removeBookFromReadingCaches,
  type ReadingStatusCacheUtils,
} from './readingStatusCache';
import type {Book} from '../types';
import type {
  ReadingShelfSummary,
  TrackedBookItem,
  UnreadLibraryBookItem,
} from '../server/services/readingTracker';

function createMockCacheUtils(initialState?: {
  bookGet?: Book;
  bookList?: {books: Book[]};
  shelfAll?: ReadingShelfSummary;
  unread?: UnreadLibraryBookItem[];
  libraryName?: string;
}) {
  const store = {
    bookGet: initialState?.bookGet,
    bookList: initialState?.bookList,
    shelfAll: initialState?.shelfAll,
    unread: initialState?.unread,
    libraryGet: initialState?.libraryName
      ? {id: 'lib-1', name: initialState.libraryName}
      : undefined,
  };

  const invalidations = {
    bookGet: vi.fn().mockResolvedValue(undefined),
    bookList: vi.fn().mockResolvedValue(undefined),
    shelf: vi.fn().mockResolvedValue(undefined),
    unread: vi.fn().mockResolvedValue(undefined),
    libraryGet: vi.fn().mockResolvedValue(undefined),
    libraryList: vi.fn().mockResolvedValue(undefined),
  };

  const utils: ReadingStatusCacheUtils = {
    book: {
      get: {
        getData: () => store.bookGet,
        setData: (_input, updater) => {
          store.bookGet =
            typeof updater === 'function'
              ? (updater(store.bookGet) as Book | undefined)
              : (updater as Book | undefined);
        },
        invalidate: invalidations.bookGet,
      },
      list: {
        getData: () => store.bookList,
        setData: (_input, updater) => {
          store.bookList =
            typeof updater === 'function'
              ? (updater(store.bookList) as {books: Book[]} | undefined)
              : (updater as {books: Book[]} | undefined);
        },
        invalidate: invalidations.bookList,
      },
    },
    readingTracker: {
      getShelf: {
        getData: () => store.shelfAll,
        setData: (_input, updater) => {
          store.shelfAll =
            typeof updater === 'function'
              ? (updater(store.shelfAll) as ReadingShelfSummary | undefined)
              : (updater as ReadingShelfSummary | undefined);
        },
        invalidate: invalidations.shelf,
      },
      getUnreadLibraryBooks: {
        getData: () => store.unread,
        setData: (_input, updater) => {
          store.unread =
            typeof updater === 'function'
              ? (updater(store.unread) as UnreadLibraryBookItem[] | undefined)
              : (updater as UnreadLibraryBookItem[] | undefined);
        },
        invalidate: invalidations.unread,
      },
    },
    library: {
      get: {
        getData: () => store.libraryGet,
        invalidate: invalidations.libraryGet,
      },
      list: {
        getData: () => (store.libraryGet ? [store.libraryGet] : []),
        invalidate: invalidations.libraryList,
      },
    },
  };

  return {store, utils, invalidations};
}

describe('readingStatusCache', () => {
  it('normalizes legacy and canonical reading status values', () => {
    expect(normalizeReadingStatus('completed')).toBe('finished');
    expect(normalizeReadingStatus('finished')).toBe('finished');
    expect(normalizeReadingStatus('reading')).toBe('reading');
    expect(normalizeReadingStatus('want_to_read')).toBe('want_to_read');
    expect(normalizeReadingStatus('abandoned')).toBe('abandoned');
    expect(normalizeReadingStatus('unset')).toBe('unset');
    expect(normalizeReadingStatus(undefined)).toBe('unset');
  });

  it('inserts an untracked library book into readingTracker.getShelf immediately when marked as reading', () => {
    const sampleBook: Book = {
      id: 'book-1',
      libraryId: 'lib-1',
      title: 'Piranesi',
      author: 'Susanna Clarke',
      readingStatus: 'unset',
      coverUrl: 'https://example.com/piranesi.jpg',
    };

    const {store, utils} = createMockCacheUtils({
      bookGet: sampleBook,
      bookList: {books: [sampleBook]},
      shelfAll: {
        items: [],
        counts: {
          all: 0,
          want_to_read: 0,
          reading: 0,
          finished: 0,
          abandoned: 0,
        },
      },
      unread: [
        {
          ...sampleBook,
          libraryId: 'lib-1',
          libraryName: 'Home Library',
          readingStatus: 'unset',
        },
      ],
      libraryName: 'Home Library',
    });

    const rollback = applyOptimisticReadingStatusPatch(utils, {
      libraryId: 'lib-1',
      bookId: 'book-1',
      status: 'reading',
    });

    // 1. book.get updated immediately
    expect(store.bookGet?.readingStatus).toBe('reading');
    // 2. book.list updated immediately
    expect(store.bookList?.books[0]?.readingStatus).toBe('reading');
    // 3. readingTracker.getShelf has the newly tracked book with updated counts
    expect(store.shelfAll?.items).toHaveLength(1);
    expect(store.shelfAll?.items[0]?.id).toBe('book-1');
    expect(store.shelfAll?.items[0]?.readingStatus).toBe('reading');
    expect(store.shelfAll?.items[0]?.libraryName).toBe('Home Library');
    expect(store.shelfAll?.counts).toEqual({
      all: 1,
      want_to_read: 0,
      reading: 1,
      finished: 0,
      abandoned: 0,
    });
    // 4. Removed from unread library books
    expect(store.unread).toHaveLength(0);

    // 5. Rollback restores all four caches on error
    rollback();
    expect(store.bookGet?.readingStatus).toBe('unset');
    expect(store.bookList?.books[0]?.readingStatus).toBe('unset');
    expect(store.shelfAll?.items).toHaveLength(0);
    expect(store.unread).toHaveLength(1);
  });

  it('updates an existing shelf book from reading to finished and recalculates counts', () => {
    const trackedItem: TrackedBookItem = {
      id: 'book-2',
      libraryId: 'lib-1',
      libraryName: 'Main Study',
      isVirtual: false,
      ownershipStatus: 'owned',
      title: 'The Left Hand of Darkness',
      author: 'Ursula K. Le Guin',
      readingStatus: 'reading',
    };

    const {store, utils} = createMockCacheUtils({
      bookList: {books: [trackedItem]},
      shelfAll: {
        items: [trackedItem],
        counts: recalculateShelfCounts([trackedItem]),
      },
    });

    applyOptimisticReadingStatusPatch(utils, {
      libraryId: 'lib-1',
      bookId: 'book-2',
      status: 'finished',
    });

    expect(store.bookList?.books[0]?.readingStatus).toBe('finished');
    expect(store.shelfAll?.items[0]?.readingStatus).toBe('finished');
    expect(store.shelfAll?.counts.reading).toBe(0);
    expect(store.shelfAll?.counts.finished).toBe(1);
  });

  it('removes a book from readingTracker.getShelf when status is set to unset', () => {
    const trackedItem: TrackedBookItem = {
      id: 'book-3',
      libraryId: 'lib-1',
      libraryName: 'Main Study',
      isVirtual: false,
      ownershipStatus: 'owned',
      title: 'Invisible Cities',
      author: 'Italo Calvino',
      readingStatus: 'want_to_read',
    };

    const {store, utils} = createMockCacheUtils({
      shelfAll: {
        items: [trackedItem],
        counts: recalculateShelfCounts([trackedItem]),
      },
    });

    applyOptimisticReadingStatusPatch(utils, {
      libraryId: 'lib-1',
      bookId: 'book-3',
      status: 'unset',
    });

    expect(store.shelfAll?.items).toHaveLength(0);
    expect(store.shelfAll?.counts.all).toBe(0);
    expect(store.shelfAll?.counts.want_to_read).toBe(0);
  });

  it('removes deleted books from book.list, getShelf, and getUnreadLibraryBooks', () => {
    const trackedItem: TrackedBookItem = {
      id: 'book-4',
      libraryId: 'lib-1',
      libraryName: 'Main Study',
      isVirtual: false,
      ownershipStatus: 'owned',
      title: 'Ficciones',
      author: 'Jorge Luis Borges',
      readingStatus: 'reading',
    };

    const {store, utils} = createMockCacheUtils({
      bookList: {books: [trackedItem]},
      shelfAll: {
        items: [trackedItem],
        counts: recalculateShelfCounts([trackedItem]),
      },
    });

    removeBookFromReadingCaches(utils, {
      libraryId: 'lib-1',
      bookId: 'book-4',
    });

    expect(store.bookList?.books).toHaveLength(0);
    expect(store.shelfAll?.items).toHaveLength(0);
    expect(store.shelfAll?.counts.reading).toBe(0);
  });

  it('invalidates all reading-status-dependent queries via invalidateReadingStatusQueries', async () => {
    const {utils, invalidations} = createMockCacheUtils();

    await invalidateReadingStatusQueries(utils, {
      libraryId: 'lib-1',
      bookId: 'book-1',
      includeLibraries: true,
    });

    expect(invalidations.shelf).toHaveBeenCalledTimes(1);
    expect(invalidations.unread).toHaveBeenCalledTimes(1);
    expect(invalidations.bookList).toHaveBeenCalledWith({libraryId: 'lib-1'});
    expect(invalidations.bookGet).toHaveBeenCalledWith({
      libraryId: 'lib-1',
      bookId: 'book-1',
    });
    expect(invalidations.libraryGet).toHaveBeenCalledWith({
      libraryId: 'lib-1',
    });
    expect(invalidations.libraryList).toHaveBeenCalledTimes(1);
  });
});
