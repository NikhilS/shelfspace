# Book Catalog Orchestrator Normalization & Empty Search UI Plan

## 1. Diagnosis & Scope

1. **Upstream Provider Null / Non-Array Responses in `CatalogOrchestrator` (`src/server/services/catalog/catalogOrchestrator.ts`)**:
   - In `searchByQuery`, provider results from `runProviderTask` are merged via `if (list) { hits.push(...list); }`. If a provider returns `null`, a non-array payload, or an array containing `null`/`undefined` elements, spreading or downstream stitching can throw `TypeError: ... is not iterable` or fail when accessing hit properties.
   - In `fetchCoverCandidates`, `const hits = await p.searchByQuery({...query, limit: 3}, signal)` is iterated directly via `for (const h of hits)` without guarding against `null` or non-array return values from `p.searchByQuery`.
   - In `stitchBookHits`, `hits` is iterated assuming every element is a non-null `ProviderBookHit` object.

2. **Unified Search Service Normalization (`src/server/services/readingTracker/readingTrackerService.ts`)**:
   - `ReadingTrackerService.searchUnifiedCatalog` coordinates parallel local library queries and `catalogOrchestrator` calls (`searchByIsbn` and `searchByQuery`) and must guarantee normalized `libraryMatches` and `externalMatches` arrays even if an upstream provider or orchestrator method resolves to `null`.

3. **Graceful Empty-Result Handling in Search UI (`src/components/import/BookSearch.tsx`, `src/components/book/QuickAddBookDialog.tsx`, `src/pages/dashboard/TrackBookDialog.tsx`)**:
   - `BookSearch` and `TrackBookDialog` should defensively normalize API responses with `Array.isArray(...)` before updating state so nullish payloads never cause render or `.length` errors.
   - When a search yields zero matches across both accessible libraries and external catalogs, `BookSearch` and `TrackBookDialog` should present a clear empty state showing the searched query and a direct action to either clear the search or proceed to Manual Entry / Advanced Add.

---

## 2. Proposed Changes

### A. Harden `CatalogOrchestrator` (`src/server/services/catalog/catalogOrchestrator.ts`)
- **Provider Hit List Normalization**:
  - Introduce a helper `normalizeProviderHits(list: unknown): ProviderBookHit[]` that verifies `Array.isArray(list)` and filters elements to valid non-null `ProviderBookHit` objects with a non-empty `title`.
  - Use `normalizeProviderHits` across all `searchByQuery` waves (`BATCH` Wave 1, `BATCH` Wave 2, and `INTERACTIVE`) and inside `fetchCoverCandidates` when falling back to `p.searchByQuery(...)`.
- **Safe Cover Candidate Deduplication & Hit Stitching**:
  - In `deduplicateVerifyAndRank`, guard `if (!Array.isArray(list))` and `if (!candidate || typeof candidate.url !== 'string')`.
  - In `stitchBookHits`, guard `const safeHits = normalizeProviderHits(hits)` so `stitchBookHits` always returns a normalized `BookDetails[]` array even if `null` or malformed hits are passed.
  - Ensure `searchByQuery` always returns `{ books: BookDetails[], skippedProviders: string[], respondedProviders: string[] }` with `books` guaranteed to be a normalized array.

### B. Defensive Array Normalization in `ReadingTrackerService.searchUnifiedCatalog` (`src/server/services/readingTracker/readingTrackerService.ts`)
- Normalize `searchByIsbn` and `searchByQuery` results so `null` or partial responses always resolve to a clean `BookDetails[]` array, filtering out any nullish entries before deduplicating and matching against `libraryMatches`.

### C. Graceful Empty Results & Null-Safe UI (`src/components/import/BookSearch.tsx`, `src/components/book/QuickAddBookDialog.tsx`, `src/pages/dashboard/TrackBookDialog.tsx`)
- **`BookSearch.tsx`**:
  - Guard `res?.libraryMatches`, `res?.externalMatches`, and `metadata.searchByTitle` responses with `Array.isArray(...)`.
  - Add an optional `onOpenAdvanced?: () => void` prop so when `hasSearched && totalMatches === 0`, the empty state displays the query that was searched alongside action buttons to **Clear Search** or **Open Manual Entry / Advanced Add** (when `onOpenAdvanced` is provided).
- **`QuickAddBookDialog.tsx`**:
  - Wire `onOpenAdvanced={handleOpenAdvanced}` into `BookSearch` so users encountering zero search results inside the Quick Add modal can switch directly to manual entry / advanced import.
- **`TrackBookDialog.tsx`**:
  - Guard `res?.libraryMatches` and `res?.externalMatches` with `Array.isArray(...)`.
  - When both `libraryMatches` and `externalMatches` are empty after a search, render a unified empty state card with a prominent button to track the searched title manually.

### D. Unit & Component Tests
- **`src/server/services/catalog/catalogOrchestrator.test.ts`**:
  - Add unit tests verifying `searchByQuery`, `searchByIsbn`, and `fetchCoverCandidates` return normalized arrays when upstream providers return `null`, `undefined`, or arrays containing `null` items.
- **`src/server/services/readingTracker/readingTrackerService.test.ts`**:
  - Add a test case verifying `searchUnifiedCatalog` handles `null` / rejected orchestrator responses gracefully and still returns local library matches and a normalized `externalMatches: []` array.
- **`src/components/import/BookSearch.test.tsx`**:
  - Add tests verifying `BookSearch` handles empty/nullish unified search payloads gracefully and renders the empty state with the manual entry / clear search actions.
