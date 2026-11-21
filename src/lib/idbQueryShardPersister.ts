import type {QueryClient} from '@tanstack/react-query';
import {hydrateEntityStoreFromPersistedQuery} from '../stores/entityCacheHelpers';
import {useEntityCacheStore} from '../stores/entityCacheStore';

export const IDB_CACHE_DB_NAME = 'bookish-cache-v3';
export const IDB_CACHE_STORE_NAME = 'shards';
export const IDB_CACHE_BY_UID_INDEX = 'by_uid';
const IDB_CACHE_DB_VERSION = 3;
const FLUSH_DEBOUNCE_MS = 250;

export interface PersistedQueryEntry {
  queryKey: readonly unknown[];
  queryHash: string;
  data: unknown;
  dataUpdatedAt: number;
}

export interface PersistedQueryShardRecord {
  id: string;
  uid: string;
  shardKey: string;
  buster: string;
  updatedAtMs: number;
  queries: PersistedQueryEntry[];
}

export interface AttachShardedPersistenceOptions {
  buster: string;
  maxAgeMs: number;
  getActiveUid: () => string;
  getPathname?: () => string;
  onInitialRestoreComplete: () => void;
  onHydratedShardCount?: (shardCount: number) => void;
  onError?: (err: unknown) => void;
}

function extractProcedureAndInput(queryKey: readonly unknown[]): {
  procedure: string;
  input: Record<string, unknown> | undefined;
} {
  if (queryKey.length === 0) {
    return {procedure: '', input: undefined};
  }
  const first: unknown = queryKey[0];
  if (Array.isArray(first)) {
    const procedure = (first as readonly unknown[])
      .filter((part): part is string => typeof part === 'string')
      .join('.');
    const second: unknown = queryKey[1];
    if (second && typeof second === 'object' && !Array.isArray(second)) {
      const maybeTrpcWrapper = second as {input?: unknown};
      if (
        maybeTrpcWrapper.input &&
        typeof maybeTrpcWrapper.input === 'object' &&
        !Array.isArray(maybeTrpcWrapper.input)
      ) {
        return {
          procedure,
          input: maybeTrpcWrapper.input as Record<string, unknown>,
        };
      }
      return {procedure, input: second as Record<string, unknown>};
    }
    return {procedure, input: undefined};
  }
  if (typeof first === 'string') {
    return {procedure: first, input: undefined};
  }
  return {procedure: '', input: undefined};
}

/**
 * Maps a TanStack Query key to a logical IndexedDB shard key so mutations only
 * flush the touched domain slice rather than re-serializing the entire app cache.
 */
export function resolveQueryShardKey(
  queryKey: readonly unknown[],
): string | null {
  const {procedure, input} = extractProcedureAndInput(queryKey);
  if (!procedure) {
    return null;
  }
  if (
    procedure === 'metadata.debugTelemetry' ||
    procedure === 'metadata.providerCapacities'
  ) {
    return null;
  }

  if (
    procedure === 'auth.getPermissions' ||
    procedure === 'library.list' ||
    procedure.startsWith('user.')
  ) {
    return 'core-shell';
  }

  if (
    procedure === 'readingTracker.getShelf' ||
    procedure === 'readingTracker.getUnreadLibraryBooks'
  ) {
    return 'reading-room';
  }

  if (
    procedure === 'pickOfTheDay' ||
    procedure === 'readingTracker.getRecommendations'
  ) {
    return 'editorial-daily';
  }

  const libraryId =
    typeof input?.libraryId === 'string' && input.libraryId.length > 0
      ? input.libraryId
      : undefined;
  const bookId =
    typeof input?.bookId === 'string' && input.bookId.length > 0
      ? input.bookId
      : undefined;

  if (
    (procedure === 'book.get' || procedure === 'book.listReviews') &&
    libraryId &&
    bookId
  ) {
    return `book-detail:${libraryId}:${bookId}`;
  }

  if ((procedure === 'library.get' || procedure === 'book.list') && libraryId) {
    return `library:${libraryId}`;
  }

  return 'misc';
}

/**
 * Computes the minimal set of priority shards needed for an instant (<50ms) first
 * paint of the current route before remaining shards hydrate during idle frames.
 */
