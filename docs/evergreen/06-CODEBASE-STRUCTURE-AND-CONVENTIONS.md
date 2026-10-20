# 06. Codebase Structure, Naming & Testing Conventions

> **Parent Document:** [Evergreen Architecture & Engineering Guidelines](./README.md)  
> **Scope:** Repository Layout, Casing Rules, Barrel Exports, Router Organization, Test Co-Location, and Minimum Test Coverage Standards

---

## 1. Canonical Directory Topology

The **book(ish)** monorepo follows a strict, layered folder structure with clear boundaries between browser presentation code, shared contracts, and server-only execution:

```text
/
├── server.ts                         # Express + tRPC v11 + SSE server entry point
├── docs/
│   └── evergreen/                    # Authoritative living architecture documentation
└── src/
    ├── components/
    │   ├── ui/                       # Foundational UI primitives (kebab-case.tsx)
    │   └── <domain>/                 # Shared domain components (PascalCase.tsx)
    ├── pages/
    │   ├── <ViewName>.tsx            # Top-level route views (PascalCase.tsx)
    │   └── <feature-slug>/           # View-scoped sub-components, math engines & hooks
    ├── hooks/                        # Shared React hooks (use*.ts)
    ├── stores/                       # Ephemeral Zustand UI stores (*Store.ts)
    ├── workers/                      # Web Workers (*.worker.ts)
    ├── lib/                          # Pure client utilities & gateway helpers (camelCase.ts)
    ├── services/                     # Browser lifecycle listeners (authListener.ts)
    ├── constants/                    # Immutable domain constants & taxonomies (camelCase.ts)
    ├── types/                        # Shared TypeScript domain interfaces (index.ts barrel)
    ├── schemas/                      # Shared Zod runtime validation schemas (camelCase.ts)
    └── server/                       # Server-only boundary (NEVER imported by browser code)
        ├── auth/                     # JWT verification, RBAC/ABAC permissions & procedures
        ├── middleware/               # Express security headers, rate limiting & SSE guards
        ├── trpc/
        │   ├── trpc.ts               # tRPC initialization & procedure re-exports
        │   └── routers/              # 1-to-1 domain routers + _app.ts root router
        └── services/                 # Server domain service packages & orchestrators
```

---

## 2. File & Identifier Naming Conventions

| Layer / Artifact | File Naming Pattern | Exported Symbol Casing | Examples |
| :--- | :--- | :--- | :--- |
| **React Route Views & Domain Components** | `PascalCase.tsx` | `PascalCase` | `LibraryView.tsx`, `BookCard.tsx`, `ShareLibraryModal.tsx` |
| **UI Primitives (`src/components/ui/`)** | `kebab-case.tsx` | `PascalCase` | `button.tsx`, `dropdown-menu.tsx`, `star-rating.tsx` |
| **Feature Sub-Directories (`src/pages/`)** | `kebab-case/` | N/A | `src/pages/book-details/`, `src/pages/spruce-up/` |
| **React Hooks** | `use<Name>.ts(x)` | `camelCase` (`use...`) | `useLibraryData.ts`, `useBookFilters.ts` |
| **Zustand Stores (`src/stores/`)** | `<domain>Store.ts` | `camelCase` (`use...Store`) | `authStore.ts`, `uiStore.ts` |
| **Web Workers (`src/workers/`)** | `<domain>.worker.ts` | Message handler | `umap.worker.ts`, `duplicateDetection.worker.ts` |
| **Schemas, Utilities & Routers** | `camelCase.ts` | `camelCase` / `PascalCase` | `libraryApi.ts`, `date.ts`, `securityGateway.ts` |
| **Catalog Source Providers** | `<Vendor>Provider.ts` | `PascalCase` class | `OpenLibraryProvider.ts`, `GoogleBooksProvider.ts` |
| **Service Orchestrators & Coordinators** | `camelCase.ts` | `PascalCase` class + `camelCase` singleton | `catalogOrchestrator.ts`, `enrichmentJobCoordinator.ts` |

---

## 3. Module Resolution & Barrel Rules (No Sibling Shims)

1. **Single Canonical Entry Point per Module:**
   - When a domain service or type module grows into a multi-file directory (e.g., `src/types/`, `src/lib/telemetry/`, `src/server/services/book/`, `src/server/services/library/`, `src/server/services/gemini/`, `src/server/services/catalog/`, `src/server/services/metadata/`), expose its public surface via `index.ts` inside that directory.
   - **Never** create a redundant 1-line sibling re-export file (such as `src/types.ts` next to `src/types/index.ts`, or `bookService.ts` next to `book/index.ts`). Every module must have exactly one import path.
