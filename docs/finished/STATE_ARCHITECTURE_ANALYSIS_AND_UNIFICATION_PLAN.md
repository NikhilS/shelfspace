# Comprehensive State Architecture Analysis & Unification Plan

> **Document Status**: Complete Architecture Audit & Actionable Plan  
> **Target Path**: `/docs/STATE_ARCHITECTURE_ANALYSIS_AND_UNIFICATION_PLAN.md`  
> **Related Documents**:  
> - `/docs/ARCHITECTURE_AND_CODEBASE_REVIEW.md` (Section 5)  
> - `/docs/DECLARATIVE_REACT_QUERY_MIGRATION_PLAN.md`  
> - `/docs/ZUSTAND_MIGRATION.md`  
> - `/docs/TANSTACK_QUERY_MIGRATION.md`  

---

## Executive Summary

This document deeply audits the state management architecture of the application following the identification of the **Fragmented State Architecture** in `/docs/ARCHITECTURE_AND_CODEBASE_REVIEW.md` (Section 5).

### Is the Issue Still a Problem?
**Yes, but its nature has evolved.** 
While the original **"React Context Provider Hell"** was mitigated by migrating `authStore` and `debugStore` to Zustand and converting `useLibraryAccess` into a utility helper function, the application still suffers from **state fragmentation, architectural boundary blurring, and disparate plumbing mechanisms**:

1. **Four Concurrent State Paradigms Coexist**:
   - **Zustand Client Stores**: `appStore.ts`, `uiStore.ts`, `authStore.tsx`, `debugStore.tsx`
   - **TanStack React Query Cache & tRPC**: Server state for libraries, books, permissions, and background AI tasks
   - **URL Query Parameters (`useSearchParams`)**: View modes, search queries, multi-faceted taxonomy filters, active tabs, and modal triggers
   - **Local Component State & Plumbing**: `useState`, `useRef`, `sessionStorage` scroll caching, and `trpcVanilla` imperative mutation pipelines
2. **Impure Store Boundaries**:
   - `authStore.tsx` and `debugStore.tsx` are named with `.tsx` extensions despite having zero JSX, and mix state management with side-effects (Firebase event listeners, dynamic tRPC imports, direct telemetry singleton pub/sub, `sessionStorage` sync).
3. **Dual Mutation Pathways (Declarative vs. Imperative)**:
   - Server mutations in `useSelection.ts`, `useLibraries.ts`, `useSpruceUp.ts`, and `useBulkEnrichment.ts` bypass React Query's `useMutation` hooks in favor of imperative `trpcVanilla` async calls wrapped in telemetry hooks (`instrumentMutation`), forcing components to manually manage `isSubmitting`, `processingIds`, and rollback snapshots with custom `useState` plumbing.
4. **Cache Seeding Inconsistencies**:
   - Cache pre-seeding occurs in mixed locations (`useEffect` in `useLibraries.ts`, `handleWarmup` in `LibraryCard.tsx`) mixing tRPC utils (`utils.library.get.setData`) with raw React Query cache keys (`queryClient.setQueryData(['libraryPermissions', ...])`).

---

## 1. Deep Codebase State Inventory & Current State Audit

Below is a complete matrix mapping every state-holding structure in the application, its current paradigm, its lifecycle scope, and its architectural health:

