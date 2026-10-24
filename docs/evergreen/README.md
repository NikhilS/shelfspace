# book(ish) Evergreen Architecture & Engineering Guidelines

> **Status:** Living Document / Authoritative Architecture Standard  
> **Target Audience:** Core Contributors, AI Agents, and Staff Engineers  
> **Scope:** Entire Monorepo (`src/`, `server.ts`, `docs/`, `firestore.rules`)

---

## I. Executive Philosophy & The Modern Archivist

**book(ish)** is designed after the quiet focus and tangible permanence of a private scholarly library. It pairs physical-heritage craftsmanship with modern computing utility to create a durable, tactile, and enjoyable digital library system.

Every technical, typographic, and architectural decision in this repository must uphold three governing tenets:

1. **Craftsmanship over Clutter:**
   We strictly reject modern "AI slop"—arbitrary glassmorphism, heavy saturated purple-to-blue gradients, glowing drop shadows, and unsolicited widgets. Visual depth comes from **tonal layering**, crisp geometric typography, and generous negative space.
2. **Unified Data Authority & Gateway Architecture:**
   We maintain a unified data plane where 100% of data queries and mutations route through a single, type-safe tRPC v11 Gateway backed by `firebase-admin/firestore` on the server. The browser client application never imports or directly invokes the Firestore client SDK, and `firestore.rules` is permanently sealed (`allow read, write: if false;`).
3. **Deterministic Performance & Zero-Cost Observability:**
   Telemetry and debugging HUDs must never degrade user-perceived performance. Heavy operations (UMAP vector dimensionality reduction, image processing) execute off the main thread in Web Workers. Synchronous serialization and memory allocations are banned on critical render paths.

---

## II. The "Golden Rules" (Non-Negotiable Invariants)

These rules apply to every pull request, feature branch, and refactor:

| Domain | Invariant Rule |
| :--- | :--- |
| **Security** | **Direct client Firestore Web SDK usage is strictly forbidden.** Never re-introduce `firebase/firestore` into client bundles, and keep `firestore.rules` locked to `if false`. All client reads and mutations pass through server procedures with runtime Zod validation, RBAC/ABAC checks, and `firebase-admin/firestore`. |
| **Typography** | **Manrope is universal; Playfair Display Italic is reserved.** All UI, forms, tables, buttons, headers, and metadata use Manrope. Playfair Display (Italic) is strictly reserved for the top bar wordmark `book(ish)`. |
| **Aesthetics** | **No Pill Buttons for Actions.** Action buttons and tags must use rectilinear corners (`rounded` 4px or `rounded-lg` 8px) to respect the rectangular proportions of books and catalog cards. |
| **State** | **No `skipToken` React Query Abuses.** TanStack Query must never be used as a manual key-value store. It is reserved for declarative queries and optimistic mutations. Ephemeral UI state belongs in Zustand; URL parameters govern filterable views. |
| **Telemetry** | **Never `JSON.stringify` or allocate `Blob`s on the render path.** Payload calculations and telemetry logging must be deferred to `requestIdleCallback` or lightweight heuristics. |
| **API** | **Zod is the Single Source of Truth.** Input and output schemas defined in `src/schemas/` drive all tRPC v11 routers and runtime validation. |
| **Database** | **No Orphaned Books.** A book document cannot exist outside of a parent `libraries/{libraryId}/books/{bookId}` path. All library deletions must clean up subcollections. |
| **Voice & Microcopy** | **Warm, Friendly, Crisp.** All user-facing headings, descriptions, empty states, and modals speak in a warm, welcoming bookshop voice with crisp, concise phrasing—free of database or systems jargon (`records`, `payloads`, `leaks`, `volumes`). |
| **Code Style** | **Google TypeScript Style Guide (`gts`).** Enforce named exports only (no `export default` in `src/`), named `function` declarations over `React.FC`, whole-word CamelCase for acronyms (`Csv`, `Isbn`, `Hud`), `interface` for object shapes, braced control flow (`curly`), no redundant `public` modifiers, and zero `any` across both production and test files. |

---

## III. Evergreen Documentation Suite

The complete engineering standard is partitioned into specialized, domain-focused modules:

1. [**Design System & UI Guidelines**](./01-DESIGN-SYSTEM-AND-UI.md)  
   *Natural Materials Palette, Manrope typography hierarchy, tonal layering, tactile components, Warm/Friendly/Crisp voice & microcopy standards, monoline spot illustrations, and anti-slop rules.*

2. [**State Architecture & Data Flow**](./02-STATE-MANAGEMENT-AND-FRONTEND-ARCHITECTURE.md)  
   *Four-tier state taxonomy (Zustand, React Query, URL params, local state), optimistic mutation pipelines, and Web Worker offloading.*

3. [**API Architecture & Gateway**](./03-API-AND-EXTERNAL-GATEWAY.md)  
   *Internal tRPC v11 routers, procedure permission trees, Firebase ID Token (JWT) verification, SSE progress streaming, and rate limiting.*

4. [**Backend & Database Schema**](./04-BACKEND-AND-DATABASE-SCHEMA.md)  
   *Cloud Firestore document models, subcollection invariants, Zod runtime schemas, background job scaling, and Admin SDK practices.*

