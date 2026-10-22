# State Architecture & Frontend Data Flow

> **Document Status:** Authoritative State Management Specification  
> **Target Path:** `/docs/evergreen/02-STATE-MANAGEMENT-AND-FRONTEND-ARCHITECTURE.md`

---

## 1. The Four-Tier State Taxonomy

To avoid state fragmentation and dual-state synchronization bugs, **book(ish)** enforces a strict separation of concerns across four distinct state layers:

```
+-----------------------------------------------------------------------------+
| TIER 1: URL ROUTE & SEARCH PARAMETERS (Single Source of Truth for Navigation) |
| - Library filters: Search `q`, genres, subgenres, authors, year range, sort  |
| - Active view: Grid, List, Table, Spatial Constellations, Timeline           |
| - Modal state: `?editBook=ID`, `?scanner=open`                               |
+-----------------------------------------------------------------------------+
                                       |
+-----------------------------------------------------------------------------+
| TIER 2: SERVER STATE (TanStack React Query via tRPC)                         |
| - Libraries, Books, Metadata, Permissions, Background Enrichment Jobs       |
| - Handles caching, deduplication, stale-while-revalidate, optimistic updates |
+-----------------------------------------------------------------------------+
                                       |
+-----------------------------------------------------------------------------+
| TIER 3: CLIENT EPHEMERAL GLOBAL STATE (Zustand Stores)                       |
| - `useAppStore`: Theme mode (`light` | `dark` | `system`) persisted to local |
| - `useUIStore`: Active multi-selection set (`selectedBookIds: Set<string>`) |
| - `useAuthStore`: Firebase Auth user, allowlist readiness, superadmin flag  |
| - `useDebugStore`: HUD visibility, telemetry log ring buffer (max 200)       |
+-----------------------------------------------------------------------------+
                                       |
+-----------------------------------------------------------------------------+
| TIER 4: LOCAL COMPONENT STATE (`useState`, `useRef`, `useReducer`)           |
| - Strictly scoped to immediate UI transitions (dropdown toggle, form inputs)|
| - Never used to mirror server data or duplicate store state                 |
+-----------------------------------------------------------------------------+
```

---

## 2. Server State Invariants (TanStack React Query & tRPC)

### Rule 1: Declarative Queries Over Imperative Plumbing
- **Never use `skipToken` as a pseudo-global store.** TanStack Query must be given a real query function:
  ```typescript
  // CORRECT: Declarative query via tRPC React Query client
  const booksQuery = trpc.book.list.useQuery(
    { libraryId, ...filters },
    {
      staleTime: 60 * 1000, // 1 minute fresh
      gcTime: 10 * 60 * 1000, // 10 minutes garbage collection
    }
  );
  ```
- Do not maintain parallel `useState` flags for `isLoading`, `isError`, or `books`. Rely directly on the reactive properties of the query result (`booksQuery.isLoading`, `booksQuery.data`).

### Rule 2: Unified Cache Keys via tRPC Context
- Always use `trpc.useUtils()` to invalidate or mutate queries. Never invent raw string array query keys like `queryClient.invalidateQueries(['books'])`.
  ```typescript
  // CORRECT: Type-safe cache invalidation
  const utils = trpc.useUtils();
  await utils.book.list.invalidate({ libraryId });
  ```

### Rule 3: Structured Optimistic Updates
When applying optimistic mutations (such as toggling reading status or bulk-editing tags), use the structured `optimisticMutation` helper (`src/lib/optimisticMutation.ts`):
1. Cancel outgoing queries for that key.
2. Snapshot the existing cache data for rollback.
3. Optimistically write the expected delta to the cache.
4. On mutation error: automatically roll back to the snapshot and toast a user-friendly error.
5. On mutation settlement: trigger background refetch to ensure parity with the database.

---

## 3. Client Stores Invariants (Zustand)

### Store Purity
- **Store files must be pure TypeScript (`.ts`), not `.tsx`.** Never mix JSX into store definitions.
- Keep store selectors granular to prevent unnecessary re-renders:
  ```typescript
  // CORRECT: Select only the required slice
  const selectedCount = useUIStore((state) => state.selectedBookIds.size);
  const toggleBook = useUIStore((state) => state.toggleBookSelection);

  // WRONG: Subscribes to the entire store
  const { selectedBookIds, toggleBookSelection } = useUIStore();
  ```

### Cross-Tab & Storage Persistence
- Only long-term user preferences (theme mode, table column visibility preferences) may use `zustand/middleware/persist` with `localStorage`.
- Ephemeral state (multi-selected items, temporary search inputs) must reset when a session terminates or the tab closes.

