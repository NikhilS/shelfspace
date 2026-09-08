# Technical Design Document: Persistence Layer Hardening & Optimization

**Status:** Proposed  
**Author:** Staff Software Engineer  
**Date:** September 2026  
**Target Systems:** Firestore Persistence Layer, TanStack Query Cache, tRPC / Server Services, In-App Debug Console HUD  

---

## 1. Executive Summary & Problem Statement

The Bibliophile Hub persistence layer has scaled organically as new features (canonical 30-genre taxonomy, vector embeddings, Gemini AI curator picks, and constellation spatial maps) were added. While functionally feature-rich, the data access tier suffers from architectural debt that threatens mobile performance, data transfer quotas, and network responsiveness:

1. **Payload Bloat & Heavy Field Leaks:** Core book documents in `libraries/{libraryId}/books/{bookId}` frequently carry heavy 768-dimension floating-point vector embeddings (~6 KB per book) and multi-paragraph synopses/author bios. For a 500-book library, a single bookshelf load can pull **~4 MB of dead weight** across the wire.
2. **Listener Proliferation & Cache Bypasses:** Multiple views (`BookDetailsView`, `SpruceUpView`, `ConstellationMap`, and `LibraryView`) independently open distinct Firestore `onSnapshot` listeners or issue raw `getDocs()` calls, ignoring the existing in-memory cache and multiplying document read bills.
3. **Impedance Mismatch in Caching:** TanStack Query is currently used as a passive global event bus (`staleTime: Infinity` with manual `setQueryData` injections from listeners) rather than a coordinated state manager.
4. **Lack of Payload & Network Telemetry:** Prior to this initiative, the in-app Debug Console HUD tracked basic API latency and read counts, but provided no visibility into **document byte weights, payload sizes, listener subscription counts, or cache hit efficiency**.

### Strategic Objectives
* **80%+ Reduction in Initial Library Payload:** Reduce average core book document size from ~8 KB to ~600 bytes.
* **0ms Cold-Start Perceptual Latency:** Implement cache-first offline hydration via Firestore IndexedDB before network reconciliation.
* **Single Source of Truth:** Centralize all library subscriptions into one coordinated caching layer.
* **Quantifiable Verification:** Build Phase 0 instrumentation directly into the Debug Console HUD to record baseline vs. optimized metrics.

---

## 2. Schema Analysis: Active vs. Legacy / Deprecated Fields

The document hierarchy is rooted under `libraries/{libraryId}`:

```
libraries/{libraryId}
  ├── books/{bookId}                       [Core Inventory Document]
  │     └── reviews/{reviewId}             [Subcollection: User Reviews]
  ├── bookDetails/{bookId}                 [Offloaded Heavy Metadata]
  ├── allowedDuplicates/{groupId}          [Deduplication Whitelist]
  └── jobs/{jobId}                         [Async Background Tasks]
```

### 2.1 Field Audit: `libraries/{libraryId}/books/{bookId}`

| Field Name | Type | Status | Assessment & Remediation |
| :--- | :--- | :--- | :--- |
| `id` | `string` | **Active** | Primary bibliographic document identifier. |
| `title`, `author`, `isbn` | `string` | **Active** | Core bibliographic essentials. |
| `coverUrl`, `coverUrlRaw` | `string` | **Active** | Jacket cover storage URLs. |
| `primaryGenre`, `subgenres`| `string`, `string[]` | **Active** | Canonical 30-category taxonomy. |
| `format`, `pages`, `publishedDate` | `string`, `number` | **Active** | Physical edition metadata. |
| `userStatuses` | `Record<uid, Status>` | **Active** | User reading status and ratings. |
| `geoMetadata`, `temporalMetadata`| `object` | **Active** | Geospatial and historical era data. |
| `enrichmentStatus` | `object` | **Active** | Audit flags for automated metadata providers. |
| `bookDetailsMetadata` | `BookDetailsMetadata` | **Active (Target)** | Lightweight sub-object mirroring heavy `BookDetails` with boolean flags (`hasSynopsis`, `hasAuthorBio`, `hasEmbedding`, etc.). |
| **`embedding`** | `number[]` | **CRITICAL LEAK** | 768-dim float vector (~6 KB). Must reside exclusively in `bookDetails/{bookId}`. |
| **`synopsis`** | `string` | **DEPRECATED** | Multi-paragraph summary. Must reside exclusively in `bookDetails/{bookId}`. |
| **`description`** | `string` | **LEGACY** | Predecessor to `synopsis` from initial OpenLibrary imports. |
| **`authorBio`** | `string` | **DEPRECATED** | Author biography. Must reside exclusively in `bookDetails/{bookId}`. |
| **`clusterCoordinates`** | `{x, y}` | **LEGACY** | Deprecated precomputed UMAP 2D coordinates; now calculated dynamically in worker. |
| **`genre`** | `string \| string[]` | **LEGACY** | Replaced by `primaryGenre` and `subgenres`. |
| **`_inBooks`** | `object` | **MIGRATION ARTIFACT** | Temporary migration markers from early shelf-care scripts. |

