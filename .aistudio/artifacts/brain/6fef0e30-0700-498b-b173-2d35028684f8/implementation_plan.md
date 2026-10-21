# Staff Engineer Codebase Audit & Cohesion Remediation Plan

## 1. Executive Summary of Audit Findings

A full-stack audit across tRPC routers, metadata enrichment services, React hooks, UI components, and Evergreen architecture documentation identified **6 concrete cohesion gaps and bugs** remaining after the Gemini model modernization and AI Plan rollout:

| # | Subsystem | Issue / Bug | Impact |
| :--- | :--- | :--- | :--- |
| **1** | **Library Creation (`useLibraries.ts`)** | `createLibrary()` unconditionally calls `trpc.gemini.generateLibraryHeroImage.mutateAsync` in the background after creating a library, ignoring `hasAiPlan`. | Every library creation by a standard user (`hasAiPlan: false`) triggers a background `403 FORBIDDEN` network error. |
| **2** | **Hybrid Enrichment State Poisoning & False Toast (`enrichmentService.ts`, `useBookInsights.ts`, `BookContent.tsx`)** | (a) When a non-AI-Plan Editor runs hybrid enrichment (`synopsis`, `authorBio`, `series`) and free catalog/Wikipedia lookup returns `null` (with Gemini fallback skipped due to `allowAiFallback: false`), `EnrichmentService` writes `enrichmentStatus[key] = 'unsupported'` to Firestore.<br>(b) `useBookInsights.triggerManualEnrichment` shows `toast.success('Synopsis updated!')` even when `processedCount === 0`. | (a) Permanently poisons the book's `enrichmentStatus` as `'unsupported'`, preventing Admins or AI-Plan Editors from auto-enriching it later.<br>(b) Misleads users with a success toast when no synopsis/bio was found. |
| **3** | **Legacy Metadata Router & Provider Defense-in-Depth (`metadata.ts`, `Geo/Temporal/EmbeddingMetadataProvider.ts`)** | (a) `metadata.enrichCreate` and `metadata.enrichSpruceUp` in `src/server/trpc/routers/metadata.ts` use `protectedProcedure` without checking `ctx.hasAiPlan` or passing `allowAiFallback` to `provider.bulkFetch()`.<br>(b) `GeoMetadataProvider`, `TemporalMetadataProvider`, and `EmbeddingMetadataProvider` lack the `if (options?.allowAiFallback === false) return {};` guard in `bulkFetch()` that `GenreMetadataProvider` enforces. | Leaves a secondary tRPC entry point (`metadata.enrichCreate` / `metadata.enrichSpruceUp`) and three pure-AI providers unguarded against `allowAiFallback === false`. |
| **4** | **Admin Waitlist Queue UI (`WaitlistManagement.tsx`)** | `WaitlistService.review` and `WaitlistManagement.handleReview` accept `hasAiPlan?: boolean`, but `WaitlistRow` only renders a single **"Approve"** button (which defaults `hasAiPlan` to `false`). | Admins approving a user from the waitlist must perform a second lookup in the Allowlist table to grant the AI Plan. |
| **5** | **CSV Import UX Copy (`BulkImport.tsx`)** | `BulkImport.tsx` displays *"Extracting books using AI..."* during all CSV uploads, even when standard Goodreads/StoryGraph/Calibre/Amazon exports are parsed deterministically without AI. | Confuses users without an AI Plan into thinking CSV import is AI-only. |
| **6** | **Evergreen Architecture Docs (`docs/evergreen/03`, `04`, `05`)** | Evergreen documentation does not yet include `aiProtectedProcedure`, `hasAiPlan` in `/appSettings/allowlist/users/{email}`, or `hasAiPlan` in `SecurityContext`. | Architectural documentation drift relative to the enforced runtime security model. |

---

## 2. Detailed Remediation Plan

### Track 1: Guard Background Hero Image Generation on Library Creation
- **File:** `src/pages/dashboard/useLibraries.ts`
- **Changes:**
  - Import and read `const {hasAiPlan} = useAppPermissions();` inside `useLibraries`.
  - In `createLibrary()`, only trigger `generateLibraryHeroImageMutation.mutateAsync({libraryName: trimmedName})` when `hasAiPlan` is `true`.

### Track 2: Fix `'unsupported'` Status Poisoning & Single-Book Enrichment Feedback
- **Files:**
  - `src/server/services/enrichmentService.ts`
  - `src/pages/book-details/useBookInsights.ts`
  - `src/pages/book-details/BookContent.tsx`
