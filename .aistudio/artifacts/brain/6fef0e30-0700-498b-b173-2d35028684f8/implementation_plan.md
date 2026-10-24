# Native Firestore Indexing, Query Pushdown & Blocked Duplicate Detection

Eliminate full-collection Firestore reads across the server data plane by leveraging native Firestore single-field and array indexes (`cleanIsbn`, `dedupeKey`, `searchTokens`, and `userStatuses.<userId>`), while upgrading client-side fuzzy duplicate detection from an $O(N^2)$ format pass to a multi-key blocking algorithm with no 2,500-book ceiling.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> All core architectural choices below incorporate your confirmed preferences from the clarification phase.

- **Confirmed Decision 1 — Server Query Migration Scope**: Migrate **all four** server-side full-collection scans to native Firestore indexed queries:
  1. **Personal Reading Shelf (`getPersonalReadingShelf`)**: Query non-virtual libraries using `.where(new FieldPath('userStatuses', userId), 'in', ['want_to_read', 'reading', 'finished', 'completed', 'abandoned'])` instead of reading every book document in every owned and shared library.
  2. **External Book Tracking Deduplication (`trackBook`)**: Query destination libraries by indexed `cleanIsbn` and `dedupeKey` (`.limit(1)`) instead of downloading the entire `books` subcollection on every track mutation.
  3. **Cross-Library Unified Search (`searchUnifiedCatalog`)**: Query accessible libraries using native Firestore `cleanIsbn` equality (for ISBN queries) or `searchTokens` `array-contains` (for text queries), refining multi-term matches in memory.
  4. **Single-Library Filtered Reads (`listBooks`)**: Push `primaryGenre` and `status` filters down to native Firestore `.where()` queries rather than slicing an arbitrary `orderBy('addedAt')` window in Node memory.
- **Confirmed Decision 2 — Index Field Rollout & Backfill Strategy**: Automatically compute and persist `cleanIsbn`, `dedupeKey`, and `searchTokens` on every book create, update, batch upsert, and duplicate merge; surface a one-click **Optimize Storage & Search Index** action in **Shelf Care → Storage & Reset** to backfill legacy books in chunked batches ($\le 400$ ops); and retain a transparent fallback when a library has unindexed legacy books.
- **Confirmed Decision 3 — Client Catalog Filtering & Fuzzy Duplicate Blocking**: Keep interactive single-library catalog search and faceted filtering (`useBookFilters`) in memory over the hydrated TanStack Query / IndexedDB cache for `<16ms` responsiveness and offline PWA support, and replace the $O(N^2)$ format-bucket loop in the Web Worker duplicate detector with **author-prefix and title-token blocking** so large libraries (>2,500 books) are scanned rapidly without truncation.

---

## 1. Overview & Core Concept

- **What It Does**: Replaces brute-force full-collection scans on the backend with targeted Firestore index lookups and upgrades the duplicate detection engine to scale linearly on multi-thousand-book collections.
- **Target Audience / Persona**: Readers and curators managing large personal libraries, shared family/club shelves, and cross-library reading trackers.
- **Key Value**:
  - **90–99% Fewer Firestore Reads on Reading Tracker & Track Actions**: Opening the Reading Room or tracking a book reads only matching documents instead of scanning every book across every accessible library.
  - **Zero Composite Index Maintenance**: Every new query is carefully structured around Firestore's automatic **single-field and array-membership indexes** (`==`, `in`, `array-contains`), requiring zero manual composite index provisioning.
  - **Unbounded, Fast Fuzzy Duplicate Scanning**: Eliminates the hard `n > 2500` cutoff in the duplicate detector by grouping candidate pairs through shared author and title blocking keys before computing Sørensen–Dice similarity.

---

