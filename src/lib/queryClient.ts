import {QueryClient} from '@tanstack/react-query';
import {persistQueryClient} from '@tanstack/react-query-persist-client';
import {createAsyncStoragePersister} from '@tanstack/query-async-storage-persister';
import {get, set, del} from 'idb-keyval';

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

// Configure transparent IndexedDB backing for browser runtime
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  try {
    const idbPersister = createAsyncStoragePersister({
      storage: {
        getItem: async (key: string) => {
          try {
            return await get(key);
          } catch {
            return null;
          }
        },
        setItem: async (key: string, value: string) => {
          try {
            await set(key, value);
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

    void persistQueryClient({
      queryClient,
      persister: idbPersister,
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
      buster: 'v1.0.0',
    });
  } catch (err) {
    console.warn(
      '[QueryClient] Failed to initialize IndexedDB persistence:',
      err,
    );
  }
}
