# Firestore Read & Write Efficiency and Atomicity Plan

## Goal
Eliminate $N+1$ individual Firestore reads and sequential/unbatched writes across the backend service layer by replacing them with bulk reads (`db.getAll`) and chunked, atomic `db.batch()` commits ($\le 400$ operations per batch). Rather than adding fallback branches in production code for incomplete test mocks, update any unit test mocks to directly support `db.getAll` and `db.batch()`.

---

## 1. Bulk Read Optimizations (`db.getAll`)

### 1.1 Batch Metadata Enrichment (`src/server/services/enrichmentService.ts`)
- **Problem**: `triggerBatchEnrichment` currently executes $N$ individual `booksCollection.doc(bookId).get()` calls followed by up to $N$ individual `detailsCollection.doc(bookId).get()` calls when `needsSynopsisContext` is true ($2N$ RPC round-trips).
- **Solution**:
  - Fetch all $N$ book documents in a single `db.getAll(...bookRefs)` call.
  - Collect the subset of valid books that still lack an inline synopsis when `needsSynopsisContext` is true, and fetch all corresponding `bookDetails/{bookId}` documents in a single `db.getAll(...missingDetailRefs)` call.

### 1.2 Duplicate Book Merge (`src/server/services/book/bookWriteService.ts`)
- **Problem**: `mergeDuplicates` fetches `[survivorBookId, ...cleanDupIds]` via `Promise.all(allBookIds.map(id => booksCol.doc(id).get()))`.
- **Solution**:
  - Use `db.getAll(...bookRefs)` directly to retrieve the survivor and all duplicate books in a single bulk read RPC.
  - Pre-fetch the `reviews` subcollections for all `cleanDupIds` in parallel via `Promise.all` prior to assembling the write batches, rather than awaiting `.collection('reviews').get()` sequentially inside the batch loop.

### 1.3 Bulk Allowlist & Collaborator Status Resolution (`src/server/auth/allowlistService.ts`, `src/server/services/library/libraryShareService.ts`, `src/server/services/library/libraryCrudService.ts`)
- **Problem**: `getCollaboratorStatuses` and `updateLibrary` call `AllowlistService.getPermissions(email)` individually for each collaborator, causing $M$ separate Firestore reads on cold cache, and `updateLibrary` awaits waitlist registration sequentially inside a `for` loop.
- **Solution**:
  - Add `AllowlistService.getPermissionsBulk(emails: string[]): Promise<Map<string, SecurityPermissions>>`:
    - Normalizes emails, resolves superadmin and L1 cache hits immediately, and fetches all remaining cache-miss documents from `appSettings/allowlist/users/{email}` in a single `db.getAll(...refs)` call, populating the L1 cache for each.
  - Update `getCollaboratorStatuses` and `updateLibrary` to call `AllowlistService.getPermissionsBulk(...)`.
  - Add `WaitlistService.ensureInvitedEntriesBulk(...)` (using `db.getAll` + `db.batch()`) so `updateLibrary` registers any unapproved invitees in a single bulk read + single batch write instead of a sequential loop.

### 1.4 Geolocation L2 Cache Bulk Read & Batch Write (`src/server/services/geolocation.ts` & `src/server/services/metadata/providers/GeoMetadataProvider.ts`)
- **Problem**: During batch geo enrichment, up to 50 locations are geocoded per chunk, each triggering individual Firestore `geolocationCache/{slug}` reads and writes.
- **Solution**:
  - Add `warmGeocodeCacheBulk(names: string[]): Promise<void>` in `geolocation.ts` that identifies all location slugs missing from the L1 in-memory cache and fetches them in a single `db.getAll(...docRefs)` call from `geolocationCache`, populating L1 and persisting to disk once.
  - Add `cacheGeocodesBulk(entries: Array<{name: string; coordinates: {lat: number; lng: number}}>): Promise<void>` using `db.batch()` + single disk flush.
  - Update `GeoMetadataProvider.bulkFetch` to pre-warm all extracted location names in bulk before geocoding and flush newly resolved coordinates in a batch.

---

## 2. Bulk & Atomic Write Optimizations (`db.batch()`)

### 2.1 Batch Metadata Enrichment Commits (`src/server/services/enrichmentService.ts`)
- **Problem**: `triggerBatchEnrichment` executes individual `.update()` and `.set()` calls per book inside `Promise.all` (up to $2N$ separate write RPCs per chunk, and non-atomic updates between `books/{id}` and `bookDetails/{id}`).
- **Solution**:
  - Stage all `books/{bookId}` and `bookDetails/{bookId}` writes into chunked `db.batch()` commits ($\le 400$ operations per batch).
  - Emit `onBookProgress` callbacks after the batch commit succeeds so progress reporting accurately reflects committed state.

