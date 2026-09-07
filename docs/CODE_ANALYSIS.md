# Principal Engineer Codebase Analysis: Architecture, Correctness & Scalability

**Author:** Principal Software Engineer  
**Date:** September 2026  
**Target Repository:** Alexandria (Book Librarian & Physical Bookshelf Companion)  
**Scope:** Full-stack codebase audit (Frontend SPA, Express Backend, tRPC & REST APIs, Firestore Security Rules, Metadata Backfills, Concurrency & Workers).

---

## 1. Executive Summary & System Topology

Alexandria is a modern hybrid architecture built around:
- **Frontend SPA:** React 19, Vite, Tailwind CSS, TanStack Query, Zustand, Radix UI primitives.
- **Backend API Gateway:** Express 4 server hosting an end-to-end type-safe tRPC router alongside authenticated `/api/v1` REST gateway endpoints.
- **Data & Identity Persistence:** Google Cloud Firestore (leveraging a split-collection pattern: lightweight `libraries/{libId}/books` and rich `libraries/{libId}/bookDetails`), Firebase Storage for media, and Firebase Authentication paired with a custom hashed API Key service.
- **Intelligence & Enrichment Layer:** Google Gemini 2.5 Flash via `@google/genai` for multimodal spine/cover book extraction, geometric book embeddings, structured synopsis extraction, era classification, and geocoded story mapping.

### High-Level Architectural Health Scorecard

| Domain | Rating | Summary Findings |
| :--- | :---: | :--- |
| **Authentication & RBAC** | ⚠️ High Risk | Critical privilege escalation in tRPC `createContext` (`isAdmin` unconditionally `true`); Security rules allow raw client writes to `/apiKeys`. |
| **Database & Firestore Scalability** | ⚠️ High Risk | `LibraryService.getUserLibraries()` executes an unindexed full collection scan of all libraries across all users; mount-time aggregation leaks on Dashboard. |
| **Compute & Worker Concurrency** | ⚠️ Medium Risk | `useConstellationData` runs 400 epochs of UMAP on the main UI JavaScript thread, while a fully-implemented `src/workers/umapWorker.ts` sits completely orphaned. |
| **Metadata & Backfill Pipeline** |  Good | Solid provider registry abstraction (`IMetadataProvider`); rate limiters are well-isolated, but geocoding cache is trapped in ephemeral server RAM. |
| **Frontend Modularity & UX** |  Very Good | Excellent component modularity, strict virtualized rendering via `react-virtuoso`, and dual-write isolation (`books` vs `bookDetails`). |
| **Test Suite Health** |  Good | Vitest test suite passes across all suites after resolving mock exports (`trpcVanilla`) and browser API guards (`window.matchMedia`). |

---

## 2. Chunk 1: Authentication, Authorization & Identity Lifecycle

### 2.1 Critical Security Defect: Privilege Escalation in tRPC Context
**Location:** `src/server/trpc/trpc.ts` (lines 40–55)

```typescript
// CURRENT CODE IN createContext:
if (rawApiKey) {
  const validatedKey = await ApiKeyService.validateApiKey(rawApiKey);
  if (validatedKey) {
    user = { ... };
    isAppAllowed = true;
    isAdmin = true; //  CRITICAL DEFECT: Every valid API key granted full admin!
  }
} else if (authHeader?.startsWith('Bearer ')) {
  const decoded = await admin.auth().verifyIdToken(token);
  if (decoded?.email) {
    user = { ... };
    isAppAllowed = true;
    isAdmin = true; //  CRITICAL DEFECT: Every authenticated user granted full admin!
  }
}
```

#### The Problem:
`createContext` unconditionally marks `isAdmin = true` for **every valid user session** and **every active API key**. Any procedure guarded by `adminProcedure` can be invoked by any standard registered user or third-party client.