---

## 3. Implementation Roadmap

### Phase 0: Telemetry, Profiling & Baseline Instrumentation (Completed)

**Goal:** Establish rigorous observability in the in-app Debug Console HUD so engineers and users can visually verify latency, response payload byte weights, cache hit ratios, and active listener counts before and after optimizations.

#### Technical Specifications

1. **Extend `TelemetryMetrics` in `src/lib/telemetry.ts`:**
   ```typescript
   export interface TelemetryMetrics {
     // Existing
     totalApiRequests: number;
     averageApiLatency: number;
     totalFirestoreReads: number;
     firestoreCacheHits: number;
     totalGeminiQueries: number;
     totalGeminiTokens: number;
     activeWorkers: number;

     // Phase 0 Additions
     totalBytesTransferred: number;      // Estimated cumulative bytes received
     lastQueryPayloadBytes: number;      // Byte size of most recent query/snapshot
     averageBookDocumentBytes: number;   // Average bytes per individual book document
     activeFirestoreListeners: number;   // Real-time count of active onSnapshot listeners
     cacheEfficiencyRatio: number;       // Percentage of reads served from cache
     snapshotParseDurationMs: number;    // Time spent deserializing and normalizing snapshots
   }
   ```

2. **Payload Size Estimator Utility:**
   * Introduced lightweight runtime byte estimation helper (`calculatePayloadBytes(data: unknown): number`) that safely calculates UTF-8 byte weights of Firestore snapshots and API JSON payloads without degrading render cycles.

3. **Active Listener Tracking Registry:**
   * Wrapped Firestore `onSnapshot` invocations in an observer registry that increments `activeFirestoreListeners` on subscription and decrements upon invoking the unsubscribe cleanup callback.

4. **HUD Telemetry Dashboard Card & Baseline Profiler (`src/components/DebugConsoleHUD.tsx`):**
   * Dedicated **"Persistence Telemetry"** diagnostic widget inside the HUD with 4 live gauges:
     * **Net Transferred:** Cumulative payload transferred with threshold alerts.
     * **Avg Book Doc Size:** Running average with automated threshold status (`< 2 KB` vs `> 2 KB`).
     * **Active Listeners:** Real-time channel registry tracking subscriptions and proliferation.
     * **Cache & Parse:** Cache hit percentage and parse latency in milliseconds.
   * Dedicated **"Capture Baseline / Snapshot Delta"** table allowing before-and-after profiling across migrations.

---

### Phase 1: Zero-Leakage Heavy Payload Isolation & Schema Sanitization Routine

**Goal:** Enforce strict write-path boundaries ensuring heavy metadata is written *only* to `bookDetails/{bookId}`, populate lightweight `bookDetailsMetadata` existence sub-objects on core books, and provide an automated sanitization routine for existing documents.

#### Technical Specifications

1. **Mirrored Sub-Object: `BookDetailsMetadata`:**
   * Define a dedicated lightweight sub-object mirroring `BookDetails` / `BookDetailsPayload` fields:
     ```typescript
     export interface BookDetailsMetadata {
       hasSynopsis?: boolean;
       hasAuthorBio?: boolean;
       hasEmbedding?: boolean;
       hasDescription?: boolean;
       hasClusterCoordinates?: boolean;
     }
     ```
   * Embed `bookDetailsMetadata?: BookDetailsMetadata` in `Book`.