### 2.2 Background On-Create Enrichment Chunking & Safe Cascade Deletes (`src/server/services/book/bookWriteService.ts` & `src/server/services/library/libraryCrudService.ts`)
- **Problem**:
  1. In `batchUpsert`, the background `enrichOnCreate` callback (`bgBatch`) accumulates all `books` and `bookDetails` updates into a single unchunked `db.batch()`, which can exceed Firestore's 500-operation limit on large CSV imports (>250 books).
  2. In `batchUpsert` and `deleteLibrary`, cascading review deletions await `bookRef.collection('reviews').get()` sequentially inside the `for` loop and can push `currentBatchOps` past `BATCH_LIMIT` inside `reviewsSnap.forEach` before the outer commit check runs.
  3. In `deleteLibrary`, `await libRef.delete()` is executed as a separate sequential write after committing the batch.
- **Solution**:
  - Chunk `bgBatch` commits at `BATCH_LIMIT = 400` operations.
  - Pre-fetch review snapshots for all books being deleted in parallel (`Promise.all`) before building write batches, and check `currentBatchOps >= BATCH_LIMIT` inside the review deletion loop.
  - Include `batch.delete(libRef)` in the final batch commit of `deleteLibrary` (when `count < batchSize`).

### 2.3 Atomic Review & Reading Status Writes (`src/server/services/book/bookReviewService.ts` & `src/server/services/readingTracker/readingTrackerService.ts`)
- **Problem**:
  - `BookReviewService.addReview` sequentially awaits `reviewRef.set(reviewDoc)` and `bookRef.update({ userRatings... })`.
  - `ReadingTrackerService.trackBook` sequentially awaits `BookService.updateBookStatus` and then `BookService.addReview` or `bookRef.update({ userRatings... })`, writing to the same `books/{bookId}` document twice in sequence.
- **Solution**:
  - Update `BookReviewService.addReview` to commit both `reviewRef.set(reviewDoc)` and `bookRef.update(...)` in a single `db.batch()` (and accept an optional `statusUpdate?: string` so status + rating + review can be committed together).
  - Update `ReadingTrackerService.trackBook` to combine `userStatuses.${userId}`, `userRatings.${userId}`, and any new review document into a single atomic `db.batch()` operation (or single `bookRef.update` when no review text is provided).

### 2.4 Atomic Waitlist Review & Allowlist Grant (`src/server/auth/waitlistService.ts` & `src/server/auth/allowlistService.ts`)
- **Problem**: Approving a user via `WaitlistService.review` calls `AllowlistService.addUser` (which writes `allowlist/users/{email}`, reads `waitlist/entries/{email}`, and updates `waitlist/entries/{email}`) and then `WaitlistService.review` writes to `waitlist/entries/{email}` a second time (1 read + 3 sequential writes).
- **Solution**:
  - Always use a single `db.batch()` in `WaitlistService.review` (and `AllowlistService.addUser` when syncing waitlist status) to commit both `allowlist/users/{email}` and `waitlist/entries/{email}` atomically in one batch without redundant reads or double-writes.

---

## 3. Verification & Test Suite Plan
- Update existing unit test Firestore mocks to provide `db.getAll` and `db.batch()` where needed instead of adding fallback logic in production code.
- Add and update unit tests across:
  - `src/server/services/enrichmentService.test.ts` (verifying `db.getAll` bulk reads for `books` and `bookDetails` and `db.batch` atomic writes).
  - `src/server/services/book/bookService.test.ts` (verifying `db.getAll` in `mergeDuplicates`, chunked `bgBatch` in `batchUpsert`, and atomic `db.batch` in `addReview`).
  - `src/server/services/readingTracker/readingTrackerService.test.ts` (verifying consolidated status+rating+review writes via `db.batch`).
  - `src/server/auth/allowlistService.test.ts`, `src/server/auth/waitlistService.test.ts`, & `src/server/services/library/libraryService.test.ts` (verifying `getPermissionsBulk`, `ensureInvitedEntriesBulk`, and single-batch atomic waitlist approval).
  - `src/server/services/geolocation.test.ts` (verifying `warmGeocodeCacheBulk` and `cacheGeocodesBulk`).
- Run full test suite (`npx vitest run`), `lint_applet`, and `compile_applet` to ensure zero regressions.
