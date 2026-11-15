# API Architecture & Gateway Design

> **Document Status:** Authoritative API & Gateway Standard  
> **Target Path:** `/docs/evergreen/03-API-AND-EXTERNAL-GATEWAY.md`

---

## 1. The Unified tRPC Gateway Architecture

To eliminate split-brain security rules and redundant REST wrappers, **book(ish)** routes 100% of data queries, mutations, and AI enrichment through a unified tRPC v11 Gateway running in the Node/Express service, complemented by a dedicated Server-Sent Events (SSE) progress stream.

```
+-----------------------------------------------------------------------------------+
|                                BOOK(ISH) WEB CLIENT                               |
|   [React 19 + TanStack Query + tRPC Client]          [EventSource SSE Progress]   |
+-----------------------+----------------------------------+------------------------+
                        |                                  |
            tRPC HTTP   | (Bearer Firebase JWT)            | GET /api/enrichment/stream
                        v                                  v
+-----------------------------------------------------------------------------------+
|                         NODE.JS / EXPRESS API GATEWAY (Port 3000)                 |
|                                                                                   |
|  1. Gateway Guards: Security Headers, Rate Limiting, Scoped Body Size Caps        |
|  2. Single-Path Auth Context: TokenVerifier (Firebase Admin ID Token JWT)         |
|  3. Permission Matrix: Platform Allowlist + Library Role (Owner/Editor/Viewer)    |
+-----------------------+----------------------------------+------------------------+
                        |                                  |
                        v                                  v
+-----------------------------------------------+  +--------------------------------+
|               tRPC v11 AppRouter              |  |     SSE Enrichment Stream      |
| - library       - metadata                    |  |  Real-time job snapshots and   |
| - book          - gemini                      |  |  item progress events          |
| - enrichment    - auth / user                 |  |                                |
+-----------------------+-----------------------+  +---------------+----------------+
                        |                                          |
                        +--------------------+---------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------+
|                   CLOUD FIRESTORE & CLOUD STORAGE (Admin SDK Only)                |
|  - Accessed exclusively by the Node.js server via firebase-admin                  |
|  - Client & direct SDK access sealed (firestore.rules & storage.rules: if false)  |
+-----------------------------------------------------------------------------------+
```

---

## 2. tRPC v11 Specification

### Procedure Hierarchy & Authorization Middleware
Every procedure must use the most restrictive builder applicable:

```typescript
// 1. Public Procedure (No credentials required)
publicProcedure.query(...)

// 2. Authenticated Procedure (Valid Firebase JWT required; used pre-allowlist for waitlist status/join)
authenticatedProcedure.query(...)

// 3. Protected Procedure (Valid Firebase JWT + verified allowlist membership required)
protectedProcedure.query(...)

// 4. AI Protected Procedure (Protected + requires caller to have an active AI Plan or Admin role)
aiProtectedProcedure.mutation(...)

// 5. Administrator Procedure (Caller must belong to the verified admin allowlist)
adminProcedure.mutation(...)

// 6. Library Procedure with Role Check (Validates caller has required role on the target library)
libraryProcedure('owner').mutation(...)  // Owner-only
libraryProcedure('editor').mutation(...) // Owner or Editor
libraryProcedure('viewer').query(...)    // Owner, Editor, or Viewer (Read-only)
```

