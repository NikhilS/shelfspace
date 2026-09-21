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
2. **Unified Data Authority:**
   We maintain a single, sealed data plane. The Cloud Firestore database is completely closed to direct browser manipulation (`firestore.rules: allow read, write: if false;`). All client applications (Web, future Mobile, and programmatic CLI/API clients) read and mutate state through a single, type-safe API Gateway (tRPC + OpenAPI REST v1).
3. **Deterministic Performance & Zero-Cost Observability:**
   Telemetry and debugging HUDs must never degrade user-perceived performance. Heavy operations (UMAP vector dimensionality reduction, image processing) execute off the main thread in Web Workers. Synchronous serialization and memory allocations are banned on critical render paths.

---

## II. The "Golden Rules" (Non-Negotiable Invariants)

These rules apply to every pull request, feature branch, and refactor:

| Domain | Invariant Rule |
| :--- | :--- |
| **Security** | **Direct client Firestore writes are strictly forbidden.** Never re-open `firestore.rules` for client writes. All mutations pass through server procedures with runtime Zod validation and ABAC checks. |
| **Typography** | **Manrope is universal; Playfair Display Italic is reserved.** All UI, forms, tables, buttons, headers, and metadata use Manrope. Playfair Display (Italic) is strictly reserved for the top bar wordmark `book(ish)`. |
| **Aesthetics** | **No Pill Buttons for Actions.** Action buttons and tags must use rectilinear corners (`rounded` 4px or `rounded-lg` 8px) to respect the rectangular proportions of books and catalog cards. |
| **State** | **No `skipToken` React Query Abuses.** TanStack Query must never be used as a manual key-value store. It is reserved for declarative queries and optimistic mutations. Ephemeral UI state belongs in Zustand; URL parameters govern filterable views. |
| **Telemetry** | **Never `JSON.stringify` or allocate `Blob`s on the render path.** Payload calculations and telemetry logging must be deferred to `requestIdleCallback` or lightweight heuristics. |
| **API** | **Zod is the Single Source of Truth.** Input and output schemas defined in `src/schemas/` must drive both tRPC routers and external OpenAPI REST v1 endpoints. |
| **Database** | **No Orphaned Books.** A book document cannot exist outside of a parent `libraries/{libraryId}/books/{bookId}` path. All library deletions must clean up subcollections. |

---

## III. Evergreen Documentation Suite

The complete engineering standard is partitioned into specialized, domain-focused modules:

1. [**Design System & UI Guidelines**](./01-DESIGN-SYSTEM-AND-UI.md)  
   *Natural Materials Palette, Manrope typography hierarchy, tonal layering, tactile components, and anti-slop rules.*

2. [**State Architecture & Data Flow**](./02-STATE-MANAGEMENT-AND-FRONTEND-ARCHITECTURE.md)  
   *Four-tier state taxonomy (Zustand, React Query, URL params, local state), optimistic mutation pipelines, and Web Worker offloading.*

3. [**API Architecture & External Gateway**](./03-API-AND-EXTERNAL-GATEWAY.md)  
   *Internal tRPC v11 routers, procedure permission trees, `/api/v1` OpenAPI gateway, API key verification, and rate limiting.*

4. [**Backend & Database Schema**](./04-BACKEND-AND-DATABASE-SCHEMA.md)  
   *Cloud Firestore document models, subcollection invariants, Zod runtime schemas, background job scaling, and Admin SDK practices.*

5. [**Cross-Cutting Concerns**](./05-CROSS-CUTTING-CONCERNS.md)  
   *Authentication & RBAC/ABAC allowlisting, telemetry budgets, developer HUD, caching lifecycles, and PWA/offline resiliency.*

---

## IV. Living Architecture Changelog

When architectural conventions evolve, update the relevant evergreen document and record the strategic rationale here:

* **2026-09:** Database access plane fully unified behind tRPC and OpenAPI v1. Direct client Firestore rules closed (`if false;`).
* **2026-09:** Typography stack streamlined to Manrope for all UI hierarchies, pairing with Playfair Display (Italic) solely for the brand wordmark.
* **2026-09:** Telemetry engine decoupled from the critical render loop via idle-deferred dispatch and heuristic byte calculation.
