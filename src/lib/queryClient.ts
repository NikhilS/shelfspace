import {QueryClient} from '@tanstack/react-query';
import {readAuthShellSnapshot} from './authTokenCache';
import {
  attachShardedQueryPersistence,
  clearPersistedQueryShards,
} from './idbQueryShardPersister';
import {DebugTelemetryEngine} from './telemetry';

export const QUERY_CACHE_BUSTER = 'v2.1.0';
const SEVEN_DAYS_MS = 1000 * 60 * 60 * 24 * 7;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: SEVEN_DAYS_MS, // 7 days retention in storage
      networkMode: 'offlineFirst', // Serve from cache immediately when offline or booting
      refetchOnWindowFocus: false,
      retry: 2,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 3,
    },
  },
});

let activePersistenceUid: string | null =
  typeof window !== 'undefined' ? (readAuthShellSnapshot()?.uid ?? null) : null;

export function setActivePersistenceUid(uid: string | null): void {
  activePersistenceUid = uid;
}

function getActivePersistenceUid(): string {
  if (activePersistenceUid) {
    return activePersistenceUid;
  }
  const snapshotUid = readAuthShellSnapshot()?.uid;
  if (snapshotUid) {
    activePersistenceUid = snapshotUid;
    return snapshotUid;
  }
  return 'anon';
}

export async function resetClientQueryCaches(uid?: string): Promise<void> {
  queryClient.clear();
  await clearPersistedQueryShards(uid);
}

function formatQueryKeyLabel(queryKey: readonly unknown[]): string {
  try {
    if (Array.isArray(queryKey) && Array.isArray(queryKey[0])) {
      return (queryKey[0] as string[]).join('.');
    }
    return String(queryKey[0] ?? 'query');
  } catch {
    return 'query';
  }
}

// Attach zero-cost passive cache & mutation telemetry observers
if (typeof window !== 'undefined') {
  queryClient.getQueryCache().subscribe(event => {
    const query = event.query;
    if (!query) {
      return;
    }

    const rawQueryKey: unknown = query.queryKey;
    const keyLabel = formatQueryKeyLabel(
      Array.isArray(rawQueryKey) ? (rawQueryKey as readonly unknown[]) : [],
    );
    if (keyLabel.includes('debugTelemetry')) {
      return;
    }

    if (event.type === 'observerAdded') {
      if (!DebugTelemetryEngine.isHudActive()) {
        return;
      }
      if (
        query.state.status === 'success' &&
        query.state.fetchStatus === 'idle' &&
        !query.isStale()
      ) {
        DebugTelemetryEngine.getInstance().recordCacheAccess(true, keyLabel);
      }
    } else if (event.type === 'updated') {
      if (event.action.type === 'fetch') {
        if (DebugTelemetryEngine.isHudActive()) {
          DebugTelemetryEngine.getInstance().recordCacheAccess(false, keyLabel);
        }
      } else if (event.action.type === 'error') {
        const err: unknown = event.action.error;
        DebugTelemetryEngine.getInstance().addLog(
          'error',
          `[Cache] Query "${keyLabel}" failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
          {
            scope: 'Cache',
            status: 'error',
            stack: err instanceof Error ? err.stack : undefined,
          },
        );
      }
    }
  });

  queryClient.getMutationCache().subscribe(event => {
    if (event.type === 'updated' && event.mutation.state.status === 'error') {
      const err: unknown = event.mutation.state.error;
      const mutKey = event.mutation.options.mutationKey
        ? formatQueryKeyLabel(event.mutation.options.mutationKey)
        : 'mutation';
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        `[Mutation] "${mutKey}" failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err,
        {
          scope: 'tRPC',
          status: 'error',
          stack: err instanceof Error ? err.stack : undefined,
        },
      );
    }
  });
}

let queryCacheRestored =
  typeof window === 'undefined' || typeof indexedDB === 'undefined';
const restoreListeners = new Set<() => void>();

function markQueryCacheRestored(): void {
  if (queryCacheRestored) {
    return;
  }
  queryCacheRestored = true;
  for (const listener of restoreListeners) {
    listener();
  }
  restoreListeners.clear();
}

export function isQueryCacheRestored(): boolean {
  return queryCacheRestored;
}

export function subscribeToQueryCacheRestore(listener: () => void): () => void {
  if (queryCacheRestored) {
    listener();
    return () => {};
  }
  restoreListeners.add(listener);
  return () => {
    restoreListeners.delete(listener);
  };
}

// Configure sharded structured-clone IndexedDB backing for browser runtime
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  const isOffline =
    typeof navigator !== 'undefined' && navigator.onLine === false;
  const safetyTimeoutMs = isOffline ? 600 : 150;
  const safetyTimer = setTimeout(() => {
    markQueryCacheRestored();
  }, safetyTimeoutMs);

  try {
    DebugTelemetryEngine.getInstance().recordIdbPersistenceState('restoring');
    attachShardedQueryPersistence(queryClient, {
      buster: QUERY_CACHE_BUSTER,
      maxAgeMs: SEVEN_DAYS_MS,
      getActiveUid: getActivePersistenceUid,
      getPathname: () => window.location.pathname,
      onInitialRestoreComplete: () => {
        clearTimeout(safetyTimer);
        markQueryCacheRestored();
        const currentStatus =
          DebugTelemetryEngine.getInstance().getMetrics().idbPersistStatus;
        if (currentStatus === 'restoring') {
          DebugTelemetryEngine.getInstance().recordIdbPersistenceState(
            'hydrated',
            0,
          );
        }
      },
      onHydratedShardCount: shardCount => {
        if (DebugTelemetryEngine.isHudActive()) {
          DebugTelemetryEngine.getInstance().recordIdbPersistenceState(
            'hydrated',
            shardCount * 1024,
          );
        }
      },
      onError: err => {
        clearTimeout(safetyTimer);
        markQueryCacheRestored();
        DebugTelemetryEngine.getInstance().recordIdbPersistenceState('error');
        console.warn(
          '[QueryClient] Failed to restore persisted query shards:',
          err,
        );
      },
    });
  } catch (err) {
    clearTimeout(safetyTimer);
    markQueryCacheRestored();
    DebugTelemetryEngine.getInstance().recordIdbPersistenceState('error');
    console.warn(
      '[QueryClient] Failed to initialize sharded IndexedDB persistence:',
      err,
    );
  }
}
