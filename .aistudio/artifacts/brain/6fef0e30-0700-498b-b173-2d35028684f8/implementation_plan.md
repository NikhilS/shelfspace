# Offline Read-Only PWA Architecture & Implementation Plan

## 1. Executive Summary & Architectural Goals

When launching or navigating the `book(ish)` PWA while offline, the application will boot from a locally cached app shell, hydrate persisted library and reading data from IndexedDB (`idb-keyval`) before evaluating route guards, display cached book covers (or graceful `MonographCoverFallback` plates), and enforce a consistent **Read-Only Offline Mode** across all views.

### Core Design Choices (Aligned with Clarifications)
1. **Service Worker Caching Strategy:** Cache the HTML app shell, compiled JS/CSS/Web Worker bundles, Google Fonts (`Manrope` and `Playfair Display`), and recently viewed book cover images (bounded runtime cache), falling back to `MonographCoverFallback` when a cover image has not been cached yet.
2. **In-Place Read-Only Controls:** Keep write actions and AI features visible in their familiar layout positions while offline, disabling them in place (`disabled={!isOnline}`) with a clear tooltip (`"Unavailable while offline"`) or subtle offline badge.
3. **Uncached Offline Empty State:** When navigating to a library, book, or editor route whose data has not yet been cached in IndexedDB while offline, render a dedicated, warm-voiced **Offline Archive Empty State** with a return button rather than a false `"Access Denied"` or `"Library not found"` error.

---

## 2. Layer-by-Layer Implementation Plan

### Phase 1: Service Worker & App Shell Precaching (`/public/sw.js`, `index.html`, `src/main.tsx`, `server.ts`)
Currently, `index.html`, `src/main.tsx`, and `server.ts` actively unregister Service Workers and purge Cache Storage on every boot. We will replace those automatic kill-switches with a deterministic, versioned Service Worker architecture while preserving the manual `"Clear Cache & Reload"` emergency button in `index.html`.

* **Remove Automatic SW Sabotage:**
  * **`index.html`:** Remove the automatic startup `serviceWorker.getRegistrations()` unregister loop and `caches.keys()` purge so active PWA caches survive across reloads. Keep `window.__bookishHardResetAndReload` wired to the boot recovery button.
  * **`src/main.tsx`:** Replace the `serviceWorker.unregister()` loop with a Service Worker registration helper (`registerServiceWorker()`) that registers `/sw.js` and eagerly warms lazy route chunks during browser idle time (`requestIdleCallback`) so all views (`BookDetailsView`, `ConstellationMap`, `WorldMap`, `TimelineView`, `SpruceUpView`, `AddBookView`) are available offline even before the user visits each tab.
  * **`server.ts`:** Remove the `SELF_DESTROYING_SW` route interceptor for `/sw.js` so `public/sw.js` (and `dist/sw.js` in production) is served with proper `Service-Worker-Allowed: /` and `Cache-Control: no-cache` headers.
* **Implement `/public/sw.js`:**
  * **Navigation Requests (`req.mode === 'navigate'`):** Use **Network-First with Offline App-Shell Fallback**. When online, fetch fresh HTML from the server and update the app-shell cache; when offline, serve the cached `/` (`index.html`) shell for any SPA route (`/`, `/library/*`, `/reading/*`).
  * **Static Bundles & Module Scripts (`/assets/*`, `/src/*`, Web Workers, `/icon.png`, `/manifest.webmanifest`):** Use **Stale-While-Revalidate / Cache-First** for hashed production assets and runtime script modules so the entire React app boots offline.
  * **Google Fonts (`fonts.googleapis.com`, `fonts.gstatic.com`):** Use **Cache-First** (`bookish-fonts-v1`) so `Manrope` and `Playfair Display` render identically offline.
  * **Book Cover Images (`books.google.com`, `covers.openlibrary.org`, `lh3.googleusercontent.com`, Firebase Storage covers):** Use **Stale-While-Revalidate** (`bookish-covers-v1`, capped at 500 entries) so recently viewed book covers render immediately offline.
  * **API & tRPC Bypass (`/trpc/*`, `/api/*`):** Strictly `NetworkOnly` in the Service Worker—data persistence remains exclusively managed by TanStack Query + IndexedDB (`idb-keyval`).

---

### Phase 2: IndexedDB Hydration Gate & Offline-Fast tRPC Client (`src/lib/queryClient.ts`, `src/lib/trpc.ts`, `src/App.tsx`, `src/services/authListener.ts`)
Prevent the race condition where components mount and fire failing network queries before `idb-keyval` finishes restoring the persisted React Query cache from IndexedDB.

