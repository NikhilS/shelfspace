# Codebase Reorganization, Monolith Decomposition & 100% Strict Typing Plan

A holistic architectural refactor of the **book(ish)** codebase to establish clean client/server module boundaries, decompose oversized `800–2,060`-line monolithic files into focused domain modules, co-locate all unit tests alongside their source files, and enforce 100% strict end-to-end TypeScript typing without `any` casts or loose `Record<string, unknown>` service return contracts.

---

## 1. Directory Architecture & Module Boundaries

### 1.1 Unify All Backend Code Under `src/server/`
Currently, backend code is split between `src/server/` (`api/`, `auth/`, `trpc/`) and `src/services/server/`. We will move all backend domain services into `src/server/services/` so `src/server/` is the single home for 100% of server-side code, while `src/services/` contains strictly client-side services (`authListener.ts`, `bookApi.ts`, `wikipediaApi.ts`, `db/`):

```text
src/server/
├── api/v1/                        # Express REST v1 routes
├── auth/                          # Auth context, token/API-key verifiers, RBAC/ABAC procedures
├── trpc/                          # tRPC initialization & routers (_app, auth, libraryApi, metadata, gemini, user, apiKey)
└── services/                      # Unified server domain services (moved from src/services/server/)
    ├── firebaseAdmin.ts           # Admin SDK & Firestore error formatting
    ├── limiters.ts                # Server-side Bottleneck rate limiters
    ├── geolocation.ts             # Nominatim geocoding & Firestore geolocationCache
    ├── apiKeyService.ts           # API key hashing, creation, revocation
    ├── userService.ts             # User profile & allowlist/waitlist management
    ├── enrichmentService.ts       # Background & batch metadata enrichment orchestration
    ├── metadata/                  # Pluggable metadata provider registry & providers
    ├── gemini/                    # Decomposed Gemini AI capability modules (formerly 1,203-line gemini.ts)
    │   ├── index.ts               # Public barrel re-exporting all Gemini service functions
    │   ├── client.ts              # Lazy GenAI initialization, retry wrapper, API key & quota error handlers
    │   ├── vision.ts              # Bookshelf photo extraction, spine bounding boxes, CSV AI fallback
    │   ├── covers.ts              # Imagen cover generation & book cover verification
    │   ├── embeddings.ts          # Batch text-embedding-004 vector generation & thematic cluster naming
    │   └── enrichment.ts          # Synopsis, author bio, genre taxonomy, geo & historical era extraction
    ├── book/                      # Decomposed Book domain service (formerly 820-line bookService.ts)
    │   ├── index.ts               # BookService facade & barrel exports
    │   ├── bookReadService.ts     # getBook, listBooks (cursor pagination), getBookDetails, getBookDetailsChunk
    │   ├── bookWriteService.ts    # createBook, updateBook, deleteBook, bulkUpsertBooks (400-op chunking)
    │   └── bookReviewService.ts   # Review subcollection CRUD & status updates
    └── library/                   # Decomposed Library domain service (formerly 1,005-line libraryService.ts)
        ├── index.ts               # LibraryService facade & barrel exports
        ├── libraryCrudService.ts  # getLibrariesForUser, getLibrary, createLibrary, updateLibrary, deleteLibrary
        ├── libraryShareService.ts # Access control mutations, member invitations, role updates
        └── librarySpruceService.ts# Duplicate detection, allowedDuplicates, metadata reset & storage upload
```

### 1.2 Group `src/components/` into Clear Domain Subfolders
Instead of 39 flat files in `src/components/`, we will organize domain-specific components into focused subfolders while keeping core layout & book primitives easy to import:

```text
src/components/
├── ui/                            # Primitives (Button, Dialog, Input, Select, Badge, Tabs, etc.)
├── admin/                         # Admin allowlist & waitlist tables
├── layout/                        # App shell & navigation guards
│   ├── AppLayout.tsx (+ .test.tsx)
│   ├── BackToLibrary.tsx (+ .test.tsx)
│   ├── ConnectivityBanner.tsx (+ .test.tsx)
│   ├── ErrorBoundary.tsx (+ .test.tsx)
│   ├── PageLoading.tsx
│   ├── RequireLibraryPermission.tsx
│   └── ScrollToTop.tsx
├── book/                          # Shared book display & rating primitives
│   ├── BookCard.tsx (+ .test.tsx)
│   ├── BookLoader.tsx
│   ├── GenreSelect.tsx (+ .test.tsx)
│   ├── LibrarySkeletons.tsx
│   ├── PrefetchAdjacentBooks.tsx
│   └── StarRating.tsx (+ .test.tsx)
├── import/                        # Scanners, camera capture, and bulk import workflows
│   ├── BarcodeScanner.tsx
│   ├── BookSearch.tsx
│   ├── BulkEnrichmentBanner.tsx
│   ├── BulkImport.tsx (+ .test.tsx)
│   ├── CSVImportTab.tsx
│   ├── CameraScanner.tsx
│   ├── CoverCamera.tsx
│   └── ExtractedBooksTable.tsx (+ .test.tsx)
├── account/                       # User profile, API keys & waitlist screens
│   ├── ApiKeyManagement.tsx (+ .test.tsx)
│   ├── UserProfileDialog.tsx (+ .test.tsx)
│   └── WaitlistScreen.tsx (+ .test.tsx)
└── debug/                         # Decomposed Developer HUD & Telemetry panels
    ├── DebugConsoleHUD.tsx (+ .test.tsx)
    ├── DebugMetricsOverview.tsx
    ├── DebugNetworkTab.tsx
    ├── DebugConsoleLogsTab.tsx
    ├── DebugStateInspectorTab.tsx
    └── PersistenceTelemetryPanel.tsx
```

---

## 2. Decomposing Oversized Page & Visualization Monoliths

Every complex page will follow the same clean subfolder pattern already used by `src/pages/library/` and `src/pages/book-details/`:

### 2.1 Thematic Constellations (`src/pages/constellations/`)
Decompose the 1,791-line `ConstellationChart.tsx` into modular cartographic, physics, and UI units under `src/pages/constellations/`:
- `src/pages/ConstellationMap.tsx` (+ `ConstellationMap.test.tsx`): Top-level route container.
- `src/pages/constellations/ConstellationChart.tsx`: Orchestrates state, keyboard shortcuts, and layout between toolbar, canvas, and side inspector.
- `src/pages/constellations/ConstellationCanvasRenderer.ts`: Pure 2D HTML5 Canvas drawing functions for the 6 cartographic layers (parchment sky & graticule, watercolor nebula hulls, copperplate MST filaments, semantic kinship arcs, book star glyphs, and zoom-adaptive typography).
- `src/pages/constellations/ConstellationToolbar.tsx`: Top search input, cluster filter selector, zoom controls, and archival status readout.
- `src/pages/constellations/ConstellationInspector.tsx`: Right-hand Curatorial Side Inspector drawer (selected book details, semantic nearest neighbors list, cluster index).
- `src/pages/constellations/types.ts`: Strongly-typed `ScatterPoint`, `ClusterData`, `CameraState`, `ClusterHullGeometry`, and pigment palette constants.

### 2.2 Historical Timeline (`src/pages/timeline/`)
Decompose the 2,064-line `TimelineView.tsx` into focused modules under `src/pages/timeline/`:
- `src/pages/TimelineView.tsx` (+ `TimelineView.test.tsx`): Route wrapper and top-level view state.
- `src/pages/timeline/timelineMath.ts`: Historical era classification, century/decade bucketing, year formatting (`BCE`/`CE`), and organic Bezier river path & tributary geometry calculations.
- `src/pages/timeline/TimelineRiverCanvas.tsx`: Interactive SVG river visualization, era banners, tributary nodes, and pan/zoom viewport.
- `src/pages/timeline/TimelineMinimap.tsx`: Overview brush/minimap scrubber and jump-to-era controls.
- `src/pages/timeline/TimelineEraInspector.tsx`: Side/bottom drawer displaying books within the selected historical era or node, plus non-historical/mythic book shelf.
- `src/pages/timeline/types.ts`: `TimelineNode`, `TimelineEraBucket`, `RiverPathSegment`, and filter types.

### 2.3 Literary World Map (`src/pages/world-map/`)
Decompose the 894-line `WorldMap.tsx` into `src/pages/world-map/`:
- `src/pages/WorldMap.tsx` (+ `WorldMap.test.tsx`): Route page component.
- `src/pages/world-map/worldMapMath.ts`: Geographic coordinate aggregation, clustering by administrative level (`city`, `state`, `country`, `region`), and projection helpers.
- `src/pages/world-map/WorldMapCanvas.tsx`: SVG cartographic map renderer, markers, and zoom/pan controls.
- `src/pages/world-map/WorldMapInspector.tsx`: Selected location drawer and non-Earth/speculative worlds catalog panel.
- `src/pages/world-map/types.ts`: `LocationCluster`, `WorldMapFilterState`, and marker types.

---