#### Solution:
Synchronize server-side admin validation with the designated superadmin email (`nikhil.singhal@gmail.com`) and the Firestore admin allowlist document:
```typescript
const email = (decoded.email || '').toLowerCase();
const isSuperAdmin = email === 'nikhil.singhal@gmail.com';
let isDbAdmin = false;
if (!isSuperAdmin && email) {
  const adminDoc = await admin.firestore().doc(`appSettings/allowlist/users/${email}`).get();
  isDbAdmin = adminDoc.exists && adminDoc.data()?.role === 'admin';
}
isAdmin = isSuperAdmin || isDbAdmin;
```

---

### 2.2 Client-Side Security Breach in Firestore Rules
**Location:** `firestore.rules` (lines 273–278)

```javascript
// CURRENT RULE:
match /apiKeys/{keyHash} {
  allow read: if isSignedIn() && resource.data.ownerId == request.auth.uid;
  allow create: if isSignedIn() && request.resource.data.ownerId == request.auth.uid;
  allow update: if isSignedIn() && resource.data.ownerId == request.auth.uid && request.resource.data.ownerId == resource.data.ownerId;
  allow delete: if isSignedIn() && resource.data.ownerId == request.auth.uid;
}
```

#### The Problem:
API keys are minted, validated, and revoked exclusively on the backend by `ApiKeyService` using the Firebase Admin SDK. Allowing client-side `create` and `update` directly from the browser SDK means a malicious authenticated user can forge records in `/apiKeys/{keyHash}` with arbitrary hashed keys, spoofing identities or bypassing key generation constraints.

#### Solution:
Enforce backend-only authority for API keys in `firestore.rules`:
```javascript
match /apiKeys/{keyHash} {
  allow read: if isSignedIn() && resource.data.ownerId == request.auth.uid;
  allow write: if false; // Only server-side Admin SDK may create, update, or revoke
}
```

---

### 2.3 Broken Client Bootstrapper vs. Firestore Security Rules
**Location:** `src/hooks/useAppPermissions.ts` (lines 36–52)

#### The Problem:
`useAppPermissions` attempts to inspect if `appSettings/allowlist/users` is empty so that it can auto-promote the first user to admin:
```typescript
const allUsersSnap = await getDocs(collection(db, 'appSettings/allowlist/users'));
if (allUsersSnap.empty) {
  await setDoc(allowRef, { email, role: 'admin', addedAt: serverTimestamp() });
}
```
However, in `firestore.rules`:
```javascript
match /appSettings/allowlist/users/{email} {
  allow list: if isAdmin();
  allow create: if isAdmin();
}
```
Because non-admin users are strictly forbidden from executing `list` or `create` queries on this collection, this bootstrap check **always fails** with a Firestore `PERMISSION_DENIED` error, spamming the console and acting as dead, confusing code.

#### Solution:
Remove the non-functional client-side bootstrap code. First-run administrative initialization must occur via an authenticated backend script or Firebase Admin migration.

---

## 3. Chunk 2: Backend Services, tRPC & REST Gateway

### 3.1 Catastrophic Database Full-Table Scan
**Location:** `src/services/server/libraryService.ts` (lines 83–105)

```typescript
// CURRENT CODE:
static async getUserLibraries(userId: string, userEmail?: string) {
  const db = getAdminDb();
  const snap = await db.collection('libraries').get(); //  Reads EVERY document in DB!
  const result: LibraryApiRecord[] = [];
  snap.forEach(docSnap => {
    const data = docSnap.data();
    if (data.ownerId === userId || ...) {
      result.push(...);
    }
  });
  return {libraries: result};
}
```

#### The Problem:
On every call to `/api/v1/libraries` or `trpc.library.list`, the server queries and downloads the **entire Firestore `libraries` collection across all users in the application**, performing the owner/access filter entirely in Node.js memory. If the application scales to 5,000 users and 20,000 libraries, a single request triggers 20,000 Firestore reads ($0.036/call), introduces multi-second latency, and exhausts server memory.

