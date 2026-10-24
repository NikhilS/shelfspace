# Database Correctness, Scalability & Payload Efficiency Remediation

Eliminates index-clobbering regressions on partial updates, fixes multi-word and series search post-filtering, repairs filtered pagination cursors and duplicate-merge rating preservation, bounds subcollection concurrency during library deletion, and strips heavy `searchTokens` arrays from client catalog payloads.

## User Review & Critical Decisions

> [!IMPORTANT]
> Both scope and payload design choices have been confirmed and incorporated into this plan:

- **Confirmed Decision 1 — Full Remediation Scope (Findings A–F)**: We will resolve all four correctness bugs (partial update index preservation, unified search post-filtering & partial-index fallback, filtered `listBooks` cursor/fallback behavior, and `mergeDuplicates` rating preservation), the scalability bottleneck in `deleteLibrary`, and the client wire-payload optimization.
- **Confirmed Decision 2 — Lightweight Client Index Flag (`hasSearchTokens`)**: Server responses will strip the raw `searchTokens` array (up to 40 tokens per book) when constructing client `Book` payloads and expose a lightweight `hasSearchTokens: boolean` flag so Shelf Care storage optimization can still detect unindexed books without adding ~1.2 MB of token bloat to large catalogs.

---

## 1. Overview & Core Concept

- **What It Does**: Hardens the end-to-end Firestore data plane so that every partial book edit, background enrichment job, unified catalog search, status/genre filter, duplicate merge, and library deletion behaves deterministically at scale while keeping browser cache payloads lean.
- **Target Audience / Persona**: Readers and collectors managing personal and shared libraries of up to several thousand books across online and offline PWA sessions.
- **Key Value**:
  - Prevents partial edits or background enrichment (`series`, `isbn`) from erasing title/author search tokens or leaving stale `dedupeKey` values.
  - Ensures multi-word queries (such as combining title and author words) and series queries return accurate matches across both fully indexed and partially backfilled libraries.
  - Preserves user star ratings when merging duplicate books and eliminates redundant 1,000-document fallback reads when a filtered status shelf is legitimately empty.
  - Reduces catalog wire and IndexedDB cache size by stripping server-only search token arrays from client book payloads.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  - **Unified Reading Search**: Typing a multi-word title + author query (e.g., `"Dune Herbert"`) or a series name (e.g., `"Hainish Cycle"`) immediately surfaces matching books from owned, shared, and personal reading shelves—even in libraries that contain a mix of newly indexed and legacy unindexed books.
  - **Catalog Status & Genre Filtering**: Filtering a library by reading status or primary genre paginates cleanly in descending `addedAt` order without skipping or repeating books across cursor pages, and empty status shelves return instantaneously without triggering a background collection scan.
  - **Duplicate Resolution**: Merging two duplicate copies preserves both each member's highest reading progress (`userStatuses`) and their star ratings (`userRatings`) alongside migrated reviews.
  - **Shelf Care Storage & Index Check**: The **Optimize Library Storage** card in Shelf Care accurately detects books missing `hasSearchTokens`, `cleanIsbn`, or `dedupeKey` without downloading raw token arrays to the browser.
