# Contributing to book(ish)

Welcome to **book(ish)**! This guide helps engineers ramp up quickly, understand our architectural boundaries and Google TypeScript Style Guide (`gts`) conventions, and add new capabilities through our typed plugin registries without touching core orchestrators.

For deep dives into design tokens, state management, database schemas, and gateway security, read [`docs/evergreen/README.md`](./docs/evergreen/README.md) and its linked domain guides.

---

## 1. Architecture at a Glance

```text
Browser SPA (React 19 + TanStack Query + Zustand)
        │  Firebase ID Token (Bearer JWT)
        ▼
Unified tRPC v11 Gateway (`server.ts` → `src/server/trpc/routers/_app.ts`)
        │  Zod Input Validation + RBAC/ABAC Permission Guards
        ▼
Domain Services (`book`, `library`, `readingTracker`, `enrichment`, `catalog`, `metadata`, `gemini`)
        │  Typed Firestore Converters (`fromFirestore` / `toFirestoreWrite`)
        ▼
Cloud Firestore via `firebase-admin/firestore` (`firestore.rules` permanently sealed: `if false`)
```

### Non-Negotiable Architectural Boundaries (Enforced by ESLint)
1. **Zero Client Firestore SDK**: Browser bundles never import `firebase/firestore` or `@firebase/firestore`, and `firestore.rules` remains `allow read, write: if false;`.
2. **Strict Client-Server Isolation**: Files outside `src/server/` (except `src/lib/trpc.ts` importing `type AppRouter`) never import from `src/server/**` or `firebase-admin`. Shared contracts live in `src/types/`, `src/schemas/`, and `src/constants/`.
3. **Single-Barrel Package Encapsulation**: Multi-file packages (`src/types/`, `src/lib/clustering/`, `src/lib/telemetry/`, `src/server/services/book/`, `src/server/services/library/`, `src/server/services/readingTracker/`, `src/server/services/catalog/`, `src/server/services/metadata/`, `src/server/services/gemini/`) expose a single `index.ts` barrel. Never create sibling re-export shims, and never deep-import individual provider files from outside their package.
4. **100% Firestore Converter & Zod Compliance**: Every read and write across all 10 persisted collections passes through a typed `*Converter` and `validateFirestoreReadPayload` / `validateFirestoreWritePayload`.

---

## 2. Pre-PR Quality Gate (3 Commands)

Before opening or merging any change, all three checks must pass with **zero errors**:

```bash
# 1. Full TypeScript compiler verification across production and test files
npx tsc --noEmit

# 2. Google TypeScript Style Guide (gts) + Architectural Boundary ESLint check
npm run lint

# 3. Co-located unit, router, schema-compliance, and worker test suites
npx vitest run
```

---

## 3. Google TypeScript Style Guide (`gts`) Conventions

We follow the [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html), enforced automatically by `eslint.config.cjs`:

- **No Hungarian Prefixes (`I` or `T`)**:
  - Never prefix interfaces with `I` (`MetadataPlugin`, `CatalogSourceProvider`, `VisualizerDescriptor` — **never** `IMetadataPlugin`).
  - Never prefix multi-letter generic type parameters with `T` (`MetadataPlugin<Output>`, `SchemaValidationResult<Payload>`, or single-letter `<T>` — **never** `<TOutput>` or `<TInput>`).
