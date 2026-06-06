# Wish List & Feature Requests

This file tracks feature ideas, planned improvements, and requested features for the book(ish) library app. You can ask the AI agent to append items here, mark them as complete, or implement them directly.

## Planned Features / Ideas
- [ ] Date Handling: Migrate manual timestamp manipulations and `Intl.DateTimeFormat` usage to a standard library like `date-fns` or `dayjs` for consistency.
- [ ] Normalize categories into a [standard taxonomy](https://www.bisg.org/BISAC-Subject-Codes-main).
- [ ] Revamp non-logged in landing page by looking at all the functionality the app now offers and updating the landing page to reflect those. Make it a great marketing page for the app.
- [ ] The "spruce up" page is getting a bit unwieldy. Create a (tabular or other) representation of all the functionality on that page and the details of how each works.
- [ ] What are all the checks that happen when I open a library? What loading indicators and statuses do you display as we go through those checks?

### Tech Debt & Code Review Findings (The "Angry Senior Dev" List)
- [x] **Dual Source of Truth for State**: `activeIndex` in `BookDetailsView` vs the `react-router` URL `bookId` param. Navigating via browser back/forward buttons won't reliably update `activeIndex`, leading to out-of-sync slides.
- [x] **Stale Location State**: `location.state.bookList` is used to populate Swiper. A hard refresh on a direct book URL results in an empty `bookList`, breaking the swiper completely and dropping the user into a fallback view.
- [x] **Unconstrained Cache Warming Hack**: `PrefetchAdjacentBooks` blindly sets up dummy `onSnapshot` listeners. This consumes concurrent connections and could trigger billable reads. Use standard application-level caching or `getDoc` with proper cache policies instead of hanging listeners.
- [x] **Optimistic Deletion Race Condition**: `handleDeleteBook` navigates back *before* waiting for the delete to succeed. If the exact deletion fails, the user is stranded on the previous page without realizing the book didn't actually delete.
- [x] **Virtual Swiper + Live Data Mismatch**: If a book is deleted (or added) by another session, the underlying data changes, but `location.state.bookList` is frozen. Virtual Swiper might choke on shifting indices if not reconciled gracefully.
- [x] **Hook Spam in Virtual Slides**: Every virtual slide mounts its own `useAuth`, `useBook`, `useBookInsights`. If Swiper buffers 5 slides, that's pulling redundant connections and heavy documents simultaneously. Slides should delay heavy data hook loading until they are adjacent or active.

## Code & Architectural Review Findings (AppSec & Senior Staff Review)

### [x] Topic 1: API Key Leakage & Client-Side SDK Usage
- **Location**: `src/services/gemini.ts` & `vite.config.ts`
- **Issue Category**: Architectural Anti-Pattern & Critical Security Vulnerability (Sensitive Data Exposure)
- **Description**: The Gemini API calls (generating cluster names, extracting books from images, pre-populating fields, insights) are executed directly on the client browser using the client-side GoogleGenAI SDK and relying on `import.meta.env.VITE_GEMINI_API_KEY` (which is compiled and exposed, or requires the user's browser environment to hold a private key). This exposes the API token to malicious actors, can run up catastrophic bills (denial of wallet), and breaks the environment's full-stack security protocol.
- **Severity**: Critical
- **Remediation/Refactored Code**: Migrate all Gemini API endpoints and interactions from client-side `src/services/gemini.ts` to server-side `/server.ts` under `/api/gemini/*` endpoints. Keep `GEMINI_API_KEY` strictly on the backend as a standard node environment variable (`process.env.GEMINI_API_KEY`), and delete any `VITE_GEMINI_API_KEY` injections. Update the frontend `src/services/gemini.ts` to call our backend Express proxies instead of direct `GoogleGenAI` initialization.

### [x] Topic 2: Tight Coupling & Anti-God Class Enforcement
- **Location**: `/src/pages/book-details/EditBookForm.tsx`
- **Issue Category**: Architectural Anti-Pattern (God Component / Monolithic File)
- **Description**: `EditBookForm.tsx` has grown to over 900 lines of code. It manages state for book deletion, camera/cropper inputs, search criteria across multiple APIs (Google Books, Open Library), and suggestions interface, resulting in a low separation of concerns. This hurts code navigation and readability.
- **Severity**: High
- **Remediation/Refactored Code**: Extract camera state/components (`CoverCamera.tsx`), form handlers, and metadata loaders into modular custom hooks (e.g., `useMetadataLoader.ts`) or separate presentation sub-components.

### [x] Topic 3: Code Reuse & DRY Principle Violation
- **Location**: `/server.ts` & `/src/lib/metadataUtils.ts`
- **Issue Category**: Code Redundancy (DRY Principle Violation)
- **Description**: The book metadata merging structures and validation schemas in `metadataUtils.ts` (used by the backfill metadata background jobs) are duplicated across both server-side resync utilities and client-side processing handlers.
- **Severity**: Medium
- **Remediation/Refactored Code**: Consolidate shared utilities, schema validators, types, and model mappings inside `/src/lib/utils.ts` and import them from there.

### [x] Topic 4: Rate Limiting & Concurrency Vulnerability
- **Location**: `/server.ts` [Resync Background Worker]
- **Issue Category**: Performance & Scalability Issue (Rate Limiting Vulnerability)
- **Description**: The server-side metadata backfiller splits books into chunks and fires non-blocking API lookups concurrently via `Promise.all`. While efficient for small batches, large libraries will exhaust Google Books and Open Library rate-limits, resulting in silent HTTP 429 failures or blocked IPs.
- **Severity**: Medium
- **Remediation/Refactored Code**: Introduce a throttled concurrency helper with built-in retries and exponential backoff.

### [x] Topic 5: Deficient Error Propagation Pattern
- **Location**: Everywhere
- **Issue Category**: Deficient Error Propagation Pattern
- **Description**: If a Firebase Firestore operation fails, the application prints the stack trace via `console.error` and occasionally shows generic error page alerts, but fails to recover or allow users to retry smoothly.
- **Severity**: Low
- **Remediation/Refactored Code**: Introduce local retry buttons, finer-grained Error Boundaries, and unified visual error toasts.

## Completed
- [x] Configure PWA installation
- [x] Create custom library-themed SVG favicon
- [x] Build smarter book clustering and grouping.
  - **Proposed Approach:** Generate text embeddings (via Gemini `text-embedding-004`) based on book descriptions/genres. Use dimensionality reduction (UMAP/PCA) to plot similarities.
  - **Interaction:** Create a 2D "Constellation Map" view of the library where proximity equals semantic similarity. (Opting for 2D over 3D to avoid occlusion and improve mobile usability).
  - **Algorithms:** Experiment with K-Means (for a distinct N number of clusters) or HDBSCAN (for density-based organic groupings).
  - **Math & Mechanics:** Text is converted into high-dimensional vectors (arrays of floating-point numbers). Proximity between points is calculated using distance metrics like Cosine Similarity to determine semantic closeness.
  - **Metadata Sources:** Fetch detailed descriptions, subjects, and genres from the Google Books API, and fallback to Gemini API enrichment to synthesize missing metadata context.
- [x] Upgrade book covers to use high-resolution versions.
- [x] Rename the "resync missing metadata" feature to "backfill missing metadata".
- [x] Add a new "resync all metadata" feature that refetches everything for all books.
- [x] Consider replacing the single 'genre' field with multiple categories, mirroring the Google Books API.
- [x] Once we have normalized categories, add some visualizations to the home page (e.g., a pie chart).
- [x] Once the app is a SPA, load the list of books once at startup and cache it in memory forever (till we add/remove a book etc).
- [x] **Denormalize Library Book Counts**: Maintain a `bookCount` field directly on the `libraries` documents. Currently, the Dashboard iterates over all libraries and fires a `getCountFromServer` for each one. While cheaper than `getDocs`, this incurs multiple aggregation queries that could be completely bypassed with a maintained counter.
- [x] **Optimize Library Deletion**: Deleting a library currently pulls every single book document payload into client memory using `getDocs` to populate a batch delete. We should consider offloading this to a Firebase Cloud Function for massive libraries or optimizing the query footprint.
- [x] **Separation of "Heavy" Data**: Features like the ConstellationMap.tsx cluster books using AI-generated embedding arrays (huge arrays of 768 floats). Because these embeddings live on the main Book document, whenever we query books, we are downloading the heavy embeddings as well—even for simple lists. We can move synopsis, authorBio, and embedding to a separate bookDetails subcollection. The primary books queries would become extremely lightweight (just title, author, cover image) resulting in a much faster initial render and drastically lower bandwidth egress.