5. [**Cross-Cutting Concerns**](./05-CROSS-CUTTING-CONCERNS.md)  
   *Authentication & RBAC/ABAC allowlisting, telemetry budgets, developer HUD, caching lifecycles, and PWA/offline resiliency.*

6. [**Codebase Structure, Naming, Style Guide & Testing Conventions**](./06-CODEBASE-STRUCTURE-AND-CONVENTIONS.md)  
   *Canonical directory topology, file & symbol casing standards, single-barrel module resolution (no sibling shims), 1-to-1 tRPC router mapping, Google TypeScript Style Guide (`gts`) enforcement, 100% test co-location, and minimum test coverage invariants.*

---

## IV. Living Architecture Changelog
 
When architectural conventions evolve, update the relevant evergreen document and record the strategic rationale here:

* **2026-10:** Migrated server-side full-collection scans (`getPersonalReadingShelf`, `trackBook`, `searchUnifiedCatalog`, and `BookService.listBooks` filters) to native Firestore indexed `.where()` queries (`FieldPath('userStatuses', userId)`, `cleanIsbn`, `dedupeKey`, `searchTokens`, `primaryGenre`) with write-time index field computation in `BookPartitioner`, Shelf Care index backfill in `resetMetadata(sanitize)`, and multi-key blocking in `detectDuplicatesWithConfidence` (eliminating the 2,500-book fuzzy duplicate cap).
* **2026-10:** Enabled full offline read-only PWA support: implemented `/public/sw.js` with tiered caches (`bookish-shell-v1`, `bookish-static-v1`, `bookish-fonts-v1`, and a 500-item bounded `bookish-covers-v1`), added idle route chunk preloading (`preloadAllRouteChunks`), gated offline route evaluation on IndexedDB React Query hydration (`isQueryCacheRestored`), short-circuited offline tRPC requests and forced Firebase token refreshes, added dedicated uncached offline empty states, and disabled all write/AI controls in place with `"Unavailable while offline"` tooltips.
* **2026-10:** Eliminated the 1,000-book catalog truncation limit via two-stage progressive hydration in `useLibraryData` (instant 1,000-book first paint followed by automatic background `nextCursor` draining into the canonical React Query cache), `limit + 1` lookahead pagination and asynchronous `library.bookCount` self-healing in `BookService.listBooks`, and 250-book batch chunking in `useConstellationData`.
* **2026-10:** Re-architected book swiping from the ground up: replaced `swiper` with a constant-$O(1)$ 3-Slot GPU-composited `BookSwipeDeck` (`motion/react`), stabilized route boundary keys in `App.tsx` so intra-library book transitions never unmount the view, gated flanking slots into a zero-effect Cache Preview Shell, deferred adjacent data/cover bitmap decoding to `requestIdleCallback`, and added live 60fps drag-and-peel physics to `ReadStackCanvasCard`.
* **2026-10:** Enforced full [Google TypeScript Style Guide](https://google.github.io/styleguide/tsguide.html) compliance via `gts` and `eslint.config.cjs` across production and test suites (braced control flow, named exports across `src/`, named `function` declarations over `React.FC`, whole-word CamelCase for acronyms like `CsvImportTab`, `ScanIsbnTab`, and `DebugConsoleHud`, `interface` over object `type` aliases, no redundant `public` class modifiers, and zero explicit `any` in tests).
* **2026-10:** Codified the **Warm, Friendly, Crisp** voice and microcopy guidelines across the entire application, replacing database/archival jargon with natural book-lover language and pairing all empty states with bespoke monoline ink-and-terracotta spot illustrations (`src/components/ui/empty-state-illustrations.tsx`).
* **2026-10:** Established 1-to-1 co-located test coverage across all pure mathematical/spatial engines (`clustering`, `timelineMath`, `worldMapMath`), Web Workers (`umap.worker`, `duplicateDetection.worker`), tRPC routers (`gemini`, `metadata`, `user`, `auth`, `libraryApi`, `bookApi`, `enrichmentApi`), backend services (`gemini`, `metadata`, `userService`, `globalProviderGovernor`, `serverTelemetryBuffer`), client RBAC/storage helpers, and Zustand stores.
* **2026-10:** Standardized repository layout, file casing (`umap.worker.ts`, `catalogOrchestrator.ts`), 1-to-1 tRPC router modules (`libraryApi`, `bookApi`, `enrichmentApi`), single-entry barrel exports, unified date utilities, and 100% co-located `*.test.ts(x)` suites (eliminating `__tests__/` directories and legacy client `db/` helpers).
* **2026-10:** Removed the unused `/api/v1` OpenAPI REST gateway and `apiKeys` credential subsystem, consolidating 100% of API access into the tRPC v11 gateway with single-path Firebase ID Token (JWT) authentication.
* **2026-10:** Eliminated `FirestoreRestService` and dual-mode fallbacks in favor of a single unified server authority (`tRPC` + `firebase-admin/firestore`) with `firestore.rules` permanently sealed (`allow read, write: if false;`) and zero `firebase/firestore` client SDK imports.
* **2026-09:** Database access plane unified behind server procedures.
* **2026-09:** Typography stack streamlined to Manrope for all UI hierarchies, pairing with Playfair Display (Italic) solely for the brand wordmark.
* **2026-09:** Telemetry engine decoupled from the critical render loop via idle-deferred dispatch and heuristic byte calculation.