| State Artifact | File Path | Paradigm | Scope / Domain | Health / Architectural Assessment |
| :--- | :--- | :--- | :--- | :--- |
| **`useAppStore`** | `src/stores/appStore.ts` | Zustand + `persist` middleware | Global UI (Theme Mode: `light`/`dark`/`system`) | **Clean**: Well-isolated, typed, persisted to `localStorage` under key `app-ui-state`. |
| **`useUIStore`** | `src/stores/uiStore.ts` | Zustand | Ephemeral Global UI (`selectedBookIds: Set<string>`) | **Partially Fragmented**: Clean store, but wrapped by `useSelection.ts` which introduces `trpcVanilla` mutations and local toast handling. |
| **`useAuthStore`** | `src/stores/authStore.tsx` | Zustand + Side-effects | Global Auth (`user`, `isAdmin`, `isAuthReady`, `authError`) | **Impure**: Named `.tsx` without JSX; contains Firebase `onAuthStateChanged` lifecycle, dynamic tRPC imports, and `sessionStorage` sync. Top-level initialized in `App.tsx`. |
| **`useDebugStore`** | `src/stores/debugStore.tsx` | Zustand + Singleton bridge | Global Debug & Telemetry (`isDebugMode`, `profilingLevel`, `logs`, `debugData`) | **Impure**: Named `.tsx` without JSX; bridges bidirectional state with `DebugTelemetryEngine` singleton outside React. |
| **`getAccessFromLibrary`** | `src/hooks/useLibraryAccess.tsx` | Pure TS Function | Authorization / ABAC Role resolution | **Misnamed**: Named `.tsx` and prefixed `use...`, but is a pure calculation function with no hooks or context. |
| **`useBookFilters`** | `src/hooks/useBookFilters.ts` | URL SearchParams (`react-router-dom`) | Library Filters (`q`, `genre`, `subgenre`, `author`, `yearMin`, `yearMax`, `sort`, `order`, `view`, `tab`) | **Good Pattern**: URL is the single source of truth for bookmarkable filter state. |
| **`useLibraryData`** | `src/hooks/useLibraryData.ts` | TanStack Query via tRPC (`trpc.library.get`, `trpc.book.list`) | Server State (Library details & books collection) | **Refactored**: Declarative query facade with idle-deferred telemetry logging. |
| **`useLibraries`** | `src/pages/dashboard/useLibraries.ts` | TanStack Query + local `useState` | Server State (Library list, scope filters, creation mutation) | **Mixed**: Uses declarative `useQuery` and `useMutation`, but mixes in manual `useState` for `isSubmitting` and `useEffect` pre-seeding. |
| **`useAppPermissions`** | `src/hooks/useAppPermissions.ts` | TanStack Query via tRPC (`trpc.auth.getPermissions`) | Server Authorization (Allowlist check & Admin role) | **Clean**: Declarative query with 5-minute staleTime. |
| **`useLibraryPermissions`** | `src/hooks/useLibraryPermissions.ts` | TanStack Query via tRPC (`trpc.library.getPermissions`) | Server Authorization (Per-library RBAC/ABAC role) | **Clean**: Declarative query with fast-path for superadmin. |
| **`usePickOfTheDay`** | `src/hooks/usePickOfTheDay.ts` | Local `useState` / `useEffect` + Client Seed | Ephemeral recommendation | **Isolated**: Reads books from props, selects book deterministically based on date seed. |
| **`useConstellationData`** | `src/hooks/useConstellationData.ts` | `useMemo` computation | Client derived 2D/3D embedding vectors | **Clean**: Pure derived state over `books`. |
| **`useBulkEnrichment`** | `src/hooks/useBulkEnrichment.ts` | Local `useState` + `useRef` + `trpcVanilla` + Bottleneck | Long-running client worker pipeline | **Complex Plumbing**: Manages in-flight batches, cancellation tokens, progress counters, and telemetry manually. |
| **`useSpruceUp`** | `src/pages/spruce-up/useSpruceUp.ts` | TanStack Query + local `useState` + `trpcVanilla` | Deduplication analysis & deletions | **Mixed**: Manual optimistic cache mutation via `utils.book.list.setData` paired with imperative `trpcVanilla.book.delete`. |
| **`LibraryView.tsx`** | `src/pages/LibraryView.tsx` | Local `useState` + `useSearchParams` + `sessionStorage` | View plumbing (Modals, scroll restoration) | **Plumbing-Heavy**: Manages modal visibility, scroll positions, URL parameters, and manual mutation handlers. |

---

## 2. Root Problems & Architectural Friction Points

