# Centralized Suspense Skeleton Fallback Strategy

## 1. Architectural Goal & Problem Statement

Currently, `PageWrapper` in `src/App.tsx` wraps `<Outlet />` inside `<Suspense key={location.pathname} fallback={...}>` and uses a static regex check (`/^\/library\//`) that unconditionally renders the full-page `<LibraryMainSkeleton />` (header + tabs + overview skeleton) on every `/library/*` route transition, while falling back to a generic `<PageLoading title="Loading module..." />` spinner for `/reading/*` and `/admin`.

This causes two perceived performance regressions:
1. **Header & Chrome Flashing on Warm Navigation**: Navigating between existing views of an already-loaded library (e.g., `/library/:id` → `/library/:id/constellation`, `/library/:id/map`, `/library/:id/timeline`, `/library/:id/book/:bookId`, or `/library/:id/add`) replaces the already-known library header with an animated pulsing placeholder (`LibraryHeaderSkeleton`).
2. **Mismatched Layout Geometry**: Specialized views (Constellation 3D canvas, World Map, Timeline, Book Details two-column dossier, Add Book / Spruce Up workbench) flash an Overview card skeleton or a generic centered spinner during lazy chunk resolution, creating layout shifts when the view mounts.

---

## 2. Warm vs. Cold State Resolution Strategy

We will create a centralized hook and resolver (`src/components/layout/SuspenseFallbackRouter.tsx` + `src/stores/navigationCacheStore.ts` or session tracker) that determines whether the target route is a **Cold Load** (first-time data fetch) or a **Warm Transition** (navigating between views when library/shelf data is already cached or previously visited):

### Cache & History Inspection
- **TanStack Query Cache Inspection**:
  - For `/library/:id/*` routes: Inspect `trpc.useUtils()` / `queryClient` for cached `library.get({ libraryId: id })` or `library.list` containing `id`, as well as cached `book.list({ libraryId: id })`.
  - For `/reading/*` routes: Inspect cached `readingTracker.getShelf` or `library.list` data in TanStack Query.
- **Visited Route History Tracking**:
  - Track visited library IDs (`visitedLibraryIds: Set<string>`) and visited route keys (`visitedPaths: Set<string>`) across the session so that even if a background refetch is in flight, any library or shelf the user has already viewed in the current session is treated as **Warm**.

### Cold vs. Warm Fallback Behavior
- **Cold Load (First time entering a library or reading shelf with no cached metadata)**:
  - Renders the full structural skeleton including the header placeholder (`LibraryHeaderSkeleton` + `LibraryTabsSkeleton`) and the target view's dedicated content skeleton.
- **Warm Transition (Library metadata is available in TanStack Query cache or visited history)**:
  - **Real Library Header Preservation**: Renders the actual `<LibraryHeader />` (populated immediately from the cached `Library` object and cached book count) and sub-navigation bar chrome, while **only skeletonizing the content area below the header** with the target route's dedicated view skeleton.
  - **Scoped Suspense Boundary Keying**: Instead of keying `<Suspense>` on raw `location.pathname` in a way that tears down shared context, `SuspenseFallbackRouter` resolves the exact route pattern and renders a geometry-matched skeleton for the incoming lazy view.

---

## 3. Dedicated View-Type Skeletons (`src/components/book/LibrarySkeletons.tsx`)

All skeletons will strictly follow the **Warm Archival Studio** design system (`docs/evergreen/README.md`: rectilinear `rounded-lg` / `rounded-xl` surfaces, `bg-surface-container*` tonal layering, subtle `border-outline-variant/30` hairlines, no pill buttons or glassmorphic slop).

1. **Overview & Collection Skeletons (`LibraryOverviewSkeleton`, `LibraryCollectionSkeleton`)**
   - Retained for `/library/:id` (`?tab=overview` vs `?tab=collection`), updated to respect warm header preservation when `library` metadata is already in cache.
2. **Spatial Canvas Skeleton (`SpatialMapSkeleton` for Constellation & World Map)**
   - Matches `/library/:id/constellation`, `/reading/constellation`, `/library/:id/map`, and `/reading/map`.
   - Renders the full-viewport dark/archival canvas frame with top-left breadcrumb/hud bar placeholder, top-right filter/search control bar placeholder, and a subtle central coordinate reticle indicator.
3. **Chronological Timeline Skeleton (`TimelineViewSkeleton` for Timeline)**
   - Matches `/library/:id/timeline` and `/reading/timeline`.
   - Renders the timeline header bar, era filter strip, and staggered horizontal/vertical archival era track placeholders.
4. **Book Dossier Skeleton (`BookDetailsSkeleton` for Book Details)**
   - Matches `/library/:id/book/:bookId` and `/reading/book/:bookId`.
   - Renders the back-navigation bar, two-column archival layout (left 2:3 book cover frame + status/rating controls; right title, author, metadata grid, and synopsis lines).
5. **Workbench / Form Skeleton (`WorkbenchFormSkeleton` for Add Book & Spruce Up)**
   - Matches `/library/:id/add`, `/reading/add`, and `/library/:id/spruce-up`.
   - Renders the workbench header bar, mode/source selector strip, and structured input/review card grid.

---

## 4. Planned File Changes

1. **`src/components/book/LibrarySkeletons.tsx`**
   - Add `SpatialMapSkeleton` (configurable for `constellation` | `world-map`), `TimelineViewSkeleton`, `BookDetailsSkeleton`, and `WorkbenchFormSkeleton`.
   - Update `LibraryMainSkeleton` to accept an optional cached `library` & `books` prop (so warm transitions render the real `<LibraryHeader />` while cold loads render `<LibraryHeaderSkeleton />`) and support all view variants (`overview`, `collection`, `constellation`, `map`, `timeline`, `book-details`, `workbench`).
2. **`src/components/layout/SuspenseFallbackRouter.tsx` (New)**
   - Centralized route-aware and cache-aware fallback component used by `App.tsx` (and reusable by `LibraryView.tsx`).
   - Parses `location.pathname` and `location.search`, inspects TanStack Query cache (`queryClient.getQueryData` / `trpc.useUtils()`) and session visited history, and returns the exact warm or cold skeleton for:
     - `/` (`DashboardMainSkeleton`)
     - `/library/:id` (`overview` or `collection` tab)
     - `/library/:id/constellation` & `/reading/constellation`
     - `/library/:id/map` & `/reading/map`
     - `/library/:id/timeline` & `/reading/timeline`
     - `/library/:id/book/:bookId` & `/reading/book/:bookId`
     - `/library/:id/add`, `/reading/add`, & `/library/:id/spruce-up`
3. **`src/App.tsx`**
   - Replace the inline hardcoded `getFallbackSkeleton()` in `PageWrapper` with `<SuspenseFallbackRouter />` and track visited routes/libraries as navigation completes.
4. **`src/pages/LibraryView.tsx`**
   - Align internal loading states with the warm/cold strategy so that if `library` is already cached from the Dashboard list while `books` are loading for the first time, the real `<LibraryHeader />` stays mounted while only the tab content area shows `<LibraryOverviewSkeleton />` or `<LibraryCollectionSkeleton />`.
5. **Unit Tests (`src/components/layout/SuspenseFallbackRouter.test.tsx`)**
   - Verify cold vs. warm fallback selection across Library Overview/Collection, Constellation, World Map, Timeline, Book Details, and Add Book routes.
