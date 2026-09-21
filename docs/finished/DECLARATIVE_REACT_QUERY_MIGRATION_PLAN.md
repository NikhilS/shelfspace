# Implementation Plan: Declarative TanStack React Query Migration (Option A)

## 1. Executive Summary & Objective

The objective of this plan is to eliminate the pseudo-global cache anti-pattern currently present in `useLibraryData.ts` and related data-fetching layers.

Currently, TanStack React Query is wrapped around the application, but its core strengths—automatic deduplication, query lifecycle state machines, window focus revalidation, error backoff, and garbage collection—are bypassed by manual `useEffect` subscriptions, `queryClient.setQueryData` synchronizations, and raw string query keys (`['books', libraryId]`, `['library', libraryId]`).

### Target Outcome
Transition the entire library and book consumption lifecycle to **Declarative TanStack Query via tRPC (`trpc.library` & `trpc.book`)**:
1. **Single Source of Truth**: All component subscriptions read directly from declarative query hooks (`trpc.library.get.useQuery`, `trpc.book.list.useQuery`).
2. **Zero Manual Cache Mirroring**: Eliminate all `useEffect` blocks that manually mirror data via `setQueryData`.
3. **No State Tearing**: Replace manual boolean state flags (`isCachedFirstPaint`, `isBooksLoading`, `isSyncing`) with native TanStack Query status indicators (`isLoading`, `isFetching`, `isPending`, `isPlaceholderData`).
4. **Type-Safe Cache Mutations**: Replace hardcoded array keys with `trpc.useUtils()` (`utils.book.list`, `utils.library.get`).

---

## 2. Current State vs. Target State Comparison

| Feature | Current Imperative Pattern (Anti-Pattern) | Target Declarative Architecture (Option A) |
| :--- | :--- | :--- |
| **Query Invocation** | Calls `trpc.book.list.useQuery` with manual `initialData` fetching from raw string key `['books', libraryId]`. | Pure `trpc.book.list.useQuery({ libraryId })` utilizing standard `staleTime` and TanStack Query cache. |
| **Cache Synchronization** | `useEffect` monitors query responses and imperatively calls `queryClient.setQueryData(['books', libraryId], bookList)`. | Removed completely. Query data flows directly to consuming components. |
| **Loading / Syncing States** | Manually computed `const isLoading = trpcLibraryQuery.isLoading && !library;` + `isSyncing = isFetching && !isLoading`. | Derived directly from native TanStack Query flags: `libraryQuery.isLoading`, `booksQuery.isFetching`, `booksQuery.isPending`. |
| **Warmup / Pre-seeding** | `LibraryCard` on hover calls `queryClient.setQueryData(['library', lib.id], lib)`. | `LibraryCard` on hover calls `utils.library.get.setData({ libraryId: lib.id }, lib)`. |
| **Optimistic Mutations** | `useSpruceUp` manually modifies `queryClient.setQueryData(['books', libraryId], ...)`. | `useSpruceUp` uses `utils.book.list.setData({ libraryId }, ...)`. |
| **Error Handling** | `useEffect` watching `trpcLibraryQuery.error` triggering `toast.error` + `navigate('/')`. | Retained in `useEffect` on `libraryQuery.isError` (or handled via Error Boundaries). |

---

## 3. Comprehensive Codebase Inventory of Impacted Files

