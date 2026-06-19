# Migrating to TanStack Query (React Query)

## Overview

Currently, our application manages asynchronous state (loading data from standard REST APIs and Google Cloud Firestore) manually. Throughout our custom hooks (like `useLibraryData`, `usePickOfTheDay`, and inside `bookApi.ts`), we write boilerplate to manage `loading`, `error`, and `data` states. 

Migrating to **TanStack Query (formerly React Query)** would replace these manual implementations with a battle-tested, robust mechanism for fetching, caching, synchronizing, and updating server state.

## What it Means for Our Codebase

### 1. Deleting Boilerplate
We currently have a lot of code that looks like this:
```typescript
const [data, setData] = useState(null);
const [isLoading, setIsLoading] = useState(true);
const [error, setError] = useState(null);

useEffect(() => {
  let isMounted = true;
  fetchData().then(res => {
     if (isMounted) { setData(res); setIsLoading(false); }
  }).catch(err => {
     if (isMounted) { setError(err); setIsLoading(false); }
  });
  return () => { isMounted = false; };
}, [])
```
TanStack Query reduces this entirely to:
```typescript
const { data, isLoading, error } = useQuery({ queryKey: ['books'], queryFn: fetchData })
```

### 2. Standardizing API Retries
In `src/lib/utils.ts`, we currently maintain custom retry logic for fetching operations. TanStack Query has **built-in exponential backoff** and automatic retries for failed network requests out-of-the-box, allowing us to drop our custom code.

### 3. Smarter Caching & Deduplication
Right now, if two components request the same book details simultaneously, we might fire off two network requests. TanStack Query automatically deduplicates inflight requests across the entire application and caches the results based on robust `queryKeys`.

## How It Would Work (Migration Plan)

### Phase 1: Setup & Initialization
1.  **Install:** `npm install @tanstack/react-query`
2.  **Provide the Client:** Wrap our app in `App.tsx` with `<QueryClientProvider>`:
    ```tsx
    const queryClient = new QueryClient();
    function App() {
      return (
        <QueryClientProvider client={queryClient}>
          {/* App contents */}
        </QueryClientProvider>
      )
    }
    ```

### Phase 2: Migrating REST API Hooks (`usePickOfTheDay`, `bookApi.ts`)
Hooks like `usePickOfTheDay` make standard HTTP requests. We will update these to use `useQuery`.
*   **Before:** Manually managing state, custom `fetch` tracking, and local timeouts.
*   **After:** 
    ```tsx
    export function usePickOfTheDay(libraryId: string) {
      return useQuery({
        queryKey: ['pickOfTheDay', libraryId],
        queryFn: async () => {
          const res = await fetch(`/api/libraries/${libraryId}/recommend`);
          if (!res.ok) throw new Error('Failed to fetch');
          return res.json();
        },
        staleTime: 1000 * 60 * 60 * 24, // Keep it fresh for 24 hours
      });
    }
    ```

### Phase 3: Migrating Firebase Real-time Subscriptions (`useLibraryData`)
Firebase's `onSnapshot` pushes updates rather than relying on standard promisy fetching. TanStack Query supports this beautifully via `queryClient.setQueryData`.
*   We would create a hook `useBooksLive(libraryId)` that sets up the `onSnapshot` listener. Every time Firestore pushes an update, we push the fresh array to the TanStack cache: `queryClient.setQueryData(['books', libraryId], newBooks)`.
*   This grants us the best of both worlds: live WebSocket-style updates, combined with TanStack Query's globally accessible cache, making `books` seamlessly available to *any* component without needing vast Context providers.

### Phase 4: Migrating Mutations (Adds, Edits, Deletes)
In components like the `EditBookForm.tsx` or when using `useBulkEnrichment.ts`, we write data back to the server and update local UI.
*   We would migrate these to `useMutation`.
*   With `useMutation`, we can easily implement **Optimistic Updates**. E.g., when a user deletes a duplicate book, we instantly remove it from the cache using `queryClient.setQueryData`, causing the UI to feel infinitely fast, and only revert if the server request ultimately fails.

## Key Takeaways
By migrating, we would:
1.  **Delete ~30% of our data-management boilerplate** (custom `useState`/`useEffect` chains).
2.  **Improve App Speed** (due to intelligent caching and background fetching).
3.  **Enhance Reliability** (built-in retries, stale-while-revalidate patterns).