* **Export Hydration Readiness from `src/lib/queryClient.ts`:**
  * Export `queryCacheRestoredPromise` (resolved when `persistQueryClient`'s `restorePromise` settles, with a fast safety timeout) and a lightweight `useIsQueryCacheRestored()` hook.
  * Update `mutations` default options in `queryClient.ts` so accidental mutations while offline fail fast without queuing phantom retries (`retry: false` when `!navigator.onLine`).
* **Gate Route Evaluation in `src/App.tsx`:**
  * Wait for `useIsQueryCacheRestored()` inside `PrivateRoute` / `AuthGuard` before rendering route children when offline, ensuring `library.list`, `library.get`, `book.list`, and `readingTracker.getShelf` are already populated in the synchronous React Query cache when views mount.
* **Short-Circuit Offline Retries in `src/lib/trpc.ts`:**
  * In `customFetch`, check `typeof navigator !== 'undefined' && navigator.onLine === false` before entering the `[500, 1100, 2000]` ms retry loop. When offline, fail immediately on the first attempt without noisy console/HUD error spam so React Query (`networkMode: 'offlineFirst'`) quietly serves cached data.
  * In `getAuthHeaders()`, pass `forceRefresh = false` to `getIdToken(false)` and gracefully catch `auth/network-request-failed` if an offline token is expired.
* **Offline-Safe Auth Listener (`src/services/authListener.ts`):**
  * Skip `trpcVanilla.user.syncProfile.mutate(...)` when `navigator.onLine === false`, and attach a one-time `window.addEventListener('online', ...)` listener to sync the profile once connectivity returns.

---

### Phase 3: Offline-Aware Route Guards & Dedicated Uncached Empty State (`src/hooks/useLibraryData.ts`, `src/components/layout/RequireLibraryPermission.tsx`, `src/pages/LibraryView.tsx`, `src/pages/BookDetailsView.tsx`)
When a user navigates to a library or book while offline that has never been cached on their device:

* **Prevent False Redirects in `useLibraryData.ts`:**
  * In `useLibraryData`, do not fire `toast.error('Library not found or access denied')` or redirect to `/` when `!navigator.onLine`. Instead, expose `isOfflineUncached: !isOnline && !library && !isLoading`.
* **Update `RequireLibraryPermission.tsx`:**
  * When `!isOnline`:
    * If `requires === 'editor'` or `requires === 'owner'` (such as `/library/:id/add` or `/library/:id/spruce-up`), render a warm **Offline Read-Only Notice** explaining that adding books and Shelf Care require an internet connection, with a `"Back to Library"` button.
    * If `requires === 'viewer'` and the library isn't in the local cache yet, render the dedicated **Offline Uncached Library Empty State** (using our monoline archival illustration style) with a `"Return to Reading Room"` button instead of `"Access Denied"`.
* **Book Cover Offline Fallback (`src/pages/book-details/BookContent.tsx`, `src/components/book/BookCard.tsx`):**
  * Track image `onError` on book cover `<img>` tags so that if an external cover URL was not yet cached in `bookish-covers-v1` when offline, it cleanly swaps to `<MonographCoverFallback />` instead of showing a broken browser image icon.

---

### Phase 4: In-Place Disabled Controls & Tooltips for Write/AI Actions
Using `useOnlineStatus()`, disable mutating and AI-dependent controls in place with a consistent `"Unavailable while offline"` tooltip across all views:

1. **Dashboard (`src/pages/Dashboard.tsx` & `src/pages/dashboard/*`):**
   * Disable `"Find a Book"`, `"New Library"`, `"Create Your First Library"`, library card edit/delete/share actions, and quick status updates or removals on Reading Room cards when `!isOnline`, adding `title={!isOnline ? 'Unavailable while offline' : ...}`.
2. **Library View & Collection (`src/pages/LibraryView.tsx`, `src/pages/library/*`):**
   * Disable `"Add Book"`, `"Shelf Care"`, library settings/sharing buttons, and bulk selection mutation actions (Bulk Delete, Bulk Move/Copy, Bulk Edit Genre/Status) when `!isOnline` with offline tooltips.
3. **Book Details (`src/pages/book-details/BookContent.tsx`, `BookHeader.tsx`, `ReadingStatusSelect.tsx`, `ReviewSection.tsx`, `AiInsightsPanel.tsx`):**
   * **`BookHeader`:** Disable `"Edit Details"` button in place with `title="Unavailable while offline"`.
   * **`ReadingStatusSelect`:** Disable the status `<Select>` dropdown when `!isOnline` with an offline tooltip/badge so users cannot trigger failing status updates.
   * **`BookContent` (Synopsis & Author Bio):** Disable `"Generate Synopsis"` / `"Fetch Synopsis"` and `"Generate Bio"` / `"Fetch Bio"` buttons when `!isOnline` with `title="Unavailable while offline"`.
   * **`AiInsightsPanel`:** Disable `"Catch Me Up (Spoilers)"` and `"Other Books Like This"` buttons when `!isOnline` with `title="Unavailable while offline"`.
   * **`ReviewSection`:** Disable `"Write Review"` / `"Save Review"` buttons when `!isOnline` with `title="Unavailable while offline"`.
4. **Constellation Map (`src/pages/ConstellationMap.tsx`):**
   * Disable the `"Regenerate Clusters"` / AI cluster naming trigger when `!isOnline` while still allowing full interactive panning, zooming, and browsing of cached clusters.

---

## 3. Verification & Testing Plan

1. **Unit & Integration Tests (`vitest`):**
   * Add unit tests for `useLibraryData` and `RequireLibraryPermission` when `useOnlineStatus` returns `false` (verifying no false `"Access Denied"` or toast redirect occurs, and verifying the dedicated offline empty state renders for uncached libraries).
   * Add unit tests for `BookDetailsView` / `BookContent` / `ReadingStatusSelect` / `ReviewSection` verifying that write and AI buttons are disabled with `"Unavailable while offline"` tooltips when offline.
   * Verify `customFetch` in `src/lib/trpc.test.ts` short-circuits retries immediately when `navigator.onLine === false`.
2. **Build & Style Verification:**
   * Run `npm run compile`, `npm run lint` (`gts lint`), and `npm test` to confirm zero TypeScript, style, or test regressions.
   * Update `docs/evergreen/05-CROSS-CUTTING-CONCERNS.md` and `docs/evergreen/README.md` changelog to document the offline PWA Service Worker and IndexedDB hydration architecture.
