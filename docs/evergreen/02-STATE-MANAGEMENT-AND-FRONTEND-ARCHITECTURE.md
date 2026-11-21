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
| - `useEntityCacheStore`: Normalized entities (`booksByKey`, `readingStates`)|
| - `useCoverTransitionStore`: Shared-element FLIP cover state & scrollY map  |
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

### Rule 3: Optimistic Mutations & Normalized Zero-Refetch Delta Commits
When applying mutations (toggling reading status, adding/editing/deleting a book, or posting a review), use the domain cache reconcilers in `src/lib/readingStatusCache/` backed by `useEntityCacheStore` (`src/stores/entityCacheStore.ts`):
1. Snapshot the existing entity and query cache state with a monotonically increasing mutation version and apply the optimistic patch (`applyOptimisticReadingStatusPatch`, `applyOptimisticBookEditPatch`, or `removeBookFromReadingCaches`).
2. When mutating reading status or swipe reviews on a client-known book, pass `bookSnapshot: buildBookSnapshotHint(...)` (`< 2KB` `MinimalBookStub`, free of heavy prose or oversized `data:` URLs) so the server skips pre-write Firestore reads (`0` pre-write reads).
3. On mutation error: invoke the returned version-guarded rollback closure, which restores state only if no newer mutation superseded the failed optimistic write, and toast a warm, clear message.
4. On mutation success: commit the authoritative delta returned by the server (`commitReadingStatusDelta`, `commitBookUpsertDelta`, `commitBookDeleteDelta`, `commitBookReviewDelta`) across `useEntityCacheStore` and coupled TanStack Query views—**do not** trigger full-collection `invalidateQueries` storms for single-entity writes. Reserve `invalidateReadingStatusQueries` strictly for multi-entity background enrichment or merge jobs (with `includeRecommendations: false` so daily editorial picks remain stable).

### Rule 4: Cross-Query Cache Synchronization & UID-Indexed Sharded Persistence
`src/lib/queryClient.ts` configures a **5-minute `staleTime`** (60 minutes for warm `book.list` caches backed by incremental `book.syncChanges`), `refetchOnWindowFocus: false`, and **7-day UID-Indexed Sharded Structured-Clone IndexedDB Persistence** (`bookish-cache-v3` with native `by_uid` `IDBIndex` in `src/lib/idbQueryShardPersister.ts`, querying `IDBKeyRange.only(uid)` instead of full-store cursor scans, flushing only dirty domain shards with `embedding` vectors stripped and zero `JSON.stringify`).

1. **Synchronize the Entire Query Family, Never Just the Local View's Query:**
   When a domain entity is projection-backed across multiple tRPC procedures, a mutation must patch **all** projections simultaneously (`src/lib/readingStatusCache/`):
   - `trpc.readingTracker.getShelf({ shelf: 'all' })` (Personal Reading Room Bento, Currently Reading card, Reading Lists modal, and shelf counts)
   - `trpc.readingTracker.getUnreadLibraryBooks(undefined)` (*"Start Reading from Your Shelves"* picker)
   - `trpc.book.list({ libraryId })` (`LibraryView` collection grid/list/table and `LibraryOverview` Reading Pulse)
   - `trpc.book.get({ libraryId, bookId })` & `trpc.book.listReviews({ libraryId, bookId })` (`BookDetailsView` and `BookSwipeDeck` preview slots)
   - `trpc.library.list()` / `trpc.library.get({ libraryId })` (incrementing/decrementing `bookCount` in place)
   - Daily editorial queries (`usePickOfTheDay` keyed by `(scopeKey, YYYY-MM-DD, refreshEpoch)` and `useBookRecommendations` with 24h `staleTime`) are intentionally decoupled from catalog counts so status/book edits never trigger redundant Gemini calls.

2. **Centralize Cache Patching & Audit Every Mutation Entry Point:**
   Never hand-roll partial cache patches inside individual components. Route every mutation through `src/lib/readingStatusCache/` and `useEntityCacheStore` across all entry points:
   - Single-book detail & edit actions (`src/pages/book-details/useBook.ts`)
   - Personal Reading Room & shelf actions (`src/pages/dashboard/useReadingShelf.ts`)
   - Library Overview inline status actions (`src/pages/library/LibraryOverview.tsx`)
   - Bulk selection toolbar actions (`src/hooks/useSelection.ts`)
   - Quick-add & full-page search/track flows (`src/components/book/QuickAddBookDialog.tsx`, `src/pages/AddBookView.tsx`, `src/pages/add-book/useAddBooks.ts`)
   - Interactive triage flows (`src/pages/read-swipe/useReadSwipeSession.ts`)
   - Shelf Care duplicate deletes/merges, cover audits, bulk enrichment deltas & detail resets (`src/pages/spruce-up/useSpruceUp.ts`, `src/hooks/useBulkEnrichment.ts`, `src/pages/spruce-up/ResetMetadataSection.tsx`)

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

To maintain locked 60/120fps frame pacing when swiping through book collections in `BookDetailsView` and `CurrentlyReadingCard`, **book(ish)** uses a custom, zero-re-render **3-Slot GPU Motion Deck** (`src/components/book/BookSwipeDeck.tsx`) rather than third-party imperative carousel libraries:

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
5. **Zero-Overhead Shared-Element Cover Transitions (`useCoverTransitionStore` & `SharedCoverFrame`):**
   - `SharedCoverFrame` renders a plain `<div>` for 99.9% of shelf items via the granular `useShelfCoverLayoutId(surface, libraryId, bookId)` selector, upgrading only the single active `(surface, libraryId, bookId)` slot inside `flushSync` (`navigateWithCoverTransition`) so 1,000-book virtualized shelves incur zero idle Motion layout observers.
   - `BookSwipeDeck` notifies `setDeckDragging(true | false)` so `BookContent` detaches `layoutId` during horizontal drags and calls `syncActiveDetailBook(libraryId, nextBookId)` on commit—allowing `prepareReturnWithCoverTransition` and `ScrollToTop` (`useLayoutEffect` pre-paint `scrollY` restoration) to reverse-morph whichever book the reader swiped to back into its shelf slot.

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
4. **Incremental Warm Delta Sync (`book.syncChanges`):**
   - Once a library's initial catalog is cached in memory or hydrated from its `library:<id>` IndexedDB shard, `useLibraryData` extends `book.list` freshness to 60 minutes and reconciles collaborator/cross-device changes via `trpcVanilla.book.syncChanges.query({ libraryId, sinceUpdatedAtMs, knownCount })` (throttled to 45s per library), downloading only modified `books` documents, durable `/libraries/{libraryId}/tombstones` deletions (`BookTombstoneLedger`), and canonical `book:<libraryId>:<bookId>` reading-state overlays (`0` book documents transferred when unchanged).