### Procedure Conventions
1. **Always Validate with Zod:** Every query and mutation must declare an `input(zodSchema)` using hardened primitives (`safeIdSchema`, `safeUrlSchema`, `safeEmailSchema`) and strict object schemas.
2. **Request-Isolated Library Access & L1 Role Cache:** `libraryProcedure` captures resolved library metadata and caller roles via `AsyncLocalStorage` (`captureLibraryAccess`) backed by a bounded 60s L1 LRU+TTL cache (`LibraryMetadataCache`) with write-through invalidation on collaborator/library mutations.
3. **Request-Scoped Batch Deduplication (`ctx.requestLoaders`):** `SecurityContext` attaches lazy per-HTTP-request loaders (`getUserLibraries`, `getUserReadingStatesMap`) so batched procedures (`library.list`, `readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`) execute shared Firestore reads at most once per HTTP batch.
4. **Dual-Lane Streaming Transport (`splitLink` + `httpBatchStreamLink`):** `src/lib/trpc.ts` splits Fast Lane procedures (`auth.*`, `user.*`, `library.*`, `book.*`, `readingTracker.getShelf`, `readingTracker.getUnreadLibraryBooks`, `readingTracker.trackBook`) from Slow Lane procedures (`gemini.*`, `metadata.*`, `enrichment.*`, `readingTracker.getRecommendations`, `readingTracker.searchUnified`) over independent `httpBatchStreamLink` transports, and `server.ts` bypasses `compression()` buffering when `trpc-accept: application/jsonl` is present so resolved procedures flush to the browser immediately.
5. **Standardized Error Bubbling:** Use `TRPCError` with semantic codes:
   - `BAD_REQUEST`: Failed input validation or malformed identifier/ISBN.
   - `UNAUTHORIZED`: Missing or expired Firebase ID Token (`Bearer <JWT>`).
   - `FORBIDDEN`: User authenticated, but lacks allowlist membership or required library role.
   - `NOT_FOUND`: Target library or book does not exist.
   - `TOO_MANY_REQUESTS`: Rate limit exceeded.

---

## 3. Gateway Guards & Rate Limiting

1. **Payload Size Guards:**
   - Default JSON/URL-encoded request bodies are capped at `2MB`.
   - Base64 image vision and upload endpoints (`gemini.extractBooksFromImage`, `library.uploadImage`) use a scoped `15MB` parser with a `5MB` decoded binary buffer cap and raster magic-byte verification.