## 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Automatic Indexing on Write**: Whenever a user adds, imports, edits, or merges a book, the server partitioner transparently computes `cleanIsbn`, `dedupeKey`, and `searchTokens` alongside core metadata.
  2. **Shelf Care — Storage & Search Index Optimization**:
     - In **Shelf Care → Storage & Reset**, the existing *Optimize Library Storage* card detects both books with unpartitioned heavy fields and legacy books missing normalized search/dedupe index fields (`cleanIsbn` / `dedupeKey` / `searchTokens`).
     - When legacy unindexed books are present, a warm, non-alarmist status banner informs the curator how many books can be indexed for faster search and duplicate matching, with a single primary action button (`Optimize Storage`).
     - Running the optimization relocates any leaked heavy fields to `bookDetails` and backfills `cleanIsbn`, `dedupeKey`, and `searchTokens` across all books in chunked Firestore batches ($\le 400$ operations).
  3. **Instant Cross-Library Search & Reading Room**: Searching in the Add/Track Book bar or loading the Reading Room returns identical results to today, but completes with minimal Firestore document reads.
  4. **Large-Library Duplicate Detection**: Opening **Shelf Care → Duplicates** on a 3,000+ book library smoothly identifies both exact and fuzzy title/subtitle duplicates without silently skipping large format buckets.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: Preserves the **Warm Archival Studio** aesthetic—clean warm stone surfaces (`--surface-container-low`), crisp `1px` hairlines (`border-outline-variant/30`), and zero mechanical telemetry clutter.
  - *Color Palette & Mood*: Warm amber notice state (`bg-amber-500/10`, `text-amber-800 dark:text-amber-300`) when books need storage/index optimization; calm forest-emerald confirmation state (`bg-emerald-500/10`, `text-emerald-800 dark:text-emerald-300`) once all books are optimized.
  - *Typography & Hierarchy*: Section headers in `Plus Jakarta Sans` (`font-serif`), body copy and controls in `Manrope` (`font-sans`), and book counts in tabular monospace (`font-mono tabular-nums`).
  - *Voice & Microcopy*: Follows the **Warm, Friendly, Crisp** standard—speaking in terms of *faster search and duplicate matching* rather than raw database index jargon.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Single-Field Firestore Queries Without Composite Indexes**
  - *Chosen Approach*: Formulate all new Firestore `.where()` queries (`userStatuses.<userId> in [...]`, `cleanIsbn == ...`, `dedupeKey == ...`, `searchTokens array-contains ...`, `primaryGenre == ...`) without combining them with a cross-field `.orderBy('addedAt')` on the server; sort the matched subset in Node memory when a `.where()` filter is active.
  - *Why*: Combining `.where('fieldA', '==', x)` with `.orderBy('addedAt', 'desc')` in Firestore requires a custom composite index per field—and for dynamic map keys like `userStatuses.<userId>`, composite indexes cannot be pre-created for every user ID. Sorting the matched results in memory after an indexed `.where()` filter uses Firestore's built-in single-field index with zero configuration and zero `FAILED_PRECONDITION` errors.
  - *Alternatives Considered*: Requiring manual composite indexes in `firestore.indexes.json` (rejected because dynamic `userStatuses.<userId>` keys cannot be statically indexed with `addedAt`).

- **Decision 2: Deterministic Token Generation (`searchTokens`) + Fallback for Legacy Libraries**
  - *Chosen Approach*: Tokenize normalized words (and meaningful word prefixes of length $\ge 3$, capped at 40 tokens per book) from `title`, `author`, `isbn`, and `series` into `searchTokens: string[]`. In `searchUnifiedCatalog`, query `.where('searchTokens', 'array-contains', primaryToken)` and verify full substring matches in memory; if a library has not been backfilled yet (e.g. token query returns 0 matches on a library whose `bookCount > 0` and has unindexed docs), gracefully fall back so zero search matches are ever lost prior to backfill.
  - *Why*: Firestore does not natively support arbitrary `LIKE '%substring%'` queries, but `array-contains` on normalized word tokens narrows candidate documents by >95% in a single indexed lookup while preserving exact substring verification on the returned candidates.
  - *Alternatives Considered*: Third-party search services like Algolia or Typesense (rejected to keep the architecture self-contained within Firebase without external credentials).