```
src/
├── hooks/
│   ├── useLibraryData.ts               [MAJOR REWRITE: Purge useEffect sync & raw keys]
│   ├── useLibraryData.test.ts          [UPDATE: Rewrite tests to mock tRPC & test declarative states]
│   └── useConstellationData.ts        [VERIFY: Confirm consumer compatibility]
├── pages/
│   ├── LibraryView.tsx                 [VERIFY: Verify loading & syncing bindings]
│   ├── WorldMap.tsx                    [VERIFY: Verify books consumer]
│   ├── TimelineView.tsx                [VERIFY: Verify books consumer]
│   ├── dashboard/
│   │   ├── LibraryCard.tsx             [UPDATE: Migrate cache warmup to trpc.useUtils()]
│   │   └── useLibraries.ts             [UPDATE: Migrate cache pre-seeding to trpc.useUtils()]
│   └── spruce-up/
│       └── useSpruceUp.ts              [UPDATE: Migrate optimistic deletion to trpc.useUtils()]
├── components/
│   └── DebugConsoleHUD.test.tsx        [UPDATE: Clean up legacy raw key expectations]
└── lib/
    └── optimisticMutation.ts           [UPDATE: Standardize helpers to accept QueryKey or tRPC utils]
```

---

## 4. File-by-File Implementation Details

### 4.1. `src/hooks/useLibraryData.ts` (Core Refactor)

#### Problem
The current implementation maintains 2 `useEffect` hooks that call `queryClient.setQueryData` whenever tRPC data changes, plus a fallback check in `useMemo` that queries the raw key `['books', libraryId]`.

#### Solution
Rewrite `useLibraryData` to be a pure, declarative facade over `trpc.library.get` and `trpc.book.list`:

```typescript
import {useEffect, useMemo} from 'react';
import {Library, Book} from '../types';
import {toast} from 'sonner';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {trpc} from '../lib/trpc';

export interface UseLibraryDataResult {
  library: Library | null;
  books: Book[];
  isLoading: boolean;
  isBooksLoading: boolean;
  isSyncing: boolean;
  isCachedFirstPaint: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => Promise<void>;
}

export function useLibraryData(
  libraryId: string | undefined,
  userId: string | undefined,
  navigate?: (path: string) => void,
): UseLibraryDataResult {
  const isEnabled = Boolean(libraryId && userId);

  // 1. Declarative Library Query
  const libraryQuery = trpc.library.get.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: isEnabled,
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: 1000 * 60 * 60 * 24, // 24 hours in memory
    },
  );

  // 2. Declarative Books Collection Query
  const booksQuery = trpc.book.list.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: isEnabled,
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 60 * 24 * 7,
      networkMode: 'offlineFirst',
      retry: 2,
    },
  );

  // 3. Normalized Data Derivation
  const library = useMemo(() => {
    return (libraryQuery.data as unknown as Library) ?? null;
  }, [libraryQuery.data]);

  const books = useMemo(() => {
    if (!booksQuery.data) return [];
    const raw = booksQuery.data;
    if (Array.isArray(raw)) return raw as Book[];
    if ('books' in raw && Array.isArray((raw as {books: unknown}).books)) {
      return (raw as {books: Book[]}).books;
    }
    return [];
  }, [booksQuery.data]);

  // 4. Telemetry Logging (One-shot per query resolution)
  useEffect(() => {
    if (library) {
      const bytes = calculatePayloadBytes(library);
      DebugTelemetryEngine.getInstance().addLog(
        'api_request',
        `Loaded library "${library.name}" via tRPC (${(bytes / 1024).toFixed(1)} KB)`,
        {path: `libraries/${libraryId}`, size: 1, bytes, fromCache: !libraryQuery.isStale},
      );
    }
  }, [library, libraryId, libraryQuery.isStale]);

  useEffect(() => {
    if (books.length > 0) {
      const bytes = calculatePayloadBytes(books);
      DebugTelemetryEngine.getInstance().addLog(
        'api_request',
        `Loaded ${books.length} books via tRPC (${(bytes / 1024).toFixed(1)} KB)`,
        {path: `libraries/${libraryId}/books`, size: books.length, bytes, fromCache: !booksQuery.isStale},
      );
    }
  }, [books, libraryId, booksQuery.isStale]);

  // 5. Navigation Guard on Fatal Error
  useEffect(() => {
    if (libraryQuery.isError) {
      toast.error('Library not found or access denied');
      if (navigate) {
        navigate('/');
      }
    }
  }, [libraryQuery.isError, navigate]);

  // 6. Granular State Derivation
  const isLoading = libraryQuery.isLoading;
  const isBooksLoading = booksQuery.isLoading;
  const isSyncing = booksQuery.isFetching && !booksQuery.isLoading;
  const isCachedFirstPaint = !booksQuery.isLoading && books.length > 0;

  const refetch = async () => {
    await Promise.all([libraryQuery.refetch(), booksQuery.refetch()]);
  };

  return {
    library,
    books,
    isLoading,
    isBooksLoading,
    isSyncing,
    isCachedFirstPaint,
    isError: libraryQuery.isError || booksQuery.isError,
    error: libraryQuery.error || booksQuery.error,
    refetch,
  };
}
```