- **Visual Identity & Theme**:
  - Preserves the **Modern Archivist** aesthetic, Natural Materials palette, Manrope typographic hierarchy, and **Warm, Friendly, Crisp** microcopy across all Shelf Care, Reading Tracker, and catalog views.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Context-Aware Index Recomputation & Additive Token Merging on Partial Updates**
  - *Chosen Approach*: When a partial update modifies `title`, `author`, `series`, or `isbn`, recompute `dedupeKey` and `searchTokens` using the complete book tuple (`title`, `author`, `isbn`, `series`) whenever baseline book context is available (or fetched in single-book `updateBook` and passed in `batchUpsert`'s `enrichOnCreate` and `EnrichmentService`). If `partitionUpdatePayload` is invoked with only `series` or `isbn` and no baseline `title`/`author`, use `FieldValue.arrayUnion(...newTokens)` rather than overwriting `searchTokens`.
  - *Why*: Overwriting `searchTokens` from a partial 1-field patch clobbers existing title and author tokens in Firestore. Using full context (or `arrayUnion` for additive fields) guarantees existing search tokens are never lost.
  - *Alternatives Considered*: Requiring callers to always send full book objects on every partial mutation was rejected because background enrichment providers only emit delta patches.

- **Decision 2 — Tokenized Multi-Field Post-Filtering & Post-Filter Fallback in Unified Search**
  - *Chosen Approach*: Split the user's search query into normalized terms and verify that every query term matches across the union of `title`, `author`, `series`, and `cleanIsbn`. Evaluate this post-filter per library before deciding whether the native `.where('searchTokens', 'array-contains', ...)` query succeeded; if the indexed query yields zero post-filtered matches and any returned document or library metadata indicates unindexed legacy records, fall back to scanning only unindexed documents (`!Array.isArray(data.searchTokens)`).
  - *Why*: Prevents false negatives on multi-word title+author queries, enables series search, and closes the blind spot where a single false-positive prefix match in a partially indexed library suppresses legacy fallback.

- **Decision 3 — Stripping `searchTokens` in Favor of `hasSearchTokens` on Client Payloads**
  - *Chosen Approach*: In `BookPartitioner.mergeBookAndDetails`, compute `hasSearchTokens = Array.isArray(bookData.searchTokens) && bookData.searchTokens.length > 0`, delete `searchTokens` from the returned client `Book` object, and check `!b.hasSearchTokens` in Shelf Care's `needsIndexBackfill` detector.
  - *Why*: `searchTokens` is strictly a Firestore server-side inverted index field. Stripping the 40-element string array saves ~400–600 bytes per book (~1.2 MB across a 2,500-book library) on every tRPC catalog response and IndexedDB cache persistence cycle.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                        Client Application (Browser)                          │
│                                                                              │
│  ┌─────────────────────────┐  ┌─────────────────────────┐  ┌──────────────┐  │
│  │  Catalog & Reading View │  │   Unified Search Modal  │  │  Shelf Care  │  │
│  │  (Sorted Cursor Pages)  │  │ (Multi-Term + Series)   │  │ (Backfill UI)│  │
│  └────────────┬────────────┘  └────────────┬────────────┘  └──────┬───────┘  │
│               │                            │                      │          │
│               └────────────────────────────┼──────────────────────┘          │
│                                            ▼                                 │
│                     Lean Client Book Payload (hasSearchTokens: boolean)      │
└────────────────────────────────────────────┬─────────────────────────────────┘
                                             │ tRPC v11 Gateway
┌────────────────────────────────────────────▼─────────────────────────────────┐
│                       Server Data Authority (Admin SDK)                      │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ BookPartitioner                                                        │  │
│  │ • Create: Full cleanIsbn + dedupeKey + searchTokens                    │  │
│  │ • Partial Update: Merges baseline (title, author, isbn, series) or     │  │
│  │   uses FieldValue.arrayUnion for additive series/isbn patches          │  │
│  │ • Read Merge: Sets hasSearchTokens boolean & strips raw searchTokens   │  │
│  └───────────────┬────────────────────────────────────────┬───────────────┘  │
│                  ▼                                        ▼                  │
│  ┌────────────────────────────────────┐   ┌───────────────────────────────┐  │
│  │ Write & Maintenance Services       │   │ Read & Search Services        │  │
│  │ • updateBook / enrichOnCreate /    │   │ • listBooks: Sorted-slice     │  │
│  │   EnrichmentService: Preserves     │   │   nextCursor + targeted       │  │
│  │   full index tuple on edits        │   │   legacy status fallback      │  │
│  │ • mergeDuplicates: Unions both     │   │ • searchUnifiedCatalog:       │  │
│  │   userStatuses & userRatings       │   │   Multi-term (title/author/   │  │
│  │ • deleteLibrary: .select() refs,   │   │   series/isbn) post-filter +  │  │
│  │   direct bookDetails sweep,        │   │   partial-index fallback      │  │
│  │   bounded review concurrency       │   │                               │  │
│  └────────────────────────────────────┘   └───────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Interactive Component & Service Mapping

1. **Safe Index Maintenance on Partial Updates (`BookPartitioner`, `BookWriteService`, `EnrichmentService`)**:
   - Extend `PartitionUpdateOptions` with `existingBook?: {title?: string; author?: string; isbn?: string; series?: string}`.
   - When `title` or `author` changes, compute `dedupeKey` using `coreUpdates.title ?? existingBook?.title` and `coreUpdates.author ?? existingBook?.author` whenever both values are available.
   - When any of `title`, `author`, `series`, or `isbn` changes:
     - If effective `title` and `author` are both known (from `coreUpdates` or `existingBook`), compute the complete `searchTokens` array across effective `{title, author, isbn, series}`.
     - If only `series` or `isbn` is present in `coreUpdates` without `existingBook` context, compute tokens for the updated field(s) and set `coreUpdates.searchTokens = FieldValue.arrayUnion(...newTokens)` so existing title/author tokens are preserved.
     - In `batchUpsert` (`enrichOnCreate` background callback) and `mergeDuplicates`, pass `existingBook` from the in-memory `booksToEnrich` / `survivorSnap` record.
     - In `updateBook`, if `updates` modifies `title`, `author`, `series`, or `isbn` without providing both `title` and `author`, read the current book document first so `dedupeKey` and `searchTokens` are recomputed accurately.
     - In `EnrichmentService.triggerBatchEnrichment` (`MetadataKey.SERIES`), compute updated `searchTokens` from `bookData` (`title`, `author`, `isbn`) + the newly enriched `series` string and write `searchTokens` alongside `series`.

2. **Multi-Term & Series-Aware Unified Catalog Search (`ReadingTrackerService.searchUnifiedCatalog`)**:
   - Tokenize `queryLower` into individual search terms (`queryTerms = queryLower.split(/\s+/).filter(Boolean)`).
   - Match a book if `isbnMatch` is true OR every term in `queryTerms` appears in at least one of `titleLower`, `authorLower`, `seriesLower`, or `cleanBookIsbn`.
   - Include `series: data.series` in the returned `UnifiedLibrarySearchMatch` payload.
   - Apply the post-filter inside each library's search task: if the native `.where('searchTokens', 'array-contains', primarySearchToken)` query yields zero post-filtered matches and the library is non-empty (`libMeta.bookCount !== 0`), fall back to checking unindexed legacy documents (`!Array.isArray(data.searchTokens)`) so mixed indexed/unindexed libraries never drop legacy matches.

3. **Filtered `listBooks` Cursor Alignment & Targeted Legacy Fallback (`BookReadService.listBooks`)**:
   - When `appliedNativeWhereFilter` is `true` and `rawDocs.length === 0`:
     - If `options?.filters?.status` was requested, only query legacy top-level `.where('status', '==', options.filters.status).limit(fetchLimit).get()` instead of scanning 1,001 arbitrary documents.
     - If `options?.filters?.primaryGenre` was requested, only run the bounded fallback scan if the collection could contain case-mismatched genre strings.
   - When computing `nextCursor` on line 282, use `slicedBooks[slicedBooks.length - 1]?.id` whenever `appliedNativeWhereFilter` is `true` (since `books` has already been sorted in memory by `addedAt desc`), ensuring subsequent cursor pages slice from the exact sorted boundary.

4. **Rating Preservation in Duplicate Merge (`BookWriteService.mergeDuplicates`)**:
   - Alongside `mergedUserStatuses`, iterate through `bookDocs` (survivor first, then duplicates) to union `userRatings` (`Record<string, number>`): preserve the survivor's rating for a user if present, or adopt the highest valid numeric rating ($\ge 1$) from the duplicate records.
   - Include `userRatings: mergedUserRatings` in `combinedUpdates` and allow `userRatings` passthrough when `allowFullUserStatuses: true` is set in `BookPartitioner.partitionUpdatePayload`.

5. **Bounded Concurrency & Orphan-Free Cleanup in `LibraryService.deleteLibrary`**:
   - Fetch `books`, `bookDetails`, and `allowedDuplicates` references in parallel using `.select()` (empty field projection when supported by Admin SDK, falling back to `.get()` in mocks) so full document payloads are not pulled into memory and any orphaned `bookDetails` docs are also deleted.
   - Fetch `reviews` subcollections across `booksSnap.docs` in bounded concurrency chunks (e.g., 25 books at a time) rather than firing thousands of simultaneous RPCs in a single `Promise.all`.

6. **Lean Client Payload (`BookPartitioner.mergeBookAndDetails` & `ResetMetadataSection`)**:
   - Add `hasSearchTokens?: boolean` to `Book` in `src/types/book.ts`.
   - In `BookPartitioner.mergeBookAndDetails`, set `hasSearchTokens: Array.isArray(bookData.searchTokens) && bookData.searchTokens.length > 0` and omit `searchTokens` from the returned client `Book` object.
   - Update `needsIndexBackfill` in `ResetMetadataSection.tsx` to check `!b.hasSearchTokens && (!Array.isArray(b.searchTokens) || b.searchTokens.length === 0)`.