2. **1-to-1 tRPC Router Mapping:**
   - Every top-level namespace on `appRouter` in `src/server/trpc/routers/_app.ts` must live in its own dedicated file inside `src/server/trpc/routers/`:
     - `auth` → `auth.ts`
     - `user` → `user.ts`
     - `library` → `libraryApi.ts`
     - `book` → `bookApi.ts`
     - `enrichment` → `enrichmentApi.ts`
     - `metadata` → `metadata.ts`
     - `gemini` → `gemini.ts`
3. **Strict Client/Server Boundary:**
   - Files under `src/server/` may never be imported by browser components, hooks, or stores (except `import type {AppRouter}` in `src/lib/trpc.ts`).
   - Browser code must never contain a `db/` directory or import `firebase/firestore`. Client-side mutation wrappers (`storage.ts`, `bookActions.ts`, `sanitizeStorage.ts`) live in `src/lib/` and delegate 100% of persistence to `trpc`.

---

## 4. Test Co-Location & 1-to-1 Coverage Standard

1. **100% Co-Located Tests (`*.test.ts` / `*.test.tsx`):**
   - Every unit, integration, schema, worker, store, and security test file must sit in the **exact same directory** as the source file it tests and share its base filename:
     - `src/schemas/common.ts` → `src/schemas/common.test.ts`
     - `src/server/middleware/securityGateway.ts` → `src/server/middleware/securityGateway.test.ts`
     - `src/server/services/book/bookPartitioner.ts` → `src/server/services/book/bookPartitioner.test.ts`
     - `src/server/trpc/routers/bookApi.ts` → `src/server/trpc/routers/bookApi.test.ts`
     - `src/workers/umap.worker.ts` → `src/workers/umap.worker.test.ts`
2. **No Isolated `__tests__/` Subdirectories:**
   - Do not create `__tests__/` folders anywhere in `src/`. Keeping tests adjacent to implementation files ensures immediate visibility of test coverage and shallow relative imports.
3. **1-to-1 Router, Service, Math Engine, Worker & Store Invariant:**
   - **Routers**: Every domain router in `src/server/trpc/routers/` (`auth.ts`, `user.ts`, `libraryApi.ts`, `bookApi.ts`, `enrichmentApi.ts`, `metadata.ts`, `gemini.ts`) must have a dedicated co-located `*.test.ts` file exercising its procedures via `createCaller`.
   - **Backend Services & Auth**: Every core server service (`book`, `library`, `catalog`, `gemini`, `metadata`, `scheduler`, `telemetry`, `enrichmentService`, `enrichmentJobCoordinator`, `userService`, `geolocation`) and auth module (`tokenVerifier`, `allowlistService`, `waitlistService`, `permissions`, `procedures`, `context`) must maintain a co-located unit test suite.
   - **Pure Mathematical & Spatial Engines**: All clustering, geometry, chronological, and spatial modules (`clustering.ts`, `timelineMath.ts`, `worldMapMath.ts`, `duplicateDetection.ts`, `isbn.ts`, `date.ts`) and Web Workers (`umap.worker.ts`, `duplicateDetection.worker.ts`) must have deterministic unit test suites.
   - **Client RBAC, Gateway Helpers & Zustand Stores**: All client permission/gateway utilities (`permissions.ts`, `storage.ts`, `bookActions.ts`, `sanitizeStorage.ts`, `clientCache.ts`) and Zustand stores (`authStore.ts`, `appStore.ts`, `uiStore.ts`, `debugStore.ts`) must have co-located unit suites.

---

## 5. Minimum Test Coverage & Verification Invariants

Every pull request or feature addition must satisfy three verification pillars before completion:

1. **Security & Boundary Enforcement:**
   - Router and service tests must verify unauthenticated rejection (`UNAUTHORIZED`), cross-tenant / cross-user IDOR rejection (`FORBIDDEN`), and Zod input boundary enforcement (MIME allowlists, payload size caps, safe IDs, and batch length ceilings).
2. **Deterministic Mathematical & Layout Invariants:**
   - Stochastic algorithms (K-Means++, silhouette optimal-$K$, force-directed layout relaxation, UMAP worker pipelines) must be tested with fixed PRNG seeds and assert strict geometric invariants (e.g., non-overlapping cluster bounding circles, $[-range, range]$ coordinate bounds, and $[-1, 1]$ silhouette bounds).
3. **Asynchronous Resilience & Cancellation:**
   - Outbound provider orchestrators, rate-limit governors, and batch enrichment utilities must test both happy paths and degraded/cancelled paths (`AbortSignal` propagation, 429 quota backoff, interactive slot reservation, and ring-buffer bounding).
