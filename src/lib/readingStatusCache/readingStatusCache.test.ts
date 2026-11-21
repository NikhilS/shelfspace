import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  applyOptimisticBookEditPatch,
  applyOptimisticReadingStatusPatch,
  buildBookSnapshotHint,
  commitBookDeleteDelta,
  commitBookReviewDelta,
  commitBookUpsertDelta,
  commitReadingStatusDelta,
  invalidateReadingStatusQueries,
  normalizeReadingStatus,
  recalculateShelfCounts,
  removeBookFromReadingCaches,
  type ReadingStatusCacheUtils,
} from './index';
import {
  selectBookWithOverlay,
  useEntityCacheStore,
} from '../../stores/entityCacheStore';
import type {
  Book,
  Library,
  ReadingShelfSummary,
  TrackedBookItem,
  UnreadLibraryBookItem,
} from '../../types';

function createMockCacheUtils(initialState?: {
  bookGet?: Book;
  bookList?: {books: Book[]; totalCount?: number};
  reviews?: {
    reviews: Array<{
      id: string;
      userId: string;
      userName: string;
      rating: number;
      text: string;
      createdAt: string;
    }>;
  };
  shelfAll?: ReadingShelfSummary;
  unread?: UnreadLibraryBookItem[];
  libraryName?: string;
  libraryBookCount?: number;
}) {
  const store = {
    bookGet: initialState?.bookGet,
    bookList: initialState?.bookList,
    reviews: initialState?.reviews,
    shelfAll: initialState?.shelfAll,
    unread: initialState?.unread,
    libraryGet: initialState?.libraryName
      ? ({
          id: 'lib-1',
          name: initialState.libraryName,
          ownerId: 'u-1',
          bookCount: initialState.libraryBookCount ?? 1,
        } as Library)
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
              ? ((updater as (old: unknown) => unknown)(store.bookGet) as
                  Book | undefined)
              : (updater as Book | undefined);
        },
        invalidate: invalidations.bookGet,
      },
      list: {
        getData: () => store.bookList,
        setData: (_input, updater) => {
          store.bookList =
            typeof updater === 'function'
              ? ((updater as (old: unknown) => unknown)(store.bookList) as
                  {books: Book[]; totalCount?: number} | undefined)
              : (updater as {books: Book[]; totalCount?: number} | undefined);
        },
        invalidate: invalidations.bookList,
      },
      listReviews: {
        getData: () => store.reviews,
        setData: (_input, updater) => {
          store.reviews =
            typeof updater === 'function'
              ? ((updater as (old: unknown) => unknown)(store.reviews) as
                  typeof store.reviews | undefined)
              : (updater as typeof store.reviews | undefined);
        },
      },
    },
    readingTracker: {
      getShelf: {
        getData: () => store.shelfAll,
        setData: (_input, updater) => {
          store.shelfAll =
            typeof updater === 'function'
              ? ((updater as (old: unknown) => unknown)(store.shelfAll) as
                  ReadingShelfSummary | undefined)
              : (updater as ReadingShelfSummary | undefined);
        },
        invalidate: invalidations.shelf,
      },
      getUnreadLibraryBooks: {
        getData: () => store.unread,
        setData: (_input, updater) => {
          store.unread =
            typeof updater === 'function'
              ? ((updater as (old: unknown) => unknown)(store.unread) as
                  UnreadLibraryBookItem[] | undefined)
              : (updater as UnreadLibraryBookItem[] | undefined);
        },
        invalidate: invalidations.unread,
      },
    },
    library: {
      get: {
        getData: () => store.libraryGet,
        setData: (_input, updater) => {
          store.libraryGet =
            typeof updater === 'function'
              ? ((updater as (old: unknown) => unknown)(store.libraryGet) as
                  Library | undefined)
              : (updater as Library | undefined);
        },
        invalidate: invalidations.libraryGet,
      },
      list: {
        getData: () => (store.libraryGet ? [store.libraryGet] : []),
        setData: () => {},
        invalidate: invalidations.libraryList,
      },
    },
  };

  return {store, utils, invalidations};
}