## 3. Co-Locating All Unit Tests (`Foo.test.ts` / `Foo.test.tsx`)

We will standardize on co-located unit tests across the entire repository and delete all `__tests__/` subdirectories:
- Move `src/components/__tests__/ConnectivityBanner.test.tsx` $\rightarrow$ `src/components/layout/ConnectivityBanner.test.tsx`
- Move `src/hooks/__tests__/useOnlineStatus.test.ts` $\rightarrow$ `src/hooks/useOnlineStatus.test.ts`
- Move `src/hooks/__tests__/usePWAInstall.test.ts` $\rightarrow$ `src/hooks/usePWAInstall.test.ts`
- Move `src/lib/__tests__/clientCache.test.ts` $\rightarrow$ `src/lib/clientCache.test.ts`
- Move `src/lib/__tests__/pwaConfig.test.ts` $\rightarrow$ `src/lib/pwaConfig.test.ts`
- Move `src/services/server/__tests__/bookService.test.ts` $\rightarrow$ `src/server/services/book/bookService.test.ts`
- Move `src/server/auth/__tests__/*.test.ts` $\rightarrow$ `src/server/auth/*.test.ts`
- Remove all empty `__tests__/` directories.

---

## 4. 100% Strict TypeScript Typing Overhaul

### 4.1 Consolidate Canonical Domain Types (`src/types/`)
Unify `src/types.ts` and `src/types/*` so `src/types/index.ts` (with `src/types.ts` re-exporting for backward compatibility) defines all core domain models:
- **`BookRecord` & `BookDetailsPayload`**: Exact Firestore & tRPC wire shapes for books and heavy book details (`synopsis`, `authorBio`, `embedding`, `clusterCoordinates`).
- **`LibraryRecord`**: Strongly-typed library document shape including `access`, `callerRole`, `ownershipType`, `bookCount`, and serialized ISO timestamps.
- **`EnrichCreateBookResult`**: Typed result per book from `metadata.enrichCreate` (`{ id: string } & Partial<Record<MetadataKey, unknown>>`).
- **`TelemetryLogPayload`**: Discriminated union / structured interface for `DebugLogEntry.payload` (`fromCache?: boolean`, `durationMs?: number`, `byteSize?: number`, `status?: string`, etc.).

### 4.2 Eliminate All Explicit `any` Casts
1. `src/components/debug/DebugNetworkTab.tsx` (formerly `DebugConsoleHUD.tsx:815`): Type `log.payload` using `TelemetryLogPayload` type guard instead of `as any`.
2. `src/pages/add-book/useAddBooks.ts:62`: Use the strongly-typed `EnrichCreateBookResult` returned by `trpcVanilla.metadata.enrichCreate.mutate` instead of `(r: any)`.
3. `src/server/trpc/routers/metadata.ts:63`: Type `MetadataBookInput` in `IMetadataProvider.bulkFetch` so `bookChunk` satisfies `provider.bulkFetch(bookChunk)` directly without `as any`.

### 4.3 Replace `Record<string, unknown>` Return Contracts in Server Services
- **`BookService` (`src/server/services/book/`)**:
  - `createBook` $\rightarrow$ `Promise<{ success: true; id: string; book: Book }>`
  - `getBook` $\rightarrow$ `Promise<Book>`
  - `listBooks` $\rightarrow$ `Promise<{ books: Book[]; nextCursor?: string }>`
  - `getBookDetails` $\rightarrow$ `Promise<BookDetailsPayload>`
  - `getBookDetailsChunk` $\rightarrow$ `Promise<{ details: Record<string, BookDetailsPayload> }>`
- **`LibraryService` (`src/server/services/library/`)**:
  - `getLibrary` $\rightarrow$ `Promise<Library>`
  - `createLibrary` $\rightarrow$ `Promise<{ id: string; library: Library }>`
  - `getLibrariesForUser` $\rightarrow$ `Promise<Library[]>`
- **`EnrichmentService` (`src/server/services/enrichmentService.ts`)**:
  - Replace untyped `updatePayload: Record<string, unknown>` and `heavyPayload: Record<string, unknown>` with typed `Partial<Book>` and `Partial<BookDetailsPayload>` builders.

---

## 5. Verification Strategy
1. Run the full Vitest suite (`npx vitest run`) to verify all co-located unit and integration tests pass.
2. Run `compile_applet` (`tsc --noEmit` & Vite production build) to verify zero TypeScript or bundle errors.
3. Run `lint_applet` (`gts check`) to confirm 100% lint and formatting compliance across all moved and refactored files.