2. **Hard-Fenced Server Enrichment Writes (`src/services/server/enrichmentService.ts`):**
   * Audit all provider update routines (`resolveBookSynopses`, `resolveAuthorBios`, `resolveEmbeddings`).
   * Prohibit writing `synopsis`, `authorBio`, or `embedding` into the `books` collection payload.
   * Instead, write the lightweight flags to `books/{bookId}.bookDetailsMetadata`:
     ```typescript
     const coreBookUpdate: Partial<Book> = {
       bookDetailsMetadata: {
         hasSynopsis: Boolean(details.synopsis),
         hasAuthorBio: Boolean(details.authorBio),
         hasEmbedding: Boolean(details.embedding?.length),
       },
       updatedAt: new Date().toISOString(),
     };
     ```
   * Write full payload bodies exclusively to `bookDetails/{bookId}`.

3. **Client-Side Bulk Writer Enforcement (`src/hooks/useBulkEnrichment.ts`):**
   * Ensure `ClientBulkWriter` partitions writes into distinct operations:
     - `setDoc(doc(db, 'libraries', libId, 'bookDetails', bookId), heavyPayload, { merge: true })`
     - `updateDoc(doc(db, 'libraries', libId, 'books', bookId), { bookDetailsMetadata, updatedAt })`

4. **Automated Schema Sanitization Routine:**
   * Extend the "Shelf Care" maintenance suite (`ResetMetadataSection.tsx` / `useSpruceUp.ts`) with a one-click **"Purge Heavy Data Leaks"** routine:
     - Scans `libraries/{libId}/books`.
     - Verifies corresponding `bookDetails/{bookId}` contains the synopsis/embedding (migrating them to `bookDetails` if missing).
     - Sets `bookDetailsMetadata` with accurate boolean flags.
     - Calls `updateDoc` with `deleteField()` on `synopsis`, `authorBio`, `embedding`, `description`, `clusterCoordinates`, `genre`, and `_inBooks`.

---

### Phase 2: Deprecation Cleanup & Physical Field Removal from Codebase

**Goal:** Once write-path isolation and database sanitization are complete, physically delete deprecated fields from TypeScript definitions and eliminate all legacy field fallbacks across the entire codebase.

#### Technical Specifications

1. **Schema Interface Trimming (`src/types.ts`):**
   * Remove deprecated legacy fields from `Book`:
     ```typescript
     // REMOVE from Book interface:
     // synopsis?: string;
     // authorBio?: string;
     // embedding?: number[];
     // clusterCoordinates?: {x: number; y: number};
     // _inBooks?: ...;
     ```
   * Retain only `bookDetailsMetadata?: BookDetailsMetadata` for existence checks, and `BookDetailsPayload` for the separate `bookDetails` collection.

2. **Codebase-Wide Fallback Elimination:**
   * Audit all components (`BookCard`, `BookDetailsView`, `ConstellationMap`, `SpruceUpView`, `ShelfCare`):
     - Replace checks like `book.synopsis ? ...` or `book._inBooks?.synopsis` with `book.bookDetailsMetadata?.hasSynopsis`.
     - Replace embedding checks like `book.embedding ? ...` with `book.bookDetailsMetadata?.hasEmbedding`.
     - Ensure any component needing the full synopsis or embedding queries the dedicated `bookDetails/{bookId}` document instead of expecting it on `Book`.

3. **Compile-Time & Unit Test Hardening:**
   * Remove obsolete test fixtures that mock `Book` with root-level `synopsis` or `embedding`.
   * Verify via `compile_applet` and `lint_applet` that zero references to legacy root fields remain anywhere in the project.

---

### Phase 3: Unified Cache Management & Listener Deduplication

**Goal:** Eliminate redundant listeners, consolidate data fetching through a single TanStack Query cache, and stop downloading entire collections when inspecting single books.

#### Technical Specifications

1. **Decouple `BookDetailsView.tsx` from Collection Subscription:**
   * **Current Defect:** Opening `/library/:id/book/:bookId` calls `useLibraryData(libraryId)`, downloading all 500+ books simply to enable next/previous navigation.
   * **Optimized Pattern:**
     - Check TanStack Query cache for existing `['books', libraryId]`.
     - If present (user navigated from bookshelf), use existing cache for next/previous carousel IDs.
     - If absent (cold direct URL visit), fetch *only* the specific book: `doc(db, 'libraries', id, 'books', bookId)` and its `bookDetails`. Do **not** subscribe to the entire library collection.