2. **Sliding-Window Rate Limiting:**
   - `/trpc`: $300\text{ req/min}$ per authenticated user/IP.
   - `/api/enrichment/stream`: $30\text{ req/min}$ per user/IP and max $5$ concurrent SSE streams per user.
   - `/api/client-log`: $20\text{ req/min}$ per IP.
   - Emits `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers on `429 Too Many Requests`.
3. **Log Sanitization & Token Redaction:**
   - Query parameters containing tokens (`?token=...`) are redacted (`[REDACTED]`) before HTTP access logs are written.
   - Client error logs strip control characters (`\r`, `\n`, ANSI escapes) and enforce strict field truncation.

---

## 4. Gemini Decisions & AI Provider Governance (`src/server/services/gemini/`)

All Gemini and external catalog calls execute exclusively on the server via `@google/genai` with `ProviderQuotaScheduler` dual-lane (`INTERACTIVE > BATCH`) rate limiting and `GlobalProviderGovernor` **Pool-Isolated Concurrency**:

1. **Isolated Execution Pools (`ExecutionPool` in `GlobalProviderGovernor`)**:
   - `FAST_DECISION` (`8` max concurrent, `2` reserved interactive; `geminiDecisionLimiter` at `150 RPM` / `100ms` spacing): Dedicated exclusively to sub-300ms `gemini-decision-1` calls so 3–5.5s external catalog HTTP scrapes can never starve calibrated Decision evaluations.
   - `EXTERNAL_CATALOG` (`24` max concurrent, `4` reserved interactive): Shared across Apple Books, Google Books, Open Library, Penguin Random House, Hardcover, Library of Congress, Wikidata, and Wikipedia.
   - `GENERATIVE_AI` (`8` max concurrent, `2` reserved interactive): Shared across open-ended `GeminiStructuredProvider` (`geminiLimiter`) and `GeminiEmbeddingProvider` (`geminiEmbeddingLimiter`).
2. **`GeminiDecisionProvider` (`gemini-decision-1` on `v1beta`)**:
   - Evaluates closed-set binary (`noul`), categorical (`choice`), and rubric (`score`) questions in a single zero-decoding forward pass via `ai.decisions.create`, validated at the boundary by `validateDecisionResponse` (`src/schemas/decisions.ts`).
   - Supports **Coalesced Multi-Domain Evaluation** (`DecisionQuestionContributor<Result>` & `runCoalescedDecisionsBatch` in `src/server/services/gemini/coalescedDecisions.ts`), packing multiple rubrics (such as `Genre` classification + `Series` standalone `noul` gating on book creation) into a single `gemini-decision-1` request per chunk.
   - Powers **7 closed-set enrichment & curation workflows**:
     - **Genre Classification (`classifyBooks`)**: Calibrated Decisions over canonical + custom genres and canonical subgenres with normalized primary `choice` confidence (`GENRE_CONFIDENCE_THRESHOLD = 0.65`).
     - **Temporal Chronology (`extractBookTemporalMetadataBatch`)**: Calibrated Decisions over `HISTORICAL_ERAS` and the 171-bucket `CHRONOLOGICAL_BUCKETS` catalog (`TEMPORAL_CONFIDENCE_THRESHOLD = 0.55`).
     - **Geographical Settings (`extractBookGeoMetadataBatch`)**: Calibrated Decisions over the 6-zone pre-geocoded `GLOBAL_LITERARY_GAZETTEER` (`GEO_CONFIDENCE_THRESHOLD = 0.55`), eliminating external geocoding calls on Gazetteer hits.
     - **Series Standalone Gate (`gateSeriesCandidatesWithDecisions`)**: Binary `noul` pre-filter (`SERIES_STANDALONE_NOUL_THRESHOLD = 0.45`) that prunes standalone volumes before external catalog or generative LLM lookups.
     - **Taste Re-Ranking (`rerankCandidatesWithDecisions`)**: Calibrated `score` (0–4) + curatorial `choice` lens ranking for unread shelf and catalog graph candidates.
     - **Fuzzy Duplicate Adjudication (`adjudicateDuplicateGroups` / `enrichment.adjudicateDuplicates`)**: Separates true duplicate editions from multi-volume sequels and selects `preferredSurvivorId`.
     - **Multimodal Cover & Bookshelf Pre-Screening (`verifyCoverImageWithDecisions`, `prescreenBookshelfImage`)**: Rejects disguised placeholder cover graphics and blurry/non-book shelf photos before OCR transcription.
3. **`GeminiStructuredProvider` (`gemini-3.8-flash` / `gemini-3.1-flash-lite`)**:
   - Reserved strictly for open-ended prose generation and OCR transcription (synopses, author biographies, deep insights, cluster naming, residual series string formatting, and legible spine OCR).
4. **`GeminiEmbeddingProvider` (`gemini-embedding-2-preview`)**:
   - Generates semantic vectors for Constellation clustering.

---

## 5. Multi-Tier Horizontal Wave Sieve (`src/server/services/metadata/`)

Metadata enrichment pipelines avoid per-field `if (enrichmentType === ...)` branching by declaring ordered `EnrichmentPipelineStage<Output>[]` arrays (`tier: 'decision' | 'catalog' | 'generative' | 'embedding'`) directly on each `MetadataPlugin<Output>`:

1. **Horizontal Wave Execution (`EnrichmentJobCoordinator` & `EnrichmentService`)**:
   - Wave 0 (`decision`, micro-batch size `30`) evaluates **all** eligible books in the job first using `Title + Author` (+ any already-saved Firestore `bookDetails.synopsis` read via `db.getAll`), immediately committing and streaming `resolved` and `pruned` books over SSE (`batch:committed`).
   - Subsequent waves (`catalog` micro-batch `10`, `generative` micro-batch `20`) dynamically batch **only** the residual books that returned `{ status: 'escalate' }` (e.g., standalone-surviving `Series` candidates, or `Genre` / `Geo` / `Temporal` books lacking a saved synopsis whose calibrated Decision confidence fell below threshold).
2. **Split Fast/Slow On-Create Enrichment (`MetadataRegistry` & `bookBatchUpsert`)**:
   - `enrichBooksOnCreateFastTier` runs coalesced `Genre + Series Gate` Decisions within the interactive synchronous create budget (`<= 30` books, `2.5s`), while `enrichBooksOnCreateSlowTier` hydrates catalog covers/synopses/series, targeted low-confidence Genre re-passes, and embeddings asynchronously after the primary Firestore batch commit.
3. **Opportunistic Non-Destructive Bonus Catalog Persistence (`bonusCatalogPatcher.ts`)**:
   - Whenever any residual book queries external catalog providers, `applyNonDestructiveBonusCatalogPatch` opportunistically persists missing `synopsis` (into `bookDetails` + `bookDetailsMetadata.hasSynopsis = true`), `isbn` (`cleanIsbn` + recomputed `searchTokens`), `publishedDate`, verified `coverUrl`, and non-standalone `series` without overwriting existing user data.


