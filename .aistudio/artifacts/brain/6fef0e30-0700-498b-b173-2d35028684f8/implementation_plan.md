# Diagnosis & Fix Plan: "Read Books" Showing as Untitled / Unknown Author

## Root Cause Analysis

Inspecting `/users/hiNrcTHzbtNZDQISgDGplgfCO0k1/readingStates` in Firestore revealed **11 documents**:
- **1 `reading` document (`isbn:9780007335817` — *"Dragon Haven"* by Robin Hobb):** Has a complete `bookSnapshot` object and displays properly.
- **10 `finished` documents (`bookid:ecbed85b09044594bd1c`, `bookid:199c04af81b94e72b23e`, `bookid:8ff18fc802964940b50d`, `bookid:5fe74feb8c7b45fa8b39`, `bookid:b59c32fc84f047c4a875`, `bookid:cf61f27b3b3b4e71813f`, `bookid:IHB6UZOH98DGDfUfrNbh`, `bookid:7c5134ca248744238b42`, `bookid:04e5283614c34088a7b4`, `bookid:8860d1cd93be470a82a4`):** All 10 reference existing Robin Hobb books in library `7Y8kXlJv96sjul1bXVT9` (*"Sterling Place"* — *Ship of Magic*, *Golden Fool*, *Mad Ship*, *Assassin's Quest*, *Fool's Fate*, *Royal Assassin*, *Assassin's Apprentice*, *Fool's Errand*, *Dragon Keeper*, and *Ship of Destiny*), but were saved **without a `bookSnapshot` field** and **without `cleanIsbn`**:
  ```json
  {
    "libraryId": "7Y8kXlJv96sjul1bXVT9",
    "id": "bookid:ecbed85b09044594bd1c",
    "keyType": "bookid",
    "userId": "hiNrcTHzbtNZDQISgDGplgfCO0k1",
    "bookId": "ecbed85b09044594bd1c",
    "finishedAt": "2026-10-26T01:00:05.940Z",
    "status": "finished"
  }
  ```

### Why This Happened (3 Compounding Issues)

1. **`batchUpsert` omits `bookSnapshot` and `isbn` on partial updates (`src/server/services/book/bookWriteService.ts:1037–1061`):**
   - When books have their `readingStatus` updated via `book.batchUpsert` (`type: 'update'`), `op.coreData` only contains the partial update delta (`{}` because `readingStatus` is partitioned out of `coreUpdates`).
   - `batchUpsert` then calls `buildReadingStateUpsertPayload` with:
     ```ts
     isbn: typeof baseData.isbn === 'string' ? baseData.isbn : undefined,
     cleanIsbn: typeof baseData.cleanIsbn === 'string' ? baseData.cleanIsbn : undefined,
     bookData: typeof baseData.title === 'string' ? { ...baseData, ...(op.heavyData || {}) } : undefined,
     ```
   - Because `baseData.title` and `baseData.isbn` are `undefined` on a status-only update (and `batchUpsert` never loads the existing book doc), `buildReadingStateUpsertPayload`:
     1. Omits `bookSnapshot` completely (`bookData` is `undefined`).
     2. Falls back to `stateKey = bookid:<bookId>` even for books that have an ISBN in `/libraries/{libraryId}/books/{bookId}` (which also causes `listBooks` and `getUnreadLibraryBooks` to miss the reading state when looking up `isbn:<cleanIsbn>`).

2. **`updateBookStatus` and `recordReadSwipeReview` silently drop `bookData` if converter throws (`src/server/services/book/bookWriteService.ts:310–323, 410–423`):**
   - Both methods wrap `bookDocConverter.fromFirestore(...)` in a bare `catch {}` block. When `bookDocConverter.fromFirestore` threw `SchemaValidationError` prior to the legacy-field converter fix, `bookData` silently became `undefined`, causing `buildReadingStateUpsertPayload` to write a bare `readingStates` doc with no `bookSnapshot` and a `bookid:<bookId>` key.