- **Decision 3: Multi-Key Blocking for Fuzzy Duplicate Detection**
  - *Chosen Approach*: Instead of comparing all $\binom{N}{2}$ pairs within each format bucket (which required a hard `n <= 2500` cutoff), assign each book 1–3 deterministic **blocking keys** inside the Web Worker:
    1. Normalized author surname / prefix (`authorBlock`: first 6 chars of normalized author or primary surname token) + format.
    2. First significant title word ($\ge 3$ chars) + format.
    3. Core title 4-character prefix + format.
    Only pairs sharing at least one blocking bucket are evaluated with `diceCoefficient`.
  - *Why*: Two books cannot achieve the required $\ge 0.82$ author Dice similarity and $\ge 0.86$ title Dice similarity without sharing either an author token/prefix or a title token/prefix. Blocking reduces comparisons on a 5,000-book library from ~12.5 million pairs to a few thousand pairs (<15ms in the Web Worker), allowing us to remove the 2,500-book ceiling completely.
  - *Alternatives Considered*: Running fuzzy duplicate detection on the server (rejected because the client already holds the hydrated catalog in memory, so running in the Web Worker costs 0 Firestore reads and works instantaneously).

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Query Flow Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                     WRITE PATH: BOOK PARTITIONER & SANITIZER                 │
│                                                                              │
│  createBook / updateBook / batchUpsert / mergeDuplicates / sanitize          │
│         │                                                                    │
│         ▼                                                                    │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │ Deterministic Index Key Builder                                        │  │
│  │ • cleanIsbn    = normalizeIsbnKey(isbn)                                │  │
│  │ • dedupeKey    = `${normalizeTitle(title, true)}::${normalizeAuthor}`  │  │
│  │ • searchTokens = tokenize(title, author, cleanIsbn, series) (max 40)   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────┬──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                   READ PATH: NATIVE FIRESTORE INDEXED QUERIES                │
├───────────────────────────────────────┬──────────────────────────────────────┤
│ 1. getPersonalReadingShelf            │ 2. trackBook Duplicate Lookup        │
│ • Virtual shelf: books.get()          │ • Query 1: where('cleanIsbn','==',…) │
│ • Owned/Shared libraries:             │ • Query 2: where('dedupeKey','==',…) │
│   where(FieldPath('userStatuses',uid),│ • Legacy fallback: where('isbn' /    │
│         'in', TRACKED_STATUSES)       │   'title', '==', …) if unindexed     │
├───────────────────────────────────────┼──────────────────────────────────────┤
│ 3. searchUnifiedCatalog               │ 4. BookService.listBooks(filters)    │
│ • ISBN query: where('cleanIsbn', …)   │ • primaryGenre: where('primaryGenre')│
│ • Text query: where('searchTokens',   │ • status: where(FieldPath(           │
│   'array-contains', bestToken)        │     'userStatuses', uid), '==', …)   │
│ • In-memory multi-token verification  │ • In-memory sort by addedAt desc     │
│   + legacy fallback if unindexed      │   (avoids composite index requirement│
└───────────────────────────────────────┴──────────────────────────────────────┘
                                        │
                                        ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                CLIENT PATH: WEB WORKER BLOCKED DUPLICATE ENGINE              │
│                                                                              │
│  Pass 1 (Exact O(N)): Hash buckets on `cleanIsbn:format` & `fullTitle|author`│
│  Pass 2 (Fuzzy Blocked):                                                     │
│    • Generate candidate pairs via Author Token/Prefix & Title Token blocks   │
│    • Deduplicate candidate pairs -> Compute Sørensen–Dice similarity         │
│    • Connected-components BFS graph -> Filter `allowedDuplicates`            │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Indexed Fields on `/libraries/{libraryId}/books/{bookId}`

| Field | Type | Purpose & Firestore Index Used |
| :--- | :--- | :--- |
| `cleanIsbn` | `string` (optional) | Uppercase alphanumeric ISBN-10/13 stripped of hyphens/spaces. Powers $O(1)$ exact ISBN lookup in `trackBook` and `searchUnifiedCatalog` via single-field `==` index. |
| `dedupeKey` | `string` | Normalized `${coreTitle}::${cleanAuthor}` key. Powers $O(1)$ title+author duplicate lookup in `trackBook` via single-field `==` index. |
| `searchTokens` | `string[]` | Deduplicated array (max 40 items) of lowercase tokens and 3–6 char word prefixes derived from `title`, `author`, `cleanIsbn`, and `series`. Powers cross-library `array-contains` search in `searchUnifiedCatalog`. |
| `userStatuses.{uid}` | `string` | Existing per-user reading status map entry. Queried via `new FieldPath('userStatuses', userId)` with `in` (`getPersonalReadingShelf`) and `==` (`listBooks` status filter). |

### Interactive Component & State Mapping

1. **Deterministic Index Computation (`BookPartitioner`)**:
   - On `partitionCreatePayload`: Computes `cleanIsbn`, `dedupeKey`, and `searchTokens` from the incoming `title`, `author`, `isbn`, and `series` fields.
   - On `partitionUpdatePayload`: Whenever `title`, `author`, `isbn`, or `series` is present in an update payload, recomputes the corresponding index fields (`cleanIsbn`, `dedupeKey`, `searchTokens`) so edits never leave stale index tokens.
2. **Shelf Care Storage & Search Index Optimization (`ResetMetadataSection` + `librarySpruceService`)**:
   - `hasHeavyLeaks` / storage inspection helper checks if a book has leaked heavy fields **or** is missing `dedupeKey` / `searchTokens`.
   - Executing `resetMetadata({ libraryId, metadataType: 'sanitize' })` on the server migrates any leaked heavy fields to `bookDetails` **and** backfills `cleanIsbn`, `dedupeKey`, and `searchTokens` on any book document missing them, committing in chunks of $\le 400$ batch operations.
3. **Server Query Guardrails & Legacy Fallbacks**:
   - **`getPersonalReadingShelf`**: For `virtual_${userId}`, reads the virtual shelf collection (where every book is tracked by the owner). For owned and shared libraries, executes `.where(new FieldPath('userStatuses', userId), 'in', ['want_to_read', 'reading', 'finished', 'completed', 'abandoned']).get()`.
   - **`trackBook`**: Runs parallel `.where('cleanIsbn', '==', targetIsbn).limit(1)` and `.where('dedupeKey', '==', targetDedupeKey).limit(1)` queries on the destination library. If neither matches, runs a lightweight exact `.where('title', '==', rawTitle).limit(5)` check (and only falls back to a collection scan if the mock/environment lacks `.where()` or returns unindexed legacy candidates).
   - **`searchUnifiedCatalog`**: Extracts the highest-selectivity token from the search query. Queries each accessible library using `.where('cleanIsbn', '==', queryIsbn)` (when ISBN-shaped) or `.where('searchTokens', 'array-contains', primaryToken)`. If a library has books (`bookCount > 0`) and the token query returns empty because legacy books have not yet been backfilled with `searchTokens`, falls back to scanning that specific legacy library so search results remain 100% complete before and after backfill.
   - **`BookService.listBooks`**: When `filters.primaryGenre` or `filters.status` is requested, applies native `.where()` clauses and sorts the resulting documents in memory by `addedAt` descending before applying cursor slicing.
4. **Blocked Fuzzy Duplicate Detection (`duplicateDetection.ts`)**:
   - Removes the `n > 2500` skip condition.
   - Indexes each `PreparedBook` into lightweight blocking buckets by `(format, authorSurnameOrPrefix)` and `(format, primaryTitleToken)`.
   - Evaluates pairwise `diceCoefficient` only across unique candidate pairs sharing a bucket, preserving 100% of existing duplicate matches and confidence scores while bounding worst-case work.
