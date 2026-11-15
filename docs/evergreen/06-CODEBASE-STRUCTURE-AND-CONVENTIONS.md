# 06. Codebase Structure, Naming, Style Guide & Testing Conventions

> **Parent Document:** [Evergreen Architecture & Engineering Guidelines](./README.md)  
> **Scope:** Repository Layout, Casing Rules, Barrel Exports, Router Organization, Google TypeScript Style Guide Compliance, Test Co-Location, and Minimum Test Coverage Standards

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
    ├── lib/                          # Pure client utilities, clustering/telemetry packages & gateway helpers
    ├── services/                     # Browser lifecycle listeners (authListener.ts)
    ├── constants/                    # Immutable domain constants, taxonomies, Decisions catalogs & plugin descriptors (enrichmentDescriptors.ts, visualizerDescriptors.ts)
    ├── types/                        # Shared TypeScript domain interfaces & DTOs (index.ts barrel, readingTracker.ts, metadata.ts)
    ├── schemas/                      # Shared Zod runtime validation schemas (common.ts, book.ts, libraryApi.ts, decisions.ts)
    └── server/                       # Server-only boundary (NEVER imported by browser code; enforced by ESLint)
        ├── auth/                     # JWT verification, RBAC/ABAC permissions & procedures
        ├── middleware/               # Express security headers, rate limiting & SSE guards
        ├── trpc/
        │   ├── trpc.ts               # tRPC initialization & procedure re-exports
        │   └── routers/              # 1-to-1 domain routers + _app.ts root router (`readingTracker`, `enrichment`, `metadata`, etc.)
        └── services/                 # Modular server domain service packages (`book/`, `library/`, `readingTracker/`, `catalog/`, `metadata/`, `gemini/`)
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

1. **Single Canonical Entry Point per Module & Provider Barrel Encapsulation:**
   - When a domain service, math engine, or type module grows into a multi-file directory (e.g., `src/types/`, `src/lib/clustering/`, `src/lib/telemetry/`, `src/server/services/book/`, `src/server/services/library/`, `src/server/services/readingTracker/`, `src/server/services/gemini/`, `src/server/services/catalog/`, `src/server/services/metadata/`), expose its public surface via `index.ts` inside that directory and keep individual implementation modules focused (<1,000 LOC).
   - **Never** create a redundant 1-line sibling re-export file (such as `src/types.ts` next to `src/types/index.ts`, or `bookService.ts` next to `book/index.ts`). Every module must have exactly one import path.
   - External server callers must import metadata and catalog providers through `src/server/services/metadata` or `src/server/services/catalog` (deep imports into `providers/*` outside those packages are blocked by `eslint.config.cjs`).
2. **Typed Plugin Registries (Open-Closed Extensibility):**
   - **Metadata Enrichment**: Declared in `src/constants/enrichmentDescriptors.ts` (`ENRICHMENT_DESCRIPTORS`) and executed via `MetadataPlugin<Output>` registrations in `MetadataRegistry` (`src/server/services/metadata/`).
   - **Catalog Sources**: Declared via `CatalogSourceProvider` implementations registered in `src/server/services/catalog/providerManifest.ts` (`createDefaultCatalogProviders()`), driving wave scheduling and structured-series authority in `CatalogOrchestrator`.
   - **Interactive Visualizers**: Declared in `src/constants/visualizerDescriptors.ts` (`VISUALIZER_DESCRIPTORS`) with per-visualizer progressive unlock readiness (`computeReadiness`).
   - See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for step-by-step plugin recipes.
3. **1-to-1 tRPC Router Mapping:**
   - Every top-level namespace on `appRouter` in `src/server/trpc/routers/_app.ts` must live in its own dedicated file inside `src/server/trpc/routers/`:
     - `auth` → `auth.ts`
     - `user` → `user.ts`
     - `library` → `libraryApi.ts`
     - `book` → `bookApi.ts`
     - `readingTracker` → `readingTracker.ts`
     - `enrichment` → `enrichmentApi.ts`
     - `metadata` → `metadata.ts`
     - `gemini` → `gemini.ts`
4. **Strict Client/Server Boundary (Enforced in `eslint.config.cjs`):**
   - Files under `src/server/` and `firebase-admin` may never be imported by browser components, hooks, or stores (except `import type {AppRouter}` in `src/lib/trpc.ts`). Shared DTOs (such as `src/types/readingTracker.ts`) must reside in `src/types/` or `src/schemas/`.
   - Browser and server code must never import `firebase/firestore` or `@firebase/firestore`. Client-side mutation wrappers (`storage.ts`, `bookActions.ts`, `sanitizeStorage.ts`) live in `src/lib/` and delegate 100% of persistence to `trpc`.

---

## 4. Google TypeScript Style Guide Compliance

The repository adheres to the official [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) and enforces compliance automatically via `gts` (`eslint.config.cjs`, `tsconfig.json`, and `.prettierrc.cjs`).

### Core Enforced Rules
1. **Named Exports Only (`no-default-export` in `src/`):**
   - Always use named exports (`export function ...`, `export const ...`, `export interface ...`). Default exports (`export default`) are banned across `src/` so every symbol retains a single canonical identifier across imports, refactoring tools, and search.
   - When code-splitting route views with `React.lazy`, resolve the named export explicitly:
     ```ts
     const Dashboard = lazy(() =>
       import('./pages/Dashboard').then(m => ({default: m.Dashboard})),
     );
     ```
2. **Named `function` Declarations Over Top-Level Arrow Functions & `React.FC`:**
   - Declare React components and top-level helper functions using standard `function` declarations (`export function BookCard(props: BookCardProps)`), or named function expressions inside higher-order wrappers (`export const BookCard = React.memo(function BookCard(props: BookCardProps) { ... })`).
   - Do not use `React.FC` or `FunctionComponent` type annotations.