2. **Single-Subscriber Pattern for Auxiliary Views:**
   * Refactor `useSpruceUp.ts` and `useConstellationData.ts`:
     - Discontinue independent raw `onSnapshot` and `getDocs()` calls.
     - Consume the canonical `['books', libraryId]` query provided by `useLibraryData`.
     - `useConstellationData` will lazily query `bookDetails` in chunks of 50 only for books participating in active embedding visualization.

3. **Listener Lifecycle Guards:**
   * Ensure every `onSnapshot` hook implements strict cleanup in React `useEffect` returning the unsubscribe handler.
   * Register each cleanup in the Phase 0 Telemetry Registry to guarantee zero ghost listeners remain active across route transitions.

---

### Phase 4: Zero-Latency Offline-First Hydration (Cache-First SWR)

**Goal:** Provide instant UI rendering (0ms cold start) using Firestore's IndexedDB offline cache, avoiding empty loading skeletons for returning users.

#### Technical Specifications

1. **Two-Stage Hydration in `src/hooks/useLibraryData.ts`:**
   ```typescript
   // Stage 1: Synchronous / Immediate IndexedDB Cache Paint
   try {
     const cachedSnapshot = await getDocsFromCache(booksQuery);
     if (!cachedSnapshot.empty) {
       const cachedBooks = cachedSnapshot.docs.map(mapDocToBook);
       queryClient.setQueryData(['books', libraryId], cachedBooks);
       setIsCachedFirstPaint(true);
     }
   } catch {
     // Cache miss or first visit - proceed smoothly to network
   }

   // Stage 2: Network onSnapshot Delta Reconciliation
   const unsubscribe = onSnapshot(booksQuery, { includeMetadataChanges: true }, (snapshot) => {
     // Seamlessly reconcile new or edited books without screen flash
     queryClient.setQueryData(['books', libraryId], snapshot.docs.map(mapDocToBook));
   });
   ```

2. **TanStack Query Hydration Defaults:**
   * Set `gcTime: 1000 * 60 * 60` (1 hour) and `staleTime: 1000 * 60 * 5` (5 minutes) so that in-app back/forward navigation executes with zero re-rendering delays.

---

### Phase 5: API Architecture Consolidation & Backend Alignment

**Goal:** Clean up the dual client/server split, deprecate dead code, and ensure writes are predictable.

#### Technical Specifications

1. **Retire Unused Server Read Endpoints:**
   * Deprecate `trpc.book.list` and `trpc.library.list` from `src/server/trpc/routers/libraryApi.ts` since all real-time library operations natively use the client Firestore SDK.
   * Retain tRPC strictly for computational and AI services (Gemini calls, bulk enrichment orchestrator, ISBN provider lookups).

2. **Atomic Server-Side / Batch Book Count Reconciliation:**
   * Eliminate fragile client-side useEffect loops in `useLibraries.ts` that attempt to reconcile `library.bookCount` against `books.length`.
   * Move counter maintenance to atomic `increment(1)` / `increment(-1)` batch mutations inside `ClientBulkWriter` upon book addition and deletion.

---

## 4. Verification Strategy & Acceptance Criteria

| Phase | Success Metric | Verification Mechanism |
| :--- | :--- | :--- |
| **Phase 0** | Telemetry HUD renders live metrics (Avg doc bytes, active listeners, total transferred KB, cache hit ratio). | Unit tests in `DebugConsoleHUD.test.tsx` + manual HUD inspection. |
| **Phase 1** | Strict write boundaries; heavy payloads stored only in `bookDetails`; `bookDetailsMetadata` populated; sanitization routine operational. | Server/client bulk writer verification + Shelf Care sanitization test. |
| **Phase 2** | Deprecated fields physically purged from `src/types.ts` and entire codebase; zero residual compiler/runtime references. | Full TypeScript compile (`compile_applet`) + codebase grep + Vitest suite. |
| **Phase 3** | Only 1 active Firestore listener during library browsing. Direct book URL visits do not fetch all books. | Phase 0 Listener gauge indicates `1` on bookshelf and `1` on single book page. |
| **Phase 4** | Cold page reload displays library in `< 50ms` from IndexedDB cache before network sync. | Chrome DevTools Network throttled to "Slow 3G" + HUD TTFB metrics. |
| **Phase 5** | Zero `PERMISSION_DENIED` errors on routine reads; tRPC surface cleaned of redundant read endpoints. | Server logs and clean tRPC router build verification. |