---

### 4.2. `src/pages/spruce-up/useSpruceUp.ts` (Optimistic Updates)

#### Current Anti-Pattern
```typescript
queryClient.setQueryData(
  ['books', libraryId],
  (prev: Book[] | undefined) => prev ? prev.filter(b => b.id !== id) : [],
);
```

#### Target Fix
Use `trpc.useUtils()`:
```typescript
const utils = trpc.useUtils();

const handleDelete = async (id: string) => {
  if (!libraryId) return;
  const originalData = utils.book.list.getData({libraryId});
  setProcessingIds(prev => new Set(prev).add(id));

  try {
    // Optimistically update canonical tRPC query cache
    utils.book.list.setData({libraryId}, old => {
      if (!old) return {books: []};
      const oldBooks = Array.isArray(old) ? old : old.books || [];
      const updated = oldBooks.filter(b => b.id !== id);
      return Array.isArray(old) ? updated : {...old, books: updated};
    });

    await trpcVanilla.book.delete.mutate({libraryId, bookId: id});
    toast.success('Book deleted');
  } catch (error) {
    // Roll back on failure
    if (originalData) {
      utils.book.list.setData({libraryId}, originalData);
    }
    toast.error('Failed to delete book');
  } finally {
    setProcessingIds(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }
};
```

---

### 4.3. `src/pages/dashboard/LibraryCard.tsx` (Hover Warmup)

#### Current Anti-Pattern
```typescript
queryClient.setQueryData(['library', lib.id], lib);
```

#### Target Fix
```typescript
const utils = trpc.useUtils();

const handleWarmup = useCallback(() => {
  if (!lib.id) return;
  
  // Seed the exact tRPC query key used by LibraryView & useLibraryData
  utils.library.get.setData({libraryId: lib.id}, lib as any);

  if (user) {
    const email = user.email?.toLowerCase();
    const role = lib.callerRole || (lib.ownerId === user.uid ? 'owner' : 'viewer');
    queryClient.setQueryData(['libraryPermissions', lib.id, user.uid, email], role);
  }
}, [lib, user, utils, queryClient]);
```

---

### 4.4. `src/pages/dashboard/useLibraries.ts` (List Pre-seeding)

#### Current Anti-Pattern
```typescript
libraries.forEach(lib => {
  queryClient.setQueryData(['library', lib.id], lib);
});
```

#### Target Fix
```typescript
const utils = trpc.useUtils();

useEffect(() => {
  if (libraries.length > 0) {
    libraries.forEach(lib => {
      utils.library.get.setData({libraryId: lib.id}, lib as any);
    });
  }
}, [libraries, utils]);
```

---

## 5. Potential Gotchas, Pitfalls, and Mitigations

### Gotcha 1: Invalidation Mismatch Across Legacy Query Keys
* **The Risk**: If any component or background job calls `queryClient.invalidateQueries({ queryKey: ['books', libraryId] })`, it will silently fail to refresh the data because the canonical tRPC key is `[['book', 'list'], { input: { libraryId }, type: 'query' }]`.
* **Mitigation**: 
  - Search the codebase for all occurrences of `'books'` and `'library'` in `invalidateQueries` or `setQueryData`.
  - Replace them uniformly with `utils.book.list.invalidate({ libraryId })` and `utils.library.get.invalidate({ libraryId })`.