---

## 4. Heavy Computing Offloading (Web Workers)

The main browser thread must remain silky smooth ($60\text{fps}$). Any mathematical or vector computation that exceeds $10\text{ms}$ execution time must be delegated to a dedicated Web Worker:

- **Spatial Constellations & UMAP Dimensionality Reduction:**
  High-dimensional book vector projections (embedding distance calculations, 2D/3D coordinate generation) run inside `src/workers/umapWorker.ts`.
- **Worker Communication Protocol:**
  Components dispatch raw book vectors through a typed worker bridge, display a lightweight skeleton or progress indicator, and receive normalized $(x, y)$ coordinates asynchronously.
- **Worker Termination:**
  Workers must be gracefully terminated on unmount using standard `useEffect` teardown routines to avoid memory leaks.

---

## 5. Constant-$O(1)$ 3-Slot Motion Deck & Gesture Physics

To maintain locked 60/120fps frame pacing when swiping through large book collections in `BookDetailsView`, **book(ish)** uses a custom, zero-re-render **3-Slot GPU Motion Deck** (`src/pages/book-details/BookSwipeDeck.tsx`) rather than third-party imperative carousel libraries:

1. **Constant $O(1)$ Virtual Window (`prev`, `active`, `next`):**
   - Regardless of collection size, at most **3 physical slot containers** (`offset: -1 | 0 | 1`) are mounted in the DOM, keyed by `bookId`.
   - During a touch drag or spring animation, pointer deltas drive a single `MotionValue` (`dragX`) via GPU `translate3d` with **zero React state updates**.
   - On spring completion, `dragX` resets to `0` and `activeIndex` updates in a single atomic frame—allowing React to reuse the already-mounted flanking DOM node in place without unmounting or layout shift.
2. **Route-Boundary Key Stabilization (`getRouteBoundaryKey`):**
   - `PageWrapper` in `src/App.tsx` normalizes `/library/:libraryId/book/:bookId` paths to `/library/:libraryId/book`, and `ScrollToTop` skips window scroll resets on intra-library book transitions so URL updates never remount `BookDetailsView`.
3. **Two-Tier Slot Lifecycle (Preview Shell vs. Active Editorial Spread):**
   - Flanking slots (`isActive === false`) render synchronously from the TanStack Query cache (`utils.book.get.getData` / `utils.book.list.getData`) with `listReviews`, `useBookInsights` auto-enrichment timers, `Markdown` AST parsing, and `ReviewSection` disabled until the slot settles into `isActive === true`.
4. **Idle-Deferred Data & Bitmap Pre-Warming:**
   - `PrefetchAdjacentBooks` defers tRPC prefetching and `new Image().decode()` cover pre-warming for `[index - 2, index + 2]` to `requestIdleCallback` after the swipe spring settles.

---

## 6. Progressive Catalog Hydration & Large Library Scaling (1,000+ Books)

To support multi-thousand-volume libraries without sacrificing first-paint speed or client-side search/filter completeness:

1. **Two-Stage Progressive Hydration (`useLibraryData`):**
   - **Stage 1 (Instant 1,000-Book First Paint):** `trpc.book.list.useQuery({ libraryId })` fetches the first 1,000 lightweight book records immediately (`isBooksLoading = false`, `isCachedFirstPaint = true`).
   - **Stage 2 (Background Cursor Drain):** When `nextCursor` is present, `useLibraryData` automatically drains remaining 1,000-book pages via `trpcVanilla.book.list.query` and merges deduplicated books directly into the canonical `{ libraryId }` TanStack Query cache entry (`nextCursor: undefined` once exhausted).
2. **Exploratory View Synchronization (`useCollectionScope` & `useSpruceUp`):**
   - Exploratory views (`ConstellationMap`, `TimelineView`, `WorldMap`, and `SpruceUpView` duplicate scanning) gate on `isBooksLoading || isPaginating` so UMAP/K-Means clustering and duplicate detection execute once across the complete catalog rather than restarting mid-drain.
   - `getBookDetailsChunk` batches full `bookDetails` reads in chunks of up to 250 books per request.
3. **Lookahead Pagination & Self-Healing `library.bookCount` (`BookService.listBooks`):**
   - Server queries use `limit + 1` lookahead to set `nextCursor` only when a $(N+1)\text{th}$ document exists, and asynchronously self-heal `libraries/{libraryId}.bookCount` whenever an unfiltered read detects drift between the stored count and actual collection count.