### 2.1. Fragmentation Point 1: Imperative `trpcVanilla` vs. Declarative `useMutation`
In several hooks and pages (`useSelection.ts`, `useSpruceUp.ts`, `useBulkEnrichment.ts`, `LibraryView.tsx`), mutations are executed using `trpcVanilla.<router>.<procedure>.mutate()` instead of standard React Query `trpc.<router>.<procedure>.useMutation()`.

```
[Component / Hook]
       │
       ├── Reads via Declarative Query ──► React Query Cache (trpc.book.list.useQuery)
       │
       └── Writes via Imperative Call ──► trpcVanilla.book.batchUpsert.mutate()
                                                │
                                                ▼ (Bypasses React Query Lifecycle)
                                          Manual useState(isSubmitting)
                                          Manual utils.book.list.invalidate()
```

**Consequences:**
- Components duplicate loading/submitting state in local `useState` (`isSubmitting`, `processingIds`).
- Error and retry states are handled manually in `try/catch` blocks rather than via React Query mutation lifecycle handlers (`onMutate`, `onError`, `onSettled`).
- Mutation states cannot be observed across disparate UI elements (e.g., header cannot show global sync indicator for an in-flight bulk edit triggered in a sub-view).

### 2.2. Fragmentation Point 2: Impure Zustand Stores with Side Effects
`src/stores/authStore.tsx` and `src/stores/debugStore.tsx` violate the principle of single responsibility:
- `authStore.tsx` subscribes directly to Firebase's `onAuthStateChanged`, dynamically imports `../lib/trpc`, and dispatches background profile sync mutations to `sessionStorage`.
- `debugStore.tsx` synchronizes state imperatively with the `DebugTelemetryEngine` class singleton, leading to two parallel log streams and potential state desynchronization.
- Both files use `.tsx` file extensions despite containing no JSX elements, causing confusion regarding their role as React components vs. pure state stores.

### 2.3. Fragmentation Point 3: Heterogeneous URL vs. Zustand State Boundaries
Selection state (`selectedBookIds`) is stored in Zustand (`useUIStore`), while filtering state (`genre`, `sort`, `searchQuery`) is stored in URL Search Params (`useSearchParams`).
- When a user performs a search or changes filters, `selectedBookIds` can still hold IDs of books that are now filtered out of the active shelf view.
- Clearing filters does not synchronize with selection state unless explicitly coordinated by parent page plumbing.

### 2.4. Fragmentation Point 4: Component-Level Local State Overload in Page Hubs
`LibraryView.tsx` acts as an orchestration hub that wires together:
- `useLibraryData` (Server query)
- `useBookFilters` (URL search params)
- `useSelection` (Zustand + tRPC mutations)
- `usePickOfTheDay` (Local computation)
- `useDebugInspect` (Telemetry registration)
- 3 separate `useState` flags for modal dialogues (`isSettingsOpen`, `isAdvancedSettingsOpen`, `libraryToDelete`)
- `sessionStorage` scroll restoration listeners
- URL query-parameter side effects (`?settings=true`, `?share=true`)

This creates heavy prop-drilling down to `LibraryHeader`, `LibraryOverview`, `LibraryCollection`, and `BulkActionsBar`.

---

## 3. Comparison of Unification Strategies