describe('readingStatusCache', () => {
  beforeEach(() => {
    useEntityCacheStore.getState().clearAllEntities();
  });

  it('normalizes canonical reading status values and maps unrecognized tokens to unset', () => {
    expect(normalizeReadingStatus('finished')).toBe('finished');
    expect(normalizeReadingStatus('reading')).toBe('reading');
    expect(normalizeReadingStatus('want_to_read')).toBe('want_to_read');
    expect(normalizeReadingStatus('abandoned')).toBe('abandoned');
    expect(normalizeReadingStatus('unset')).toBe('unset');
    expect(normalizeReadingStatus('completed')).toBe('unset');
    expect(normalizeReadingStatus(undefined)).toBe('unset');
  });

  it('builds strict-schema-validated <2KB MinimalBookStub hints stripping heavy prose and oversized data URLs', () => {
    const oversizedDataUrl = `data:image/png;base64,${'A'.repeat(2000)}`;
    const snapshot = buildBookSnapshotHint(
      {
        id: 'book-42',
        title: 'Piranesi',
        author: 'Susanna Clarke',
        isbn: '978-1-63557-563-7',
        coverUrl: oversizedDataUrl,
        format: 'physical',
        synopsis: 'Long archival synopsis '.repeat(400),
        authorBio: 'Long author biography '.repeat(400),
        subgenres: ['Mythic Fantasy', 'Labyrinthine Fiction'],
        primaryGenre: 'Fantasy',
      },
      {libraryId: 'lib-1', libraryName: 'Home Study'},
    );

    expect(snapshot).toEqual({
      title: 'Piranesi',
      author: 'Susanna Clarke',
      isbn: '978-1-63557-563-7',
      cleanIsbn: '9781635575637',
      format: 'physical',
      primaryGenre: 'Fantasy',
      libraryId: 'lib-1',
      libraryName: 'Home Study',
      bookId: 'book-42',
    });
    expect('synopsis' in (snapshot || {})).toBe(false);
    expect('authorBio' in (snapshot || {})).toBe(false);
    expect('subgenres' in (snapshot || {})).toBe(false);
    expect('coverUrl' in (snapshot || {})).toBe(false);
  });

  it('inserts an untracked library book into readingTracker.getShelf immediately when marked as reading', () => {
    const sampleBook: Book = {
      id: 'book-1',
      libraryId: 'lib-1',
      title: 'Piranesi',
      author: 'Susanna Clarke',
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
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

    expect(store.bookGet?.readingStatus).toBe('reading');
    expect(store.bookList?.books[0]?.readingStatus).toBe('reading');
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
    expect(store.unread).toHaveLength(0);
    expect(
      useEntityCacheStore.getState().readingStatesByBookKey['book:lib-1:book-1']
        ?.status,
    ).toBe('reading');

    rollback();
    expect(store.bookGet?.readingStatus).toBe('unset');
    expect(store.bookList?.books[0]?.readingStatus).toBe('unset');
    expect(store.shelfAll?.items).toHaveLength(0);
    expect(store.unread).toHaveLength(1);
    expect(
      useEntityCacheStore.getState().readingStatesByBookKey[
        'book:lib-1:book-1'
      ],
    ).toBeUndefined();
  });

  it('prevents stale optimistic rollbacks from clobbering newer committed reading-state mutations', () => {
    const sampleBook: Book = {
      id: 'book-race',
      libraryId: 'lib-1',
      title: 'Solaris',
      author: 'Stanislaw Lem',
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
      readingStatus: 'unset',
    };
    useEntityCacheStore.getState().hydrateLibraryBooks('lib-1', [sampleBook]);

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
      libraryName: 'Home Library',
    });

    const staleRollback = applyOptimisticReadingStatusPatch(utils, {
      libraryId: 'lib-1',
      bookId: 'book-race',
      status: 'reading',
    });

    // Newer mutation succeeds and commits 'finished'
    commitReadingStatusDelta(utils, {
      libraryId: 'lib-1',
      bookId: 'book-race',
      status: 'finished',
    });

    // Earlier in-flight mutation errors out and attempts rollback
    staleRollback();

    expect(store.bookGet?.readingStatus).toBe('finished');
    expect(store.bookList?.books[0]?.readingStatus).toBe('finished');
    expect(
      selectBookWithOverlay(
        useEntityCacheStore.getState(),
        'lib-1',
        'book-race',
      )?.readingStatus,
    ).toBe('finished');
  });

  it('patches single-book edits optimistically across entity store and query caches with version-guarded rollback', () => {
    const sampleBook: Book = {
      id: 'book-edit',
      libraryId: 'lib-1',
      title: 'The Tombs of Atuan',
      author: 'Ursula K. Le Guin',
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
      readingStatus: 'reading',
    };
    const trackedItem: TrackedBookItem = {
      ...sampleBook,
      libraryId: 'lib-1',
      libraryName: 'Main Study',
      isVirtual: false,
      ownershipStatus: 'owned',
      readingStatus: 'reading',
    };
    useEntityCacheStore.getState().hydrateLibraryBooks('lib-1', [sampleBook]);

    const {store, utils} = createMockCacheUtils({
      bookGet: sampleBook,
      bookList: {books: [sampleBook]},
      shelfAll: {
        items: [trackedItem],
        counts: recalculateShelfCounts([trackedItem]),
      },
      libraryName: 'Main Study',
    });

    const rollbackEdit = applyOptimisticBookEditPatch(utils, {
      libraryId: 'lib-1',
      bookId: 'book-edit',
      patch: {
        title: 'The Tombs of Atuan (Illustrated)',
        series: 'Earthsea Cycle',
      },
      bookHint: sampleBook,
    });

    expect(store.bookGet?.title).toBe('The Tombs of Atuan (Illustrated)');
    expect(store.bookList?.books[0]?.series).toBe('Earthsea Cycle');
    expect(store.shelfAll?.items[0]?.title).toBe(
      'The Tombs of Atuan (Illustrated)',
    );
    expect(
      selectBookWithOverlay(
        useEntityCacheStore.getState(),
        'lib-1',
        'book-edit',
      )?.title,
    ).toBe('The Tombs of Atuan (Illustrated)');

    // Supersede with authoritative server upsert
    commitBookUpsertDelta(utils, {
      libraryId: 'lib-1',
      book: {
        id: 'book-edit',
        title: 'The Tombs of Atuan (Restored Edition)',
        author: 'Ursula K. Le Guin',
        series: 'Earthsea Cycle',
        readingStatus: 'reading',
      },
      libraryName: 'Main Study',
    });

    // Stale rollback must not overwrite authoritative upsert
    rollbackEdit();
    expect(store.bookGet?.title).toBe('The Tombs of Atuan (Restored Edition)');
    expect(
      selectBookWithOverlay(
        useEntityCacheStore.getState(),
        'lib-1',
        'book-edit',
      )?.title,
    ).toBe('The Tombs of Atuan (Restored Edition)');
  });

  it('commits authoritative status, book upsert, review, and delete deltas with zero invalidations', () => {
    const {store, utils, invalidations} = createMockCacheUtils({
      bookList: {books: [], totalCount: 0},
      reviews: {
        reviews: [
          {
            id: 'temp-1',
            userId: 'u-1',
            userName: 'Reader',
            rating: 5,
            text: 'Draft',
            createdAt: '2026-11-15T00:00:00.000Z',
          },
        ],
      },
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
      unread: [],
      libraryName: 'Main Study',
      libraryBookCount: 0,
    });

    commitBookUpsertDelta(utils, {
      libraryId: 'lib-1',
      book: {
        id: 'book-10',
        title: 'Exhalation',
        author: 'Ted Chiang',
        readingStatus: 'reading',
      },
      libraryName: 'Main Study',
      bookCountDelta: 1,
    });

    expect(store.bookList?.books).toHaveLength(1);
    expect(store.bookList?.totalCount).toBe(1);
    expect(store.libraryGet?.bookCount).toBe(1);
    expect(store.shelfAll?.counts.reading).toBe(1);
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'book-10')
        ?.title,
    ).toBe('Exhalation');

    commitReadingStatusDelta(utils, {
      libraryId: 'lib-1',
      bookId: 'book-10',
      status: 'finished',
      finishedAt: '2026-11-15T12:00:00.000Z',
    });
    expect(store.shelfAll?.counts.finished).toBe(1);
    expect(store.shelfAll?.items[0]?.finishedAt).toBe(
      '2026-11-15T12:00:00.000Z',
    );

    commitBookReviewDelta(utils, {
      libraryId: 'lib-1',
      bookId: 'book-10',
      review: {
        id: 'u-1',
        userId: 'u-1',
        userName: 'Reader',
        rating: 5,
        text: 'Masterpiece.',
        createdAt: '2026-11-15T12:05:00.000Z',
      },
    });
    expect(store.reviews?.reviews).toHaveLength(1);
    expect(store.reviews?.reviews[0]?.id).toBe('u-1');
    expect(store.bookList?.books[0]?.userRating).toBe(5);
    expect(store.shelfAll?.items[0]?.userRating).toBe(5);
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'book-10')
        ?.userRating,
    ).toBe(5);

    commitBookDeleteDelta(utils, {
      libraryId: 'lib-1',
      bookId: 'book-10',
    });
    expect(store.bookList?.books).toHaveLength(0);
    expect(store.bookList?.totalCount).toBe(0);
    expect(store.libraryGet?.bookCount).toBe(0);
    expect(store.shelfAll?.items).toHaveLength(0);
    expect(
      selectBookWithOverlay(useEntityCacheStore.getState(), 'lib-1', 'book-10'),
    ).toBeUndefined();

    expect(invalidations.bookList).not.toHaveBeenCalled();
    expect(invalidations.shelf).not.toHaveBeenCalled();
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
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
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
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
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
      format: 'physical',
      addedAt: '2026-01-01T00:00:00.000Z',
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