- **Changes:**
  - **Server (`EnrichmentService.triggerBatchEnrichment`):**
    - When `hasValidValue` is `false` (no metadata returned) for a hybrid catalog+AI field (`MetadataKey.SYNOPSIS`, `MetadataKey.AUTHOR_BIO`, `MetadataKey.SERIES`) AND `input.allowAiFallback === false`, **do not** write `enrichmentStatus[statusKey] = 'unsupported'` to Firestore. Instead, emit `stage: 'skipped'` without mutating `enrichmentStatus`, preserving the book's eligibility for future AI enrichment by an Admin or AI-Plan Editor.
    - When `allowAiFallback !== false` (or for catalog-only `MetadataKey.COVER_IMAGE`), continue writing `enrichmentStatus[statusKey] = 'unsupported'` when both catalog and AI fallback yield no data.
  - **Client (`useBookInsights.ts` & `BookContent.tsx`):**
    - Track auto-enrichment attempts per book ID in a `useRef<Set<string>>` (`attemptedAutoEnrichRef`) so that when `allowAiFallback === false` and free catalog lookup finds no synopsis/bio (leaving `enrichmentStatus` unset), the effect does not re-trigger in the same view session.
    - In `triggerManualEnrichment(type)`, inspect the returned result (`res.processedCount > 0`):
      - If `res.processedCount > 0`, show `toast.success(type === 'synopsis' ? 'Synopsis updated!' : 'Author biography updated!')`.
      - If `res.processedCount === 0`, show `toast.info(...)` explaining that no match was found in public catalogs (and noting that AI generation requires an active AI Plan if `!hasAiPlan`).
    - In `BookContent.tsx`, update the manual button label from `"Generate Synopsis"` / `"Generate Bio"` to `"Fetch Synopsis"` / `"Fetch Bio"` when `!hasAiPlan` so the button copy matches its catalog-only behavior.

### Track 3: Harden `metadataRouter` & Pure-AI Metadata Providers
- **Files:**
  - `src/server/trpc/routers/metadata.ts`
  - `src/server/services/metadata/providers/GeoMetadataProvider.ts`
  - `src/server/services/metadata/providers/TemporalMetadataProvider.ts`
  - `src/server/services/metadata/providers/EmbeddingMetadataProvider.ts`
- **Changes:**
  - In `metadata.enrichCreate`:
    - Compute `const allowAiFallback = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);`.
    - Pass `{allowAiFallback}` to `provider.bulkFetch(input.books as CoreBookData[], {allowAiFallback})`.
  - In `metadata.enrichSpruceUp`:
    - Compute `const allowAiFallback = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);`.
    - If `!allowAiFallback` and `input.providerKey` is in `PURE_AI_KEYS` (`GEO`, `TEMPORAL`, `GENRE`, `EMBEDDING`), throw `new TRPCError({code: 'FORBIDDEN', message: 'AI Plan required: Your account does not have an active AI Plan for AI metadata enrichment.'})`.
    - Pass `{allowAiFallback}` to `provider.bulkFetch(input.books as CoreBookData[], {allowAiFallback})`.
  - In `GeoMetadataProvider.bulkFetch`, `TemporalMetadataProvider.bulkFetch`, and `EmbeddingMetadataProvider.bulkFetch`:
    - Add `if (options?.signal?.aborted || options?.allowAiFallback === false) return {};` at the start of `bulkFetch()` to match `GenreMetadataProvider`.

### Track 4: Add One-Click "Approve + AI" to Admin Waitlist Queue
- **File:** `src/components/admin/WaitlistManagement.tsx`
- **Changes:**
  - Update `WaitlistRowProps` to accept `onApproveWithAi: () => void`.
  - In `WaitlistRow`, render an **"Approve + AI"** button (`id="waitlist-approve-ai-${entry.email}"`) with a `Sparkles` icon alongside the standard **"Approve"** button for `pending` (and `rejected`) applicants, calling `handleReview(entry.email, 'approve', true)`.

### Track 5: Clarify CSV Import Status & Description Copy
- **File:** `src/components/import/BulkImport.tsx`
- **Changes:**
  - Update the progress status text from `'Extracting books using AI...'` to `'Analyzing and extracting books from CSV...'`.
  - Update the instructional copy to note that standard exports from Goodreads, StoryGraph, Calibre, and Amazon are imported directly, with AI column mapping used for custom spreadsheets.

### Track 6: Synchronize Evergreen Architecture Documentation
- **Files:**
  - `docs/evergreen/03-API-AND-EXTERNAL-GATEWAY.md`
  - `docs/evergreen/04-BACKEND-AND-DATABASE-SCHEMA.md`
  - `docs/evergreen/05-CROSS-CUTTING-CONCERNS.md`
- **Changes:**
  - Document `aiProtectedProcedure` in the tRPC procedure hierarchy (`03-API-AND-EXTERNAL-GATEWAY.md`).
  - Document `hasAiPlan?: boolean` in `/appSettings/allowlist/users/{email}` (`04-BACKEND-AND-DATABASE-SCHEMA.md`).
  - Document `hasAiPlan: boolean` in `SecurityContext` and the orthogonal AI Plan access control layer (`05-CROSS-CUTTING-CONCERNS.md`).

---

## 3. Verification & Test Plan
1. **Unit & Integration Tests:**
   - Add test coverage in `src/server/services/enrichmentService.test.ts` verifying that when `allowAiFallback: false` and catalog lookup returns `null` for `synopsis`, `enrichmentStatus.synopsis` is **not** marked `'unsupported'`.
   - Add test coverage in `src/pages/AdminDashboard.test.tsx` / `WaitlistManagement` verifying the **"Approve + AI"** action passes `hasAiPlan: true`.
   - Run all test suites (`npx vitest run`) to verify zero regressions.
2. **Static Analysis & Compilation:**
   - Run `compile_applet` and `lint_applet` (`gts lint`) to confirm zero TypeScript or lint errors.