3. **`getPersonalReadingShelf` has no fallback hydration or self-healing (`src/server/services/readingTracker/readingTrackerService.ts:152–225`):**
   - `getPersonalReadingShelf` builds every shelf item exclusively from `state.bookSnapshot`:
     ```ts
     title: snap?.title || 'Untitled Book',
     author: snap?.author || 'Unknown Author',
     ```
   - When `state.bookSnapshot` is absent on a `readingStates` document, `getPersonalReadingShelf` does not look up the book in `/libraries/{libraryId}/books/{bookId}`, so all 10 books render as `"Untitled Book"` by `"Unknown Author"` with no cover image.

---

## Proposed Fixes

### 1. Hydrate Book Metadata on Partial `batchUpsert` & Harden `updateBookStatus` (`src/server/services/book/bookWriteService.ts`)
- **In `batchUpsert`:**
  - Before building batch writes, identify any non-delete operation with `op.readingStatus` where `op.coreData` does not already include `title`.
  - Fetch the existing `/libraries/{libraryId}/books/{bookId}` (and `/bookDetails/{bookId}`) documents in parallel and merge them with `op.coreData` / `op.heavyData` before calling `buildReadingStateUpsertPayload`.
  - Ensure `isbn` and `cleanIsbn` from the existing book are passed to `buildReadingStateUpsertPayload` so the canonical `isbn:<cleanIsbn>` key and full `bookSnapshot` are always written.
- **In `updateBookStatus` & `recordReadSwipeReview`:**
  - Fetch both `/libraries/{libraryId}/books/{bookId}` and `/libraries/{libraryId}/bookDetails/{bookId}` in parallel so `bookSnapshot` includes synopsis and heavy metadata.
  - If `StateKey` migrates from a stale `bookid:<bookId>` doc to `isbn:<cleanIsbn>`, clean up the stale `bookid:<bookId>` doc in `/users/{userId}/readingStates`.

### 2. Hydrate & Self-Heal Missing `bookSnapshot` in `getPersonalReadingShelf` (`src/server/services/readingTracker/readingTrackerService.ts`)
- In `getPersonalReadingShelf`:
  - Detect any `readingStates` entry where `!state.bookSnapshot || !state.bookSnapshot.title || state.bookSnapshot.title === 'Untitled Book'` and `state.libraryId` + `state.bookId` are present.
  - Fetch the referenced `/libraries/{libraryId}/books/{bookId}` and `/bookDetails/{bookId}` documents in parallel.
  - Use the hydrated `bookSnapshot` immediately when constructing `allTracked` so the Reading Room never renders `"Untitled Book"` for an existing library book.
  - Self-heal the user's `/users/{userId}/readingStates` document in Firestore (writing the full `bookSnapshot`, and if the book has an ISBN while the state was stored under `bookid:<bookId>`, writing the canonical `isbn:<cleanIsbn>` doc and deleting the stale `bookid:<bookId>` doc).

### 3. Repair the 10 Existing `readingStates` Documents & Add Regression Tests
- Run a one-time backfill for `/users/hiNrcTHzbtNZDQISgDGplgfCO0k1/readingStates` to populate `bookSnapshot` (and canonical `isbn:<cleanIsbn>` keys for the 7 ISBN-bearing books) from `/libraries/7Y8kXlJv96sjul1bXVT9/books/{bookId}` and `/bookDetails/{bookId}`, while preserving the existing `finishedAt`, `status`, and `updatedAt` values.
- Add unit tests in `src/server/services/book/bookService.test.ts` and `src/server/services/readingTracker/readingTrackerService.test.ts` verifying:
  - Partial `batchUpsert` updates with `readingStatus` populate `bookSnapshot` and `isbn:<cleanIsbn>` state keys from existing book docs.
  - `getPersonalReadingShelf` hydrates and self-heals `readingStates` docs that are missing `bookSnapshot`.