#### Solution:
Utilize indexed Firestore queries mirroring the frontend client pattern:
```typescript
const db = getAdminDb();
const lowerEmail = userEmail ? userEmail.toLowerCase() : null;

const ownerQuery = db.collection('libraries').where('ownerId', '==', userId).get();
const sharedQuery = lowerEmail
  ? db.collection('libraries').where(`access.${lowerEmail}`, 'in', ['owner', 'editor', 'viewer']).get()
  : Promise.resolve({docs: []});

const [ownerSnap, sharedSnap] = await Promise.all([ownerQuery, sharedQuery]);
// Deduplicate doc IDs and construct result
```

---

### 3.2 Broken Pagination & False-Empty Responses in `getFilteredBooks`
**Location:** `src/services/server/libraryService.ts` (lines 142–245)

#### The Problem:
In `getFilteredBooks`:
1. The server reads `limit * 5` books ordered by `addedAt desc`.
2. It then performs **in-memory filtering** for `missingMetadata` (e.g., books missing geo or temporal coordinates).
3. If a library has 300 books, and the first 50 books already have geo metadata, the function filters them out and returns an **empty array `[]`**, even though 250 remaining books need enrichment!
4. Furthermore, cursor-based pagination uses Firestore document snapshots. Because the documents were filtered *after* fetching, the cursor reference breaks pagination continuity.

#### Solution:
To support scalable filtering for backfills and missing metadata:
1. Maintain boolean index flags on book documents: `needsGeoEnrichment: boolean`, `needsTemporalEnrichment: boolean`, `needsGenreEnrichment: boolean`.
2. Apply the `where('needsGeoEnrichment', '==', true)` clause directly to the Firestore query before pagination boundaries.

---

## 4. Chunk 3: Metadata Registry, Providers & Backfill Architecture

### 4.1 Ephemeral Geolocation Cache vs. Firestore Rules Mismatch
**Location:** `src/services/server/geolocation.ts` (lines 1–28) vs. `firestore.rules` (lines 268–271)

#### The Problem:
`firestore.rules` and `firebase-blueprint.json` explicitly designate a collection `/geolocationCache/{locationKey}` reserved for server-side geocoding persistence:
```javascript
match /geolocationCache/{locationKey} {
  allow read: if isSignedIn() && isValidId(locationKey);
  allow write: if false; // Only server-side admin writes allowed
}
```
However, `src/services/server/geolocation.ts` stores geocoded coordinates in a simple JavaScript memory object:
```typescript
const cache = new Map<string, {lat: number; lng: number}>();
```
Whenever Cloud Run recycles the container, scales to zero, or spawns multiple parallel instances:
- The entire geocoding cache is wiped out.
- Multiple instances make duplicate paid requests to the Google Maps Geocoding API for the exact same historical locations ("London, UK", "Paris, France").

#### Solution:
Connect `geolocation.ts` to `/geolocationCache` using `getAdminDb()`, with the memory `Map` acting as an L1 cache and Firestore as L2 persistent storage.

---

### 4.2 Sub-Provider Invocation & Concurrency Risk in `GeoMetadataProvider`
**Location:** `src/services/server/metadata/providers/GeoMetadataProvider.ts` (lines 19–28)

#### The Problem:
When extracting geographical coordinates from a book, `GeoMetadataProvider` requires a synopsis:
```typescript
private async getSynopsis(book: CoreBookData): Promise<string | undefined> {
  if ('synopsis' in book) return book.synopsis;
  const synopsisProvider = MetadataRegistry.getInstance().getProvider(MetadataKey.SYNOPSIS);
  return synopsisProvider ? (await synopsisProvider.fetch(book)) : undefined;
}
```
In `bulkFetch(books: CoreBookData[])`, mapping this over 50 books triggers 50 unbatched individual calls to `synopsisProvider.fetch(book)` sequentially or simultaneously, bypassing the batch synopsis API and multiplying Gemini API roundtrips.

