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

### Context Resolution Pipeline
Every server request executes the single-path JWT context pipeline (`src/server/auth/context.ts`):
1. Extract Firebase ID Token from `Authorization: Bearer <token>` via `TokenVerifier.extractTokenFromHeader`.
2. Verify token signature, expiration, and `email_verified` claim via Firebase Admin SDK (`TokenVerifier.verify`).
3. Check `AllowlistService.getPermissions(user.email)`: determine whether the caller is on the platform allowlist (`isAppAllowed`), whether they hold administrative privileges (`isAdmin`), and whether they hold an active AI Plan (`hasAiPlan`).
4. Construct the request `SecurityContext`:
   ```typescript
   export interface SecurityContext {
     req: express.Request;
     res: express.Response;
     user: AuthUser | null;
     isAppAllowed: boolean;
     isAdmin: boolean;
     hasAiPlan: boolean;
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
- **IndexedDB Cache Hydration Gate & Fast Offline Short-Circuit:**
  - `src/lib/queryClient.ts` exposes `isQueryCacheRestored()` and `subscribeToQueryCacheRestore()` (with a 600ms safety timeout) so `PrivateRoute` waits for `idb-keyval` query cache restoration when `navigator.onLine === false` before evaluating route guards.
  - `src/lib/trpc.ts` uses `getIdToken(false)` (cached Firebase JWT without forced token refresh) and immediately short-circuits outbound `/api/trpc` fetches when `navigator.onLine === false` so React Query never spins in retry loops offline.
- **Graceful Read-Only Degradation:** When `navigator.onLine === false`:
  - Cached library data, book details, and spatial visualizers (Timeline, World Map, Constellation Map) remain browsable via TanStack Query's IndexedDB persistence.
  - Mutating controls and AI features ("Find a Book", "Add Books", "Shelf Care", "Create Library", "Edit Details", reading status selectors, "Write Review", "Catch Me Up", "Other Books Like This", "Surprise Me", "Refresh Map") remain visible in place with `disabled={!isOnline}` and `title="Unavailable while offline"`.
  - Opening an uncached library or book while offline renders a dedicated offline empty state (`"Not Available Offline Yet"`) with a return button rather than a false `"Access Denied"` or `"Not Found"` redirect.

