# Cross-Cutting Architectural Concerns

> **Document Status:** Authoritative Cross-Cutting Specifications  
> **Target Path:** `/docs/evergreen/05-CROSS-CUTTING-CONCERNS.md`

---

## 1. Authentication & Authorization (RBAC & ABAC)

### The Two-Tiered Security Model
Access control operates on two distinct layers: **Platform Administration** and **Library-Level Ownership**.

```
+-------------------------------------------------------------------------------+
| LAYER 1: PLATFORM ALLOWLIST & ORTHOGONAL AI PLAN (Superadmin & Allowlist)     |
| - Verifies user email in `/appSettings/allowlist/users/{email}`               |
| - Superadmins (`isAdmin: true`) bypass all library-level ownership checks     |
| - Orthogonal AI Plan (`hasAiPlan: boolean`): gates Gemini token expenditure   |
|   (default `true` for admins, admin-controlled opt-in `false` for users)      |
+-------------------------------------------------------------------------------+
                                       |
+-------------------------------------------------------------------------------+
| LAYER 2: LIBRARY-LEVEL ABAC (Attribute-Based Access Control)                  |
| - Owner: User ID matches `library.ownerId`. Full read/write/delete/share.     |
| - Editor: `library.access[email] == 'editor'`. Read/add/edit books & metadata.|
| - Viewer: `library.access[email] == 'viewer'`. Read-only catalog view.        |
+-------------------------------------------------------------------------------+
```

### Context Resolution Pipeline & Auth Caching Boundaries
Every server request executes the single-path JWT context pipeline (`src/server/auth/context.ts`):
1. Extract Firebase ID Token from `Authorization: Bearer <token>` via `TokenVerifier.extractTokenFromHeader`.
2. **Per-Request Cryptographic JWT Check (`0` Stale-JWT Window):** Verify token signature, expiration, and `email_verified` claim on **every** request via Firebase Admin SDK (`TokenVerifier.verify`). Verified JWT claims are never cached across requests on the server.
3. **Bounded L1 Allowlist & Role Caching:** Check `AllowlistService.getPermissions(user.email)` (5-minute TTL, 1,000-entry bounded LRU with write-through invalidation) and `LibraryMetadataCache` (60-second TTL, 500-entry bounded LRU with write-through invalidation on library/collaborator writes).
4. **Client Synchronous JWT Cache & Instant Cached Boot (`src/lib/authTokenCache.ts`):** On the client, `onIdTokenChanged` maintains a synchronous `0ms` in-memory JWT header cache (proactively refreshed 2 minutes before expiry), while `AuthShellSnapshot` in `localStorage` renders returning verified readers in `< 50ms` from priority IndexedDB shards before Firebase Auth completes background session verification (atomically purging all caches if the session was revoked).
5. Construct the request `SecurityContext`:
   ```typescript
   export interface SecurityContext {
     req: express.Request;
     res: express.Response;
     user: AuthUser | null;
     isAppAllowed: boolean;
     isAdmin: boolean;
     hasAiPlan: boolean;
     requestLoaders?: RequestScopedLoaders;
   }
   ```

---

## 2. Telemetry & Performance Budgeting

### The Zero-Cost Telemetry Directive
Telemetry exists to diagnose performance, but must never degrade user-perceived performance.

#### Blacklisted Patterns on the Render Path
```typescript
// BANNED: Never execute synchronous stringification and Blob allocation during render
export function calculatePayloadBytes(data: unknown): number {
  const json = JSON.stringify(data); // Blocks JS thread for large book lists!
  return new Blob([json]).size;      // Causes garbage collection thrashing!
}
```

#### Approved Performance Patterns
1. **Heuristic Size Estimation:** For logging cache and payload sizes, use sampling or string length estimation rather than allocating intermediate `Blob` instances.
2. **Idle-Deferred Flushing:** Dispatch telemetry logs and metrics during browser idle periods:
   ```typescript
   if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
     window.requestIdleCallback(() => telemetryEngine.logMetric(event));
   } else {
     setTimeout(() => telemetryEngine.logMetric(event), 0);
   }
   ```
3. **Lazy SDK Initialization:** SDKs requiring secret API keys (e.g., Google Gen AI / Gemini) must initialize lazily upon first invocation, rather than at top-level module load time.

---

## 3. Developer HUD & Debug Console Architecture

For deep runtime visibility into cache hit rates, network latency, and memory consumption, the application includes an in-app Heads-Up Display (HUD):

### Architectural Guidelines
1. **Passive Observer Pattern:** The debug engine (`src/lib/telemetry/DebugTelemetryEngine.ts`) wraps `window.console` non-destructively. It never swallows or alters native DevTools console outputs.
2. **Capped Memory Ring Buffer:** The log history maintains a maximum capacity of **200 entries**. When capacity is reached, the oldest log entry is evicted to prevent memory leaks during long developer sessions.
3. **Admin-Gated Server Telemetry:** Server-wide outbound API telemetry (`metadata.debugTelemetry`) and provider quota snapshots (`metadata.providerCapacities`) are restricted to system administrators via `adminProcedure`.
4. **HUD Keybinding:** The overlay panel toggles with `Ctrl + ~` or `Cmd + ~`, or via the developer toggle in the user profile dialog for administrators.