#### Solution:
In bulk enrichment flows, batch-fetch missing synopses upfront:
```typescript
const missingSynopsisBooks = books.filter(b => !b.synopsis);
if (missingSynopsisBooks.length > 0) {
  const synopses = await synopsisProvider.bulkFetch(missingSynopsisBooks);
  // Attach synopses to books in memory before executing geo extraction batch
}
```

---

## 5. Chunk 4: High-Load Data Operations & Client-Side Concurrency

### 5.1 Main-Thread Freeze in Constellation Map vs. Orphaned Worker
**Location:** `src/hooks/useConstellationData.ts` (lines 90–115) vs. `src/workers/umapWorker.ts`

#### The Problem:
In `useConstellationData.ts`:
```typescript
// Executing directly on the UI JavaScript main thread:
const { UMAP } = await import('umap-js');
const umap = new UMAP({
  nNeighbors,
  minDist: 0.1,
  nComponents: 2,
  nEpochs: 400, //  400 Epochs on UI thread!
});
const coords = umap.fit(embeddingData);
```
Running 400 epochs of UMAP optimization on 500–2,000 books with 768-dimensional vectors **completely locks the browser UI thread for 10 to 30 seconds**, freezing animations, user input, and navigation.

Meanwhile, `src/workers/umapWorker.ts` was implemented to offload this exact computation to a background Web Worker, but **is never imported or instantiated anywhere in the repository**.

#### Solution:
Wire `useConstellationData.ts` to spawn `src/workers/umapWorker.ts`:
```typescript
const worker = new Worker(new URL('../workers/umapWorker.ts', import.meta.url), { type: 'module' });
worker.postMessage({ embeddings: embeddingData, nNeighbors });
worker.onmessage = (e) => {
  if (e.data.error) handleFallback();
  else setReducedCoordinates(e.data.reduced);
};
```

---

### 5.2 Mount-Time Aggregation Storm on Dashboard Load
**Location:** `src/pages/dashboard/useLibraries.ts` (lines 68–88)

```typescript
// CURRENT CODE:
libs.forEach(async lib => {
  if (!reconciledLibsRef.current.has(lib.id) || lib.bookCount === undefined) {
    reconciledLibsRef.current.add(lib.id);
    const count = await reconcileBookCount(lib.id); //  Server count query per library!
    if (lib.bookCount !== count) {
      await updateDoc(doc(db, 'libraries', lib.id), { bookCount: count });
    }
  }
});
```

#### The Problem:
On every initial page load of `Dashboard`, `reconciledLibsRef` is empty. The hook fires `reconcileBookCount(lib.id)` for **every library owned by or shared with the user**. If a user has 15 libraries, mounting the dashboard executes 15 separate Firestore aggregation queries (`getCountFromServer`) and potential updates on every session start.

#### Solution:
Only trigger `reconcileBookCount` when:
1. `lib.bookCount === undefined` (legacy document without a counter field).
2. The user explicitly requests a library repair/audit in the "Spruce Up" or Library Settings view.

---

### 5.3 Batch Resilience & The `ClientBulkWriter` Pattern
**Location:** `src/lib/clientBulkWriter.ts`

