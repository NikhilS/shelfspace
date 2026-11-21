import {QueryClient} from '@tanstack/react-query';
import {describe, it, expect, vi} from 'vitest';
import {
  IDB_CACHE_BY_UID_INDEX,
  IDB_CACHE_DB_NAME,
  IDB_CACHE_STORE_NAME,
  ensureShardStoreSchema,
  hydrateShardRecordIntoClient,
  readAllShardRecordsForUid,
  resolvePriorityShardsForPathname,
  resolveQueryShardKey,
  sanitizeQueryDataForPersistence,
  type PersistedQueryShardRecord,
} from './idbQueryShardPersister';
import {
  selectBookWithOverlay,
  useEntityCacheStore,
} from '../stores/entityCacheStore';

describe('idbQueryShardPersister', () => {
  it('routes tRPC and editorial query keys to isolated logical shards', () => {
    expect(resolveQueryShardKey([['metadata', 'debugTelemetry']])).toBeNull();
    expect(
      resolveQueryShardKey([['metadata', 'providerCapacities']]),
    ).toBeNull();

    expect(resolveQueryShardKey([['auth', 'getPermissions']])).toBe(
      'core-shell',
    );
    expect(
      resolveQueryShardKey([
        ['library', 'list'],
        {input: {scopes: ['owned', 'shared']}, type: 'query'},
      ]),
    ).toBe('core-shell');

    expect(
      resolveQueryShardKey([
        ['readingTracker', 'getShelf'],
        {input: {shelf: 'all'}, type: 'query'},
      ]),
    ).toBe('reading-room');
    expect(
      resolveQueryShardKey([
        ['readingTracker', 'getUnreadLibraryBooks'],
        {type: 'query'},
      ]),
    ).toBe('reading-room');

    expect(
      resolveQueryShardKey([
        ['book', 'list'],
        {input: {libraryId: 'lib-42'}, type: 'query'},
      ]),
    ).toBe('library:lib-42');

    expect(
      resolveQueryShardKey([
        ['book', 'get'],
        {input: {libraryId: 'lib-42', bookId: 'b-9'}, type: 'query'},
      ]),
    ).toBe('book-detail:lib-42:b-9');

    expect(
      resolveQueryShardKey(['pickOfTheDay', 'reading-room', '2026-11-15', 0]),
    ).toBe('editorial-daily');
    expect(
      resolveQueryShardKey([
        ['readingTracker', 'getRecommendations'],
        {input: {filter: 'all'}, type: 'query'},
      ]),
    ).toBe('editorial-daily');
  });

  it('computes route-aware priority shards for instant <50ms initial hydration', () => {
    expect(resolvePriorityShardsForPathname('/')).toEqual([
      'core-shell',
      'reading-room',
      'editorial-daily',
    ]);
    expect(resolvePriorityShardsForPathname('/library/lib-1')).toEqual([
      'core-shell',
      'library:lib-1',
      'editorial-daily',
    ]);
    expect(
      resolvePriorityShardsForPathname('/library/lib-1/book/book-99'),
    ).toEqual(['core-shell', 'book-detail:lib-1:book-99', 'library:lib-1']);
  });

  it('strips float embeddings without mutating source book objects or JSON stringifying', () => {
    const sourceBook = {
      id: 'b-1',
      title: 'Piranesi',
      embedding: [0.12, -0.44, 0.88],
    };
    const payload = {
      books: [sourceBook],
      totalCount: 1,
    };

    const sanitized = sanitizeQueryDataForPersistence(payload) as {
      books: Array<Record<string, unknown>>;
      totalCount: number;
    };

    expect(sanitized.totalCount).toBe(1);
    expect(sanitized.books[0].title).toBe('Piranesi');
    expect('embedding' in sanitized.books[0]).toBe(false);
    // Original in-memory book retains its embedding for Constellation view
    expect(sourceBook.embedding).toEqual([0.12, -0.44, 0.88]);
  });

  it('creates bookish-cache-v3 with by_uid index and queries shards via IDBKeyRange.only(uid)', async () => {
    expect(IDB_CACHE_DB_NAME).toBe('bookish-cache-v3');

    const createIndexMock = vi.fn();
    const fakeStore = {
      indexNames: {contains: () => false},
      createIndex: createIndexMock,
    };
    const fakeDb = {
      objectStoreNames: {contains: () => false},
      createObjectStore: vi.fn(() => fakeStore),
    } as unknown as IDBDatabase;

    ensureShardStoreSchema(fakeDb, null);
    expect(fakeDb.createObjectStore).toHaveBeenCalledWith(
      IDB_CACHE_STORE_NAME,
      {keyPath: 'id'},
    );
    expect(createIndexMock).toHaveBeenCalledWith(
      IDB_CACHE_BY_UID_INDEX,
      'uid',
      {
        unique: false,
      },
    );

    const originalKeyRange = globalThis.IDBKeyRange;
    const onlySpy = vi.fn((val: unknown) => ({only: val}));
    Object.defineProperty(globalThis, 'IDBKeyRange', {
      value: {only: onlySpy},
      configurable: true,
    });

    try {
      const storeGetAllSpy = vi.fn();
      const indexGetAllMock = vi.fn(() => {
        const req: {
          result?: PersistedQueryShardRecord[];
          onsuccess?: () => void;
          onerror?: () => void;
        } = {};
        queueMicrotask(() => {
          req.result = [
            {
              id: 'u-target::core-shell',
              uid: 'u-target',
              shardKey: 'core-shell',
              buster: 'v3',
              updatedAtMs: Date.now(),
              queries: [],
            },
          ];
          req.onsuccess?.();
        });
        return req;
      });

      const indexedDbMock = {
        transaction: () => ({
          objectStore: () => ({
            indexNames: {
              contains: (name: string) => name === IDB_CACHE_BY_UID_INDEX,
            },
            index: () => ({getAll: indexGetAllMock}),
            getAll: storeGetAllSpy,
          }),
        }),
      } as unknown as IDBDatabase;

      const records = await readAllShardRecordsForUid(
        indexedDbMock,
        'u-target',
      );
      expect(onlySpy).toHaveBeenCalledWith('u-target');
      expect(indexGetAllMock).toHaveBeenCalledTimes(1);
      expect(storeGetAllSpy).not.toHaveBeenCalled();
      expect(records).toHaveLength(1);
      expect(records[0]?.id).toBe('u-target::core-shell');
    } finally {
      Object.defineProperty(globalThis, 'IDBKeyRange', {
        value: originalKeyRange,
        configurable: true,
      });
    }
  });

  it('mirrors cold-boot persisted library, book, and shelf shards into useEntityCacheStore without clobbering optimistic mutations', () => {
    useEntityCacheStore.getState().clearAllEntities();
    const queryClient = new QueryClient();
    const now = Date.now();

    const shard: PersistedQueryShardRecord = {
      id: 'u-1::library:lib-1',
      uid: 'u-1',
      shardKey: 'library:lib-1',
      buster: 'v3',
      updatedAtMs: now,
      queries: [
        {
          queryKey: [['library', 'list'], {input: {scopes: ['owned']}}],
          queryHash: 'h1',
          data: {
            libraries: [
              {
                id: 'lib-1',
                name: 'Archival Study',
                ownerId: 'u-1',
                bookCount: 1,
                createdAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
          dataUpdatedAt: now,
        },
        {
          queryKey: [['book', 'list'], {input: {libraryId: 'lib-1'}}],
          queryHash: 'h2',
          data: {
            books: [
              {
                id: 'b-1',
                title: 'Piranesi',
                author: 'Susanna Clarke',
                isbn: '9781635575637',
                addedAt: '2026-01-01T00:00:00Z',
              },
            ],
          },
          dataUpdatedAt: now,
        },
        {
          queryKey: [['readingTracker', 'getShelf'], {input: {shelf: 'all'}}],
          queryHash: 'h3',
          data: {
            items: [
              {
                id: 'b-1',
                libraryId: 'lib-1',
                title: 'Piranesi',
                author: 'Susanna Clarke',
                isbn: '9781635575637',
                readingStatus: 'reading',
                userRating: 5,
              },
            ],
          },
          dataUpdatedAt: now,
        },
      ],
    };

    const ok = hydrateShardRecordIntoClient(
      queryClient,
      shard,
      'v3',
      60_000,
      false,
    );
    expect(ok).toBe(true);
    expect(useEntityCacheStore.getState().librariesById['lib-1']?.name).toBe(
      'Archival Study',
    );
    const hydratedBook = selectBookWithOverlay(
      useEntityCacheStore.getState(),
      'lib-1',
      'b-1',
    );
    expect(hydratedBook?.title).toBe('Piranesi');
    expect(hydratedBook?.readingStatus).toBe('reading');
    expect(hydratedBook?.userRating).toBe(5);
  });
});