### Gotcha 2: Return Shape Discrepancies (`Book[]` vs `{ books: Book[] }`)
* **The Risk**: In some server routers, `list` returns `{ books: Book[], totalCount?: number }`, whereas frontend components may expect an array of `Book[]`.
* **Mitigation**:
  - The `useMemo` in `useLibraryData` handles both shapes defensively (`Array.isArray(raw) ? raw : raw.books`).
  - Always return `Book[]` from `useLibraryData.books` to maintain 100% backward compatibility for downstream consumers (`WorldMap`, `TimelineView`, `ConstellationMap`, `SpruceUp`).

### Gotcha 3: Infinite Re-render via Object References in `useEffect`
* **The Risk**: If `useLibraryData` returns newly computed object or array references on every render, consumers with `useEffect` dependencies on `books` or `library` will enter render loops.
* **Mitigation**:
  - Wrap `books` and `library` normalizations in `useMemo` keyed strictly on `booksQuery.data` and `libraryQuery.data`.

### Gotcha 4: Navigation State Mutation During Component Render
* **The Risk**: Calling `navigate('/')` inside the render body when `libraryQuery.isError` is true throws React warnings about updating state during render.
* **Mitigation**:
  - Keep navigation side effects inside `useEffect(() => { if (libraryQuery.isError) navigate('/'); }, [libraryQuery.isError, navigate])`.

### Gotcha 5: Vitest & React Testing Library Mock Expectations
* **The Risk**: `useLibraryData.test.ts` and `TimelineView.test.tsx` may have mocks asserting `queryClient.setQueryData(['books', ...])` or manual cache flags.
* **Mitigation**:
  - Update unit tests to mock `trpc.library.get.useQuery` and `trpc.book.list.useQuery`.
  - Verify that mock responses propagate seamlessly to the component's rendered output.

---

## 6. Phased Step-by-Step Execution Checklist

### Phase 1: Core Hook Refactor
- [ ] Refactor `src/hooks/useLibraryData.ts` to remove `skipToken`, manual `setQueryData`, and `useEffect` cache mirroring.
- [ ] Ensure `useLibraryData` exposes identical API signature: `{ library, books, isLoading, isBooksLoading, isSyncing, isCachedFirstPaint, isError, error, refetch }`.

### Phase 2: Mutation & Cache Seeding Alignment
- [ ] Update `src/pages/dashboard/LibraryCard.tsx` to use `utils.library.get.setData`.
- [ ] Update `src/pages/dashboard/useLibraries.ts` to use `utils.library.get.setData`.
- [ ] Update `src/pages/spruce-up/useSpruceUp.ts` to use `utils.book.list.setData`.
- [ ] Audit all book mutations (`createBook`, `updateBook`, `deleteBook`, `batchUpsert`) to ensure they invalidate via `utils.book.list.invalidate`.

### Phase 3: Consumer Verification
- [ ] Verify `src/pages/LibraryView.tsx` (Library details, header, shelf rendering).
- [ ] Verify `src/pages/WorldMap.tsx` (Spatial geocoding visualization).
- [ ] Verify `src/pages/TimelineView.tsx` (Temporal histogram & chronological layout).
- [ ] Verify `src/hooks/useConstellationData.ts` (Cluster embeddings computation).

### Phase 4: Test Suite & Verification
- [ ] Update `src/hooks/useLibraryData.test.ts` to test declarative states, cache hits, and error handling.
- [ ] Run `npm run test` (or `npx vitest run`) to ensure zero test regressions.
- [ ] Run `npx gts lint` to enforce formatting and TypeScript strictness.
- [ ] Run `compile_applet` to confirm zero compilation errors.