#### Architectural Verification:
`ClientBulkWriter` is well-constructed:
- Limits batch writes to **450 operations** (well below Firestore's 500-op limit).
- Introduces an intentional pause (`await new Promise(r => setTimeout(r, 100))`) between committed batches to prevent triggering Firestore's 500/50/5 ramp-up rule.
- Wraps write errors cleanly and reports failed document keys.

**Recommendation:** Ensure `ClientBulkWriter` is uniformly used across `useAddBooks`, `useBulkEnrichment`, and CSV imports.

---

## 6. Chunk 5: Frontend Views & Interactive Workflows

### 6.1 `AddBookView` & Camera Stream Cleanup
**Location:** `src/pages/AddBookView.tsx` & `src/pages/add-book/useAddBooks.ts`

- **Correctness:** Resolved the Vitest mock gap where `trpcVanilla.metadata.enrichCreate` was missing from unit test mocks.
- **Camera Lifecycle:** When swapping tabs from "Camera" to "Search" or "CSV", media stream tracks are properly stopped via `track.stop()`, preventing ongoing hardware webcam/mobile battery drain.
- **Multimodal Optimization:** Images sent to `trpc.gemini.extractBooksFromImage` are downscaled on a canvas before transmission to limit payload size and prevent 413 HTTP errors.

---

### 6.2 `BookDetailsView` & Sub-Collection Cascade Delete
**Location:** `src/services/db/books.ts` (`deleteBookAtomic`)

- **Correctness:** Book deletion properly deletes both:
  1. `libraries/{libId}/books/{bookId}`
  2. `libraries/{libId}/bookDetails/{bookId}`
  And atomically decrements `libraries/{libId}.bookCount` by -1 using `increment(-1)`.
- **Gap:** Reviews stored in subcollection `libraries/{libId}/books/{bookId}/reviews` are not automatically deleted when the book document is deleted. In Firestore, subcollections are not deleted when a parent document is deleted.
- **Fix:** Add batch deletion of reviews inside `deleteBookAtomic` or a cloud function trigger.

---

### 6.3 `WorldMap` & `TimelineView` Rendering Efficiency
- **WorldMap:** Correctly clusters markers using `@googlemaps/markerclusterer`. Filters books with invalid or missing coordinates before passing them to the map stage.
- **TimelineView:** Groups books by era/century. Ensure memoization on era grouping: `useMemo(() => groupBooksByEra(books), [books])` to avoid recalculating date buckets on unrelated UI re-renders.

---

## 7. Chunk 6: Code Reuse, Redundancy & Shared Utilities

### 7.1 Duplicate Normalization & Validation Logic
1. **ISBN Normalization:**
   - `normalizeIsbn` is defined in `src/lib/utils.ts`.
   - However, custom regex checks for ISBNs exist in `AddBookView.tsx`, `useAddBooks.ts`, and `CoverImageMetadataProvider.ts`.
   - **Recommendation:** Standardize all ISBN scrubbing on `src/lib/utils.ts:normalizeIsbn`.
2. **Date Formatting:**
   - Date formatters are declared independently across `ApiKeyManagement.tsx`, `BookDetailsView.tsx`, `TimelineView.tsx`, and `LibraryCard.tsx`.
   - **Recommendation:** Centralize into `src/lib/dateUtils.ts` (`formatDisplayDate`, `formatRelativeTime`, `formatIsoToReadable`).

---

## 8. Prioritized Remediation Roadmap

### Priority 0: Critical Security & Integrity (Immediate)
1. **Fix `createContext` in `src/server/trpc/trpc.ts`:** Remove hardcoded `isAdmin: true` and validate admin status against designated email and Firestore allowlist.
2. **Lock `/apiKeys` in `firestore.rules`:** Disallow client SDK writes (`allow write: if false;`).
3. **Fix `LibraryService.getUserLibraries()`:** Replace `db.collection('libraries').get()` full table scan with indexed owner and access queries.

### Priority 1: Performance & Compute (Next Sprint)
1. **Activate `umapWorker.ts` in `useConstellationData.ts`:** Move UMAP dimensionality reduction off the main thread into the existing Web Worker.
2. **Persist `geolocation.ts` cache to Firestore:** Store geocoded results in `/geolocationCache` so container restarts don't invalidate geocodes.
3. **Guard Dashboard `useLibraries` reconciliation:** Do not execute `reconcileBookCount` queries on every dashboard mount for up-to-date libraries.

### Priority 2: Code Cleanliness & Technical Debt
1. **Remove dead allowlist bootstrap logic in `useAppPermissions.ts`**.
2. **Cascade delete reviews in `deleteBookAtomic`**.
3. **Consolidate date formatting and ISBN normalization into shared utilities**.