export function resolvePriorityShardsForPathname(pathname: string): string[] {
  const shards = new Set<string>(['core-shell']);
  const cleanPath = (pathname || '/').split('?')[0] || '/';

  if (cleanPath === '/' || cleanPath.startsWith('/reading')) {
    shards.add('reading-room');
    shards.add('editorial-daily');
    return Array.from(shards);
  }

  const bookDetailMatch = /^\/library\/([^/]+)\/book\/([^/]+)/.exec(cleanPath);
  if (bookDetailMatch) {
    const libId = decodeURIComponent(bookDetailMatch[1]);
    const bId = decodeURIComponent(bookDetailMatch[2]);
    shards.add(`book-detail:${libId}:${bId}`);
    shards.add(`library:${libId}`);
    return Array.from(shards);
  }

  const libraryMatch = /^\/library\/([^/]+)/.exec(cleanPath);
  if (libraryMatch) {
    const libId = decodeURIComponent(libraryMatch[1]);
    shards.add(`library:${libId}`);
    shards.add('editorial-daily');
    return Array.from(shards);
  }

  shards.add('reading-room');
  return Array.from(shards);
}

function stripEmbeddingFromBookRecord(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return item;
  }
  const record = item as Record<string, unknown>;
  if (!('embedding' in record) || record.embedding === undefined) {
    return item;
  }
  const clone = {...record};
  delete clone.embedding;
  return clone;
}

/**
 * Strips high-dimensional float `embedding` arrays prior to IndexedDB structured
 * cloning while preserving native JS objects/arrays (zero `JSON.stringify`).
 */
export function sanitizeQueryDataForPersistence(data: unknown): unknown {
  if (!data || typeof data !== 'object') {
    return data;
  }
  if (Array.isArray(data)) {
    let changed = false;
    const mapped = data.map(entry => {
      const stripped = stripEmbeddingFromBookRecord(entry);
      if (stripped !== entry) {
        changed = true;
      }
      return stripped;
    });
    return changed ? mapped : data;
  }

  const record = data as Record<string, unknown>;
  if (Array.isArray(record.books)) {
    let changed = false;
    const nextBooks = record.books.map(entry => {
      const stripped = stripEmbeddingFromBookRecord(entry);
      if (stripped !== entry) {
        changed = true;
      }
      return stripped;
    });
    return changed ? {...record, books: nextBooks} : data;
  }

  return stripEmbeddingFromBookRecord(data);
}

let sharedDbPromise: Promise<IDBDatabase | null> | null = null;

export function ensureShardStoreSchema(
  db: IDBDatabase,
  upgradeTx: IDBTransaction | null,
): void {
  let store: IDBObjectStore | null = null;
  if (!db.objectStoreNames.contains(IDB_CACHE_STORE_NAME)) {
    store = db.createObjectStore(IDB_CACHE_STORE_NAME, {keyPath: 'id'});
  } else if (upgradeTx) {
    store = upgradeTx.objectStore(IDB_CACHE_STORE_NAME);
  }
  if (store && !store.indexNames.contains(IDB_CACHE_BY_UID_INDEX)) {
    store.createIndex(IDB_CACHE_BY_UID_INDEX, 'uid', {unique: false});
  }
}

function openShardDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    return Promise.resolve(null);
  }
  if (sharedDbPromise) {
    return sharedDbPromise;
  }
  sharedDbPromise = new Promise<IDBDatabase | null>(resolve => {
    try {
      const request = indexedDB.open(IDB_CACHE_DB_NAME, IDB_CACHE_DB_VERSION);
      request.onupgradeneeded = () => {
        ensureShardStoreSchema(request.result, request.transaction);
      };
      request.onsuccess = () => {
        resolve(request.result);
      };
      request.onerror = () => {
        sharedDbPromise = null;
        resolve(null);
      };
      request.onblocked = () => {
        sharedDbPromise = null;
        resolve(null);
      };
    } catch {
      sharedDbPromise = null;
      resolve(null);
    }
  });
  return sharedDbPromise;
}

function readShardRecordsByIds(
  db: IDBDatabase,
  ids: string[],
): Promise<PersistedQueryShardRecord[]> {
  if (ids.length === 0) {
    return Promise.resolve([]);
  }
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_CACHE_STORE_NAME);
      const results: PersistedQueryShardRecord[] = [];
      let pending = ids.length;

      const onItemDone = () => {
        pending -= 1;
        if (pending <= 0) {
          resolve(results);
        }
      };

      for (const id of ids) {
        const req = store.get(id);
        req.onsuccess = () => {
          if (req.result) {
            results.push(req.result as PersistedQueryShardRecord);
          }
          onItemDone();
        };
        req.onerror = () => {
          onItemDone();
        };
      }
    } catch {
      resolve([]);
    }
  });
}

