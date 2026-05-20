# Wish List & Feature Requests

This file tracks feature ideas, planned improvements, and requested features for the Athenaeum library app. You can ask the AI agent to append items here, mark them as complete, or implement them directly.

## Planned Features / Ideas
- [ ] Date Handling: Migrate manual timestamp manipulations and `Intl.DateTimeFormat` usage to a standard library like `date-fns` or `dayjs` for consistency.
- [ ] Add richer sharing modes (edit vs. view-only access).
- [ ] Normalize categories into a [standard taxonomy](https://www.bisg.org/BISAC-Subject-Codes-main).

### Tech Debt & Code Review Findings (The "Angry Senior Dev" List)
- [x] **Dual Source of Truth for State**: `activeIndex` in `BookDetailsView` vs the `react-router` URL `bookId` param. Navigating via browser back/forward buttons won't reliably update `activeIndex`, leading to out-of-sync slides.
- [x] **Stale Location State**: `location.state.bookList` is used to populate Swiper. A hard refresh on a direct book URL results in an empty `bookList`, breaking the swiper completely and dropping the user into a fallback view.
- [x] **Unconstrained Cache Warming Hack**: `PrefetchAdjacentBooks` blindly sets up dummy `onSnapshot` listeners. This consumes concurrent connections and could trigger billable reads. Use standard application-level caching or `getDoc` with proper cache policies instead of hanging listeners.
- [x] **Optimistic Deletion Race Condition**: `handleDeleteBook` navigates back *before* waiting for the delete to succeed. If the exact deletion fails, the user is stranded on the previous page without realizing the book didn't actually delete.
- [x] **Virtual Swiper + Live Data Mismatch**: If a book is deleted (or added) by another session, the underlying data changes, but `location.state.bookList` is frozen. Virtual Swiper might choke on shifting indices if not reconciled gracefully.
- [x] **Hook Spam in Virtual Slides**: Every virtual slide mounts its own `useAuth`, `useBook`, `useBookInsights`. If Swiper buffers 5 slides, that's pulling redundant connections and heavy documents simultaneously. Slides should delay heavy data hook loading until they are adjacent or active.


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