- **Named Exports Only**: Never use `export default` in `src/`. Use `React.lazy(() => import('./pages/View').then(m => ({default: m.View})))` for route code-splitting.
- **Named `function` Declarations**: Use `export function BookCard(props: BookCardProps)` for top-level functions and React components instead of exported arrow functions or `React.FC`.
- **Whole-Word Acronym Casing**: Treat 3+ letter acronyms as normal words in `PascalCase` and `camelCase` (`IsbnLookup`, `CsvImportTab`, `DebugConsoleHud`, `normalizeIsbn`, `coverUrl`).
- **`interface` for Object Shapes & `T[]` for Simple Arrays**: Use `interface` for object contracts, `type` for unions/intersections, `string[]` for simple arrays, and `Array<A | B>` for complex element types.
- **No Redundant `public` Modifiers & Mandatory Braces**: Omit `public` on class members and always wrap `if` / `else` / `for` / `while` bodies in `{ ... }`.
- **Strict Type-Checked Linting, Zero `any` & Zero Suppressions**: `tsconfig.json` (`strict`, `noImplicitOverride`, `useUnknownInCatchVariables`) and `eslint.config.cjs` (`no-explicit-any`, `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, `no-unsafe-argument`, `no-unnecessary-type-assertion`, `await-thenable`, `no-misused-promises`, `only-throw-error`, `prefer-promise-reject-errors`, `ban-ts-comment`) are enforced as errors across all production and `*.test.ts(x)` files. Explicit or propagated `any`, `eslint-disable`, `@ts-ignore`, and `@ts-expect-error` are prohibited.

---

## 4. How to Extend the Platform (Plugin Recipes)

### Recipe A: Adding a Metadata Enrichment Plugin
 Enrichments (such as Genre, Temporal, Geo, Synopsis, Author Bio, Cover Image, Series, or Embeddings) are driven by declarative descriptors and `MetadataRegistry` — **no switch statements in `EnrichmentService` or `ManualEnrichmentSection`**.

1. **Add the Key & Descriptor**:
   - Add the enum member to `MetadataKey` in `src/types/metadata.ts` and status field (if persisted) in `src/schemas/book.ts`.
   - Append an `EnrichmentDescriptor` entry to `ENRICHMENT_DESCRIPTORS` in `src/constants/enrichmentDescriptors.ts` (defining `key`, `statusKey`, `aliases`, `label`, `description`, `requiresAiPlan`, `isCatalogPrimary`, and `providerLabel`).
2. **Implement `MetadataPlugin<Output>`**:
   - Create `src/server/services/metadata/providers/<Name>MetadataProvider.ts` implementing `MetadataPlugin<Output>` (or `MetadataProvider<Output>` plus a persistence entry in `src/server/services/metadata/pluginSpecs.ts`).
   - Validate all Firestore patches via `toPersistencePatch` returning `{bookUpdate, detailsUpdate?, resultPreview}`.
3. **Register & Test**:
   - Register the provider in `MetadataRegistry.ensureDefaultsRegistered()` (`src/server/services/metadata/registry.ts`) and export it from `src/server/services/metadata/index.ts`.
   - Add co-located unit tests in `src/server/services/metadata/providers/<Name>MetadataProvider.test.ts`.
   - Shelf Care's `ManualEnrichmentSection`, `enrichmentApi`, and `EnrichmentService` will automatically pick up the new flow!

### Recipe B: Adding an External Catalog Source Provider
Federated ISBN, title/author, and cover lookups are orchestrated by `CatalogOrchestrator` over `CatalogSourceProvider` plugins.

1. **Implement `CatalogSourceProvider`**:
   - Create `src/server/services/catalog/providers/<Vendor>Provider.ts` implementing `CatalogSourceProvider` from `src/server/services/catalog/types.ts`.
   - Configure a `ProviderQuotaScheduler` instance for rate-limiting and declare `authorityWeight` and `capabilities` (`isbnSearch`, `titleSearch`, `coverResolution`, `synopsis`, `series`, `genre`, `batchWave: 1 | 2`, `structuredSeries`).
2. **Register in the Manifest**:
   - Add the provider factory to `createDefaultCatalogProviders()` in `src/server/services/catalog/providerManifest.ts` and re-export from `src/server/services/catalog/index.ts`.
3. **Test**:
   - Add co-located tests (`<Vendor>Provider.test.ts`) covering normal hits, HTTP 429 backoff, and `AbortSignal` cancellation.

### Recipe C: Adding an Interactive Perspective Visualizer
Visualizers on the Reading Room and Library Overview strips (`Timeline`, `World Map`, `Constellation`, `Unread Triage`) are rendered from `VISUALIZER_DESCRIPTORS` with progressive unlock readiness.

1. **Build the Route View**:
   - Create `src/pages/<VisualizerName>View.tsx` (keeping pure math/layout helpers and session hooks in `src/pages/<visualizer-slug>/` with co-located `*.test.ts` suites and keeping each file well under 1,000 LOC).
2. **Register `VisualizerDescriptor`**:
   - Append a `VisualizerDescriptor` to `VISUALIZER_DESCRIPTORS` in `src/constants/visualizerDescriptors.ts` with `id`, `title`, `routeSuffix`, `libraryRoutePath`, optional `readingRoutePath`, `requiredPermission`, `iconName`, `scopes` (`['readingRoom', 'library']`), `loadComponent` (lazy dynamic import), and `evaluateReadiness(books)` returning `{isReady, badgeLabel, subtitleText, chartedCount, minBooksRequired}`.
   - `App.tsx` route registration, `routePreload.ts` chunk preloading, `ExplorePerspectivesStrip`, and `ReadingOnboardingStudio` automatically wire up the new route, RBAC guard, readiness badge, and progressive unlock hint!