export function readAllShardRecordsForUid(
  db: IDBDatabase,
  uid: string,
): Promise<PersistedQueryShardRecord[]> {
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_CACHE_STORE_NAME, 'readonly');
      const store = tx.objectStore(IDB_CACHE_STORE_NAME);
      if (
        store.indexNames.contains(IDB_CACHE_BY_UID_INDEX) &&
        typeof IDBKeyRange !== 'undefined' &&
        typeof IDBKeyRange.only === 'function'
      ) {
        const idxReq = store
          .index(IDB_CACHE_BY_UID_INDEX)
          .getAll(IDBKeyRange.only(uid));
        idxReq.onsuccess = () => {
          const raw = Array.isArray(idxReq.result)
            ? (idxReq.result as PersistedQueryShardRecord[])
            : [];
          resolve(raw.filter(entry => Boolean(entry && entry.uid === uid)));
        };
        idxReq.onerror = () => {
          resolve([]);
        };
        return;
      }

      const req = store.getAll();
      req.onsuccess = () => {
        const raw = Array.isArray(req.result)
          ? (req.result as PersistedQueryShardRecord[])
          : [];
        resolve(raw.filter(entry => entry && entry.uid === uid));
      };
      req.onerror = () => {
        resolve([]);
      };
    } catch {
      resolve([]);
    }
  });
}