We evaluated three potential state management architectures for the codebase:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             ARCHITECTURAL COMPARISON                             │
├────────────────────────┬────────────────────────┬────────────────────────────────┤
│ Option 1 (Recommended) │ Option 2               │ Option 3                       │
│ "Strict 4-Pillar       │ "Fat Zustand Store"    │ "Minimalist React Query + URL" │
│ Clean Architecture"    │                        │                                │
├────────────────────────┼────────────────────────┼────────────────────────────────┤
│ • Server State: 100%   │ • Everything (Server & │ • Server: React Query          │
│   tRPC / React Query   │   Client) mirrored in  │ • Client State: URL Params     │
│ • Client State: Pure   │   Zustand slices       │   + lightweight Context        │
│   Zustand Stores       │ • Manual sync with     │ • Zero Zustand stores          │
│ • Navigation: URL      │   backend endpoints    │                                │
│ • Local: useState      │                        │                                │
└────────────────────────┴────────────────────────┴────────────────────────────────┘
```

### Detailed Evaluation Matrix

| Criterion | Option 1: 4-Pillar Clean Architecture (Recommended) | Option 2: Fat Zustand Slices | Option 3: Query + URL (No Zustand) |
| :--- | :--- | :--- | :--- |
| **Separation of Concerns** | **Excellent**: Clear boundaries between server cache, client settings, URL state, and local UI. | **Poor**: Server data mirrored in client store, creating dual-cache synchronization hazards. | **Fair**: Context re-render issues re-emerge for theme and auth. |
| **Refactoring Risk** | **Low**: Aligns with existing tRPC & Zustand setup; eliminates boilerplate incrementally. | **High**: Requires rewriting all queries and mutations into Zustand action creators. | **Medium**: Requires replacing Zustand with Context / URL params. |
| **Developer Ergonomics** | **High**: Standardized `trpc.<router>.<proc>.useQuery` and `useMutation` with autocomplete. | **Medium**: Custom action dispatchers and manual cache normalization required. | **Medium**: Complex URL serialization for non-primitive UI states. |
| **Performance** | **Optimal**: Granular selectors, zero unnecessary top-level re-renders, automatic GC. | **Good**: Fast selectors, but high memory footprint due to duplicated cache. | **Risk**: Top-level Context changes trigger cascading subtree re-renders. |

---

## 4. Recommended Target Architecture: The 4-Pillar State Model

To eliminate fragmentation and establish clear data flow guidelines, the codebase will adhere strictly to the **4-Pillar State Architecture**:

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                               4-PILLAR STATE ARCHITECTURE                            │
├─────────────────────────┬──────────────────────────┬─────────────────────────────────┤
│ Pillar                  │ Technology Layer         │ Concrete Scope                  │
├─────────────────────────┼──────────────────────────┼─────────────────────────────────┤
│ 1. Server State         │ TanStack React Query +   │ Libraries, Books, Collaborators,│
│                         │ tRPC Client              │ Permissions, AI Tasks, Mutations│
├─────────────────────────┼──────────────────────────┼─────────────────────────────────┤
│ 2. Global Client State  │ Pure Zustand Stores      │ Theme (`appStore.ts`),          │
│                         │ (`src/stores/*.ts`)      │ Selection (`uiStore.ts`),       │
│                         │                          │ Auth session (`authStore.ts`),  │
│                         │                          │ Telemetry toggles (`debugStore`)│
├─────────────────────────┼──────────────────────────┼─────────────────────────────────┤
│ 3. Navigation State     │ React Router 6           │ Search queries, Filters, Sorts, │
│                         │ (`useSearchParams`)      │ Active Tabs, Deep-link modals   │
├─────────────────────────┼──────────────────────────┼─────────────────────────────────┤
│ 4. Local Component State│ React `useState` /       │ Modal open/close, Form inputs,  │
│                         │ `useRef` / `useMemo`     │ Canvas animations, Dropdowns    │
└─────────────────────────┴──────────────────────────┴─────────────────────────────────┘
```

### Governing Rules for Each Pillar

1. **Rule 1 (Server State)**:
   - ALL network calls MUST flow through tRPC query hooks (`trpc.<domain>.<proc>.useQuery`) or mutation hooks (`trpc.<domain>.<proc>.useMutation`).
   - Mutations MUST declare `onMutate`, `onError`, and `onSettled` via `trpc.useUtils()` for optimistic updates and invalidation.
   - Raw `trpcVanilla` calls are strictly restricted to non-React workers, background task utilities, and test suites.

2. **Rule 2 (Global Client State)**:
   - Zustand store files MUST use the `.ts` extension (not `.tsx`) and contain NO JSX or component wrappers.
   - Store definitions MUST be pure: external side effects (e.g., Firebase listeners, DOM event listeners) must be managed via explicit lifecycle services or top-level hooks, not embedded inside action functions.
   - Consuming components MUST use granular selectors (e.g., `useUIStore(state => state.selectedBookIds)`) to avoid redundant re-renders.

3. **Rule 3 (Navigation State)**:
   - Any UI state that a user would expect to persist across browser refresh, bookmark, or link-sharing (e.g., active filters, search query, sort ordering, active tab) MUST live in URL search parameters.
   - Use typed facade hooks like `useBookFilters` to read and write URL parameters.

4. **Rule 4 (Local Component State)**:
   - Ephemeral UI state that is strictly isolated to a single component (e.g., dropdown expanded state, hover tooltip, local form text input before submission) MUST use standard `useState` or `useRef`.
   - Never lift local state to Zustand unless at least two structurally distant subtrees require synchronous access to it.

---

## 5. Step-by-Step Implementation & Refactoring Roadmap

### Phase 1: Store Hygiene & Cleanup (Zero-Risk)
1. **Rename Files**:
   - `src/stores/authStore.tsx` ➔ `src/stores/authStore.ts`
   - `src/stores/debugStore.tsx` ➔ `src/stores/debugStore.ts`
   - `src/hooks/useLibraryAccess.tsx` ➔ `src/lib/permissions.ts` (or `src/utils/libraryAccess.ts`)
2. **Purge Side Effects from `authStore.ts`**:
   - Extract the Firebase `onAuthStateChanged` listener and profile sync mutation into an explicit `initAuthListener()` service function called once in `src/main.tsx` or `App.tsx`.
   - Keep `authStore.ts` as a pure Zustand state container (`user`, `isAdmin`, `isAuthReady`, `authError`, `setUser`, `setAuthError`).
3. **Harmonize `debugStore.ts` with `telemetry.ts`**:
   - Ensure `useDebugStore` cleanly subscribes to `DebugTelemetryEngine` without circular dependencies or dual log collections.

### Phase 2: Standardize Mutations to Declarative `trpc.useMutation`
1. **Refactor `useSelection.ts`**:
   - Convert `handleBulkStatusChange` and `handleBulkDelete` from `trpcVanilla` to `trpc.book.batchUpsert.useMutation()`.
   - Leverage `onMutate` to snapshot previous book lists and `onSuccess` to invalidate `utils.book.list`.
2. **Refactor `useSpruceUp.ts`**:
   - Convert `handleDelete` and `handleAllowDuplicateGroup` to declarative `useMutation` hooks with structured optimistic rollback.
3. **Refactor `useLibraries.ts`**:
   - Standardize `createLibraryMutation` and image generation mutation handling to eliminate manual `isSubmitting` tracking.

### Phase 3: Selection & Filter Synchronization
1. **Selection Pruning on Filter Change**:
   - In `useBookFilters.ts` / `useSelection.ts`, provide an automated helper to prune selected book IDs that no longer exist in the filtered book array, preventing phantom bulk actions on invisible items.

### Phase 4: Verification & Test Alignment
1. **Unit Test Updates**:
   - Verify `authStore.test.ts`, `useLibraryData.test.ts`, `useSelection.test.tsx`, and `DebugConsoleHUD.test.tsx`.
2. **Lint & Type Check**:
   - Run `npx gts lint` and `compile_applet` to ensure full end-to-end type safety and zero regressions.

---

## 6. Summary of Architectural Outcomes

By executing this unification plan, the codebase achieves:
- **Zero Ambiguity**: Every state variable has a singular, well-defined home across the 4 pillars.
- **Predictable Data Flow**: Server data always flows downward via tRPC queries; mutations always flow through declarative `useMutation` hooks.
- **Maximized Performance**: Granular Zustand selectors and native TanStack Query cache deduplication prevent unwanted re-renders.
- **Simplified Testing**: Pure stores and declarative hooks are trivial to mock and test in isolation.