3. **`interface` Over `type` for Object Shapes & `T[]` Array Syntax:**
   - Declare object shapes with `interface` rather than `type` aliases (`@typescript-eslint/consistent-type-definitions: ['error', 'interface']`). Reserve `type` for unions, intersections, and mapped types.
   - Use `T[]` or `readonly T[]` for simple array types and `Array<...>` for complex union/function types (`@typescript-eslint/array-type: ['error', {default: 'array-simple'}]`).
4. **No Redundant `public` Modifiers:**
   - Class properties, methods, and constructors are public by default in TypeScript. Never add the explicit `public` keyword (`@typescript-eslint/explicit-member-accessibility: ['error', {accessibility: 'no-public'}]`). Use `readonly` directly on constructor parameter properties (`constructor(readonly id: string)`), and use `private` or `protected` for non-public members.
5. **Whole-Word CamelCase for Acronyms & No Hungarian Prefixes (§ 7.2):**
   - Treat acronyms and initialisms of 3+ letters as whole words in both `PascalCase` and `camelCase` identifiers and filenames: write `CsvImportTab`, `ScanIsbnTab`, `DebugConsoleHud`, `handleExportToCsv`, and `isbn` rather than `CSVImportTab`, `ScanISBNTab`, `DebugConsoleHUD`, `handleExportToCSV`, or `ISBN`.
   - Never prefix interfaces with Hungarian `I` (`MetadataPlugin`, `CatalogSourceProvider`, `GlobalConcurrencyGovernor` — never `IMetadataPlugin`) and never prefix multi-letter generic type parameters with Hungarian `T` (`MetadataPlugin<Output>`, `SchemaValidationResult<Payload>`, or single-letter `<T>` — never `<TOutput>`). Both rules are enforced via `@typescript-eslint/naming-convention`.
6. **Mandatory Braces on All Control Flow (`curly`):**
   - Every `if`, `else`, `for`, `while`, and `do` statement must use curly braces (`{ ... }`), even when the body is a single statement (`curly: ['error', 'all']`).
7. **Zero `any` & Strict Type-Checked Linting Across Production & Test Files:**
   - `tsconfig.json` enforces `"strict": true`, `"noImplicitReturns": true`, `"noFallthroughCasesInSwitch": true`, `"noImplicitOverride": true`, and `"useUnknownInCatchVariables": true` across all source and co-located test files.
   - `eslint.config.cjs` enforces `@typescript-eslint/no-explicit-any: 'error'` together with full type-checked `no-unsafe-*` rules (`no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, `no-unsafe-argument`), `no-unnecessary-type-assertion`, `await-thenable`, `no-misused-promises`, `only-throw-error`, and `prefer-promise-reject-errors` across 100% of the repository, including `*.test.ts` and `*.test.tsx`. Prefer `unknown` with runtime narrowing or Zod schemas, `Partial<T>`, `Parameters<typeof fn>`, and typed `vi.fn<Signature>()` helpers over `any` or redundant assertions.
   - Lint and compiler suppressions (`eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`) are prohibited (`@typescript-eslint/ban-ts-comment: 'error'`).

### Intentional React & Vite Framework Exceptions
- **`PascalCase.tsx` Component Filenames:** While Google's general TypeScript guide uses `snake_case` or `camelCase` filenames, **book(ish)** follows the idiomatic React convention of `PascalCase.tsx` for React views/components and `camelCase.ts` for hooks/utilities (as defined in Section 2).
- **Root Tooling Config (`vite.config.ts`):** Vite's configuration loader requires a default export in `vite.config.ts`; therefore, the ban on `ExportDefaultDeclaration` is scoped to `src/**/*`.

---

## 5. Test Co-Location & 1-to-1 Coverage Standard

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

## 6. Minimum Test Coverage & Verification Invariants

Every pull request or feature addition must satisfy three verification pillars before completion:

1. **Security & Boundary Enforcement:**
   - Router and service tests must verify unauthenticated rejection (`UNAUTHORIZED`), cross-tenant / cross-user IDOR rejection (`FORBIDDEN`), and Zod input boundary enforcement (MIME allowlists, payload size caps, safe IDs, and batch length ceilings).
2. **Deterministic Mathematical & Layout Invariants:**
   - Stochastic algorithms (K-Means++, silhouette optimal-$K$, force-directed layout relaxation, UMAP worker pipelines) must be tested with fixed PRNG seeds and assert strict geometric invariants (e.g., non-overlapping cluster bounding circles, $[-range, range]$ coordinate bounds, and $[-1, 1]$ silhouette bounds).
3. **Asynchronous Resilience & Cancellation:**
   - Outbound provider orchestrators, rate-limit governors, and batch enrichment utilities must test both happy paths and degraded/cancelled paths (`AbortSignal` propagation, 429 quota backoff, interactive slot reservation, and ring-buffer bounding).
4. **100% Read/Write Schema & Test Fixture Compliance (`src/schemas/schemaCompliance.ts` & `src/lib/schema.test.ts`):**
   - Every Firestore or disk read and write in `src/server/**` must route through a typed `*Converter` (`fromFirestore` / `toFirestoreWrite`) and shared strict validators (`validateFirestoreReadPayload`, `validateFirestoreWritePayload`, `validateIncomingApiData`).
   - Unit and integration tests mocking Firestore snapshots (`doc.data()`) must return payloads that satisfy the corresponding `stored*DocSchema` (using the typed fixture builders in `src/schemas/schemaCompliance.ts`), and both `src/lib/schema.test.ts` and `src/schemas/schemaCompliance.test.ts` must pass with zero unvalidated collections or snapshot casts.