function writeShardRecords(
  db: IDBDatabase,
  records: PersistedQueryShardRecord[],
  emptyIdsToDelete: string[],
): Promise<void> {
  if (records.length === 0 && emptyIdsToDelete.length === 0) {
    return Promise.resolve();
  }
  return new Promise(resolve => {
    try {
      const tx = db.transaction(IDB_CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_CACHE_STORE_NAME);
      for (const record of records) {
        store.put(record);
      }
      for (const id of emptyIdsToDelete) {
        store.delete(id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

export function hydrateShardRecordIntoClient(
  queryClient: QueryClient,
  record: PersistedQueryShardRecord,
  buster: string,
  maxAgeMs: number,
  skipExisting: boolean,
): boolean {
  if (record.buster !== buster) {
    return false;
  }
  const now = Date.now();
  if (now - record.updatedAtMs > maxAgeMs) {
    return false;
  }
  let hydratedAny = false;
  for (const entry of record.queries) {
    if (!entry || !Array.isArray(entry.queryKey)) {
      continue;
    }
    if (now - entry.dataUpdatedAt > maxAgeMs) {
      continue;
    }
    if (
      skipExisting &&
      queryClient.getQueryData(entry.queryKey) !== undefined
    ) {
      continue;
    }
    queryClient.setQueryData(entry.queryKey, entry.data, {
      updatedAt: entry.dataUpdatedAt,
    });
    const {procedure, input} = extractProcedureAndInput(entry.queryKey);
    if (procedure) {
      hydrateEntityStoreFromPersistedQuery(
        useEntityCacheStore.getState(),
        procedure,
        input,
        entry.data,
      );
    }
    hydratedAny = true;
  }
  return hydratedAny;
}

/**
 * Deletes persisted IndexedDB query shards for a specific user (or all users on logout).
 */
export async function clearPersistedQueryShards(uid?: string): Promise<void> {
  const db = await openShardDatabase();
  if (!db) {
    return;
  }
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(IDB_CACHE_STORE_NAME, 'readwrite');
      const store = tx.objectStore(IDB_CACHE_STORE_NAME);
      if (!uid) {
        store.clear();
      } else if (
        store.indexNames.contains(IDB_CACHE_BY_UID_INDEX) &&
        typeof IDBKeyRange !== 'undefined' &&
        typeof IDBKeyRange.only === 'function'
      ) {
        const indexedKeysReq = store
          .index(IDB_CACHE_BY_UID_INDEX)
          .getAllKeys(IDBKeyRange.only(uid));
        indexedKeysReq.onsuccess = () => {
          const keys = Array.isArray(indexedKeysReq.result)
            ? indexedKeysReq.result
            : [];
          for (const key of keys) {
            store.delete(key);
          }
        };
      } else {
        const allKeysReq = store.getAllKeys();
        allKeysReq.onsuccess = () => {
          const prefix = `${uid}::`;
          const keys = Array.isArray(allKeysReq.result)
            ? allKeysReq.result
            : [];
          for (const key of keys) {
            if (typeof key === 'string' && key.startsWith(prefix)) {
              store.delete(key);
            }
          }
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Attaches two-phase priority shard restoration and dirty-shard structured-clone
 * persistence to a TanStack `QueryClient`.
 */
export function attachShardedQueryPersistence(
  queryClient: QueryClient,
  options: AttachShardedPersistenceOptions,
): () => void {
  const dirtyShards = new Set<string>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flushDirtyShards = async () => {
    flushTimer = null;
    if (disposed || dirtyShards.size === 0) {
      return;
    }
    const uid = options.getActiveUid();
    if (!uid || uid === 'anon') {
      dirtyShards.clear();
      return;
    }

    const shardsToFlush = Array.from(dirtyShards);
    dirtyShards.clear();

    const db = await openShardDatabase();
    if (!db || disposed) {
      return;
    }

    const allQueries = queryClient.getQueryCache().getAll();
    const queriesByShard = new Map<string, PersistedQueryEntry[]>();
    for (const shardKey of shardsToFlush) {
      queriesByShard.set(shardKey, []);
    }

    for (const query of allQueries) {
      if (query.state.status !== 'success' || query.state.data === undefined) {
        continue;
      }
      const shardKey = resolveQueryShardKey(query.queryKey);
      if (!shardKey || !queriesByShard.has(shardKey)) {
        continue;
      }
      const bucket = queriesByShard.get(shardKey);
      if (bucket) {
        bucket.push({
          queryKey: query.queryKey,
          queryHash: query.queryHash,
          data: sanitizeQueryDataForPersistence(query.state.data),
          dataUpdatedAt: query.state.dataUpdatedAt || Date.now(),
        });
      }
    }

    const recordsToPut: PersistedQueryShardRecord[] = [];
    const emptyIdsToDelete: string[] = [];
    const now = Date.now();

    for (const [shardKey, entries] of queriesByShard.entries()) {
      const id = `${uid}::${shardKey}`;
      if (entries.length === 0) {
        emptyIdsToDelete.push(id);
      } else {
        recordsToPut.push({
          id,
          uid,
          shardKey,
          buster: options.buster,
          updatedAtMs: now,
          queries: entries,
        });
      }
    }

    await writeShardRecords(db, recordsToPut, emptyIdsToDelete);
  };

  const scheduleFlush = (shardKey: string) => {
    if (disposed) {
      return;
    }
    dirtyShards.add(shardKey);
    if (flushTimer !== null) {
      return;
    }
    flushTimer = setTimeout(() => {
      void flushDirtyShards();
    }, FLUSH_DEBOUNCE_MS);
  };

  const unsubscribeCache = queryClient.getQueryCache().subscribe(event => {
    if (disposed || !event.query) {
      return;
    }
    if (
      (event.type === 'updated' &&
        event.query.state.status === 'success' &&
        event.action.type === 'success') ||
      event.type === 'removed'
    ) {
      const rawQueryKey: unknown = event.query.queryKey;
      const safeKey = Array.isArray(rawQueryKey)
        ? (rawQueryKey as readonly unknown[])
        : [];
      const shardKey = resolveQueryShardKey(safeKey);
      if (shardKey) {
        scheduleFlush(shardKey);
      }
    }
  });

  // Two-phase non-blocking startup hydration
  void (async () => {
    try {
      const uid = options.getActiveUid();
      if (!uid || uid === 'anon') {
        options.onInitialRestoreComplete();
        return;
      }

      const db = await openShardDatabase();
      if (!db || disposed) {
        options.onInitialRestoreComplete();
        return;
      }

      const pathname = options.getPathname?.() ?? '/';
      const priorityShardKeys = resolvePriorityShardsForPathname(pathname);
      const priorityIds = priorityShardKeys.map(key => `${uid}::${key}`);

      // Phase 1: Hydrate priority shards for active route and unblock first paint
      const priorityRecords = await readShardRecordsByIds(db, priorityIds);
      let hydratedCount = 0;
      for (const record of priorityRecords) {
        if (
          hydrateShardRecordIntoClient(
            queryClient,
            record,
            options.buster,
            options.maxAgeMs,
            false,
          )
        ) {
          hydratedCount += 1;
        }
      }
      options.onInitialRestoreComplete();

      if (disposed) {
        return;
      }

      // Phase 2: Hydrate remaining shards in idle callback
      const prioritySet = new Set<string>(priorityIds);
      const runIdleHydration = () => {
        if (disposed) {
          return;
        }
        void readAllShardRecordsForUid(db, uid).then(allRecords => {
          if (disposed) {
            return;
          }
          for (const record of allRecords) {
            if (prioritySet.has(record.id)) {
              continue;
            }
            if (
              hydrateShardRecordIntoClient(
                queryClient,
                record,
                options.buster,
                options.maxAgeMs,
                true,
              )
            ) {
              hydratedCount += 1;
            }
          }
          options.onHydratedShardCount?.(hydratedCount);
        });
      };

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        window.requestIdleCallback(runIdleHydration);
      } else {
        setTimeout(runIdleHydration, 32);
      }
    } catch (err) {
      options.onInitialRestoreComplete();
      options.onError?.(err);
    }
  })();

  return () => {
    disposed = true;
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    unsubscribeCache();
  };
}