---

## 4. Progressive Web App (PWA) & Offline Resiliency

### Invariants for Offline Behavior
- **Service Worker & Tiered Asset Caching (`public/sw.js`):**
  - **App Shell (`bookish-shell-v1`):** HTML navigation requests (`request.mode === 'navigate'`) use Network-First with an offline fallback to the precached `/` app shell so deep links (`/library/:id`, `/library/:id/book/:bookId`, `/reading/timeline`, etc.) boot cleanly without a network connection.
  - **Static Bundles & Web Workers (`bookish-static-v1`):** Hashed `/assets/*` bundles, scripts, stylesheets, and Web Workers (`umap.worker`, `duplicateDetection.worker`) are cached via Cache-First / Network-First fallback and warmed during browser idle periods via `preloadAllRouteChunks()`.
  - **Typography (`bookish-fonts-v1`):** Google Fonts CSS (`fonts.googleapis.com`) and WOFF2 binaries (`fonts.gstatic.com`) use Cache-First to preserve `Manrope` and `Playfair Display` offline.
  - **Book Covers (`bookish-covers-v1`):** Cross-origin book cover images use Stale-While-Revalidate with a bounded 500-entry FIFO cache. Uncached covers fall back to `<MonographCoverFallback />` via `onError` handlers.
- **Two-Phase Sharded IndexedDB Hydration & Fast Offline Short-Circuit:**
  - `src/lib/idbQueryShardPersister.ts` and `src/lib/queryClient.ts` store TanStack Query state in native structured-clone IndexedDB shards (`bookish-cache-v2` -> `core-shell`, `reading-room`, `editorial-daily`, `library:<id>`, `book-detail:<libId>:<bookId>`) with two-phase restoration: Phase 1 hydrates priority shards for `window.location.pathname` (`150ms` online / `600ms` offline safety cap) before `PrivateRoute` evaluates optimistic/offline guards, and Phase 2 hydrates remaining shards in `requestIdleCallback`.
  - `src/lib/trpc.ts` reads the synchronous in-memory JWT cache (`0ms`) and immediately short-circuits outbound `/trpc` fetches when `navigator.onLine === false` so React Query never spins in retry loops offline.
- **Graceful Read-Only Degradation:** When `navigator.onLine === false`:
  - Cached library data, book details, and spatial visualizers (Timeline, World Map, Constellation Map) remain browsable via TanStack Query's IndexedDB persistence.
  - Mutating controls and AI features ("Find a Book", "Add Books", "Shelf Care", "Create Library", "Edit Details", reading status selectors, "Write Review", "Catch Me Up", "Other Books Like This", "Surprise Me", "Refresh Map") remain visible in place with `disabled={!isOnline}` and `title="Unavailable while offline"`.
  - Opening an uncached library or book while offline renders a dedicated offline empty state (`"Not Available Offline Yet"`) with a return button rather than a false `"Access Denied"` or `"Not Found"` redirect.

---

## 5. Client Caching Lifecycles & Surgical Delta Reconciliation

### The Stale Window & Sharded Persistent Cache Contract
`src/lib/queryClient.ts` configures TanStack Query for zero-spinner navigation and instant warm boots:
- **`staleTime: 1000 * 60 * 5` (5 minutes default; 60 minutes for warm `book.list` backed by `book.syncChanges`; 24 hours for daily editorial queries):** Mounted components serve warm data in `0ms` without redundant network refetches.
- **`refetchOnWindowFocus: false`:** Focusing the browser tab does not trigger background revalidation.
- **7-Day Sharded Structured-Clone IndexedDB Persistence (`bookish-cache-v2`):** Dirty shards flush independently after a 250ms debounce with `embedding` vectors stripped and zero `JSON.stringify`.

### Mandatory Cross-Query Surgical Patching
Because React Query treats `staleTime` as a trust window unless a query key is updated via `setData`, every mutation modifying an entity rendered across multiple query keys **must** synchronize the entire query family via `src/lib/readingStatusCache.ts`:
1. **Optimistic + Surgical Delta Helpers (`src/lib/readingStatusCache.ts`):**
   - Apply `applyOptimisticReadingStatusPatch` / `removeBookFromReadingCaches` before the network call and commit the server's authoritative delta via `commitReadingStatusDelta`, `commitBookUpsertDelta`, `commitBookDeleteDelta`, or `commitBookReviewDelta` on success—eliminating post-mutation full-collection refetch storms.
2. **Synchronized Query Keys for Reading Status & Books:**
   - `readingTracker.getShelf({ shelf: 'all' })` (Personal Reading Room Bento, Currently Reading Card, Reading Lists, Stats, Timeline, World Map, Constellation Map)
   - `readingTracker.getUnreadLibraryBooks()` (Start Reading from Your Shelves & Swipe Review queue)
   - `book.list({ libraryId })` (Library Overview Currently Reading card & Catalog grid)
   - `book.get({ libraryId, bookId })` & `book.listReviews({ libraryId, bookId })` (Book Details view)
   - `library.list()` / `library.get({ libraryId })` (in-place `bookCount` updates)

