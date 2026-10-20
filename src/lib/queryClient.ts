import {QueryClient} from '@tanstack/react-query';
import {persistQueryClient} from '@tanstack/react-query-persist-client';
import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister';
import {get, set, del} from 'idb-keyval';
import {DebugTelemetryEngine, estimateStringBytes} from './telemetry';

export const QUERY_CACHE_BUSTER = 'v2.0.0';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days retention in storage
      networkMode: 'offlineFirst', // Serve from cache immediately when offline
      refetchOnWindowFocus: false,
      retry: 2,
    },
    mutations: {
      networkMode: 'offlineFirst',
      retry: 3,
    },
  },
});

function formatQueryKeyLabel(queryKey: readonly unknown[]): string {
  try {
    if (Array.isArray(queryKey) && Array.isArray(queryKey[0])) {
      return (queryKey[0] as string[]).join('.');
    }
    return JSON.stringify(queryKey);
  } catch {
    return 'query';
  }
}

// Attach zero-cost passive cache & mutation telemetry observers
if (typeof window !== 'undefined') {
  queryClient.getQueryCache().subscribe(event => {
    const query = event.query;
    if (!query) return;

    // Ignore internal debug telemetry polling query
    const keyLabel = formatQueryKeyLabel(query.queryKey);
    if (keyLabel.includes('debugTelemetry')) return;

    if (event.type === 'observerAdded') {
      if (!DebugTelemetryEngine.isHudActive()) return;
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
        const err = event.action.error;
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
      const err = event.mutation.state.error;
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

// Configure transparent IndexedDB backing for browser runtime
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  try {
    DebugTelemetryEngine.getInstance().recordIdbPersistenceState('restoring');
    const idbPersister = createAsyncStoragePersister({
      storage: {
        getItem: async (key: string) => {
          try {
            const val = await get<string>(key);
            if (typeof val === 'string') {
              DebugTelemetryEngine.getInstance().recordIdbPersistenceState(
                'hydrated',
                estimateStringBytes(val),
              );
            }
            return val ?? null;
          } catch {
            DebugTelemetryEngine.getInstance().recordIdbPersistenceState(
              'error',
            );
            return null;
          }
        },
        setItem: async (key: string, value: string) => {
          try {
            await set(key, value);
            if (DebugTelemetryEngine.isHudActive()) {
              DebugTelemetryEngine.getInstance().recordIdbPersistenceState(
                'hydrated',
                estimateStringBytes(value),
              );
            }
          } catch {
            // Storage quota or permission error
          }
        },
        removeItem: async (key: string) => {
          try {
            await del(key);
          } catch {
            // Storage cleanup error
          }
        },
      },
    });

    const [, restorePromise] = persistQueryClient({
      queryClient,
      persister: idbPersister,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      buster: QUERY_CACHE_BUSTER,
    });
    if (restorePromise && typeof restorePromise.then === 'function') {
      restorePromise
        .then(() => {
          const currentStatus =
            DebugTelemetryEngine.getInstance().getMetrics().idbPersistStatus;
          if (currentStatus === 'restoring') {
            DebugTelemetryEngine.getInstance().recordIdbPersistenceState(
              'hydrated',
              0,
            );
          }
        })
        .catch(err => {
          DebugTelemetryEngine.getInstance().recordIdbPersistenceState('error');
          console.warn('[QueryClient] Failed to restore persisted cache:', err);
        });
    }
  } catch (err) {
    DebugTelemetryEngine.getInstance().recordIdbPersistenceState('error');
    console.warn(
      '[QueryClient] Failed to initialize IndexedDB persistence:',
      err,
    );
  }
}
