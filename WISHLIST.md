# Wish List & Feature Requests

This file tracks feature ideas, planned improvements, and requested features for the Athenaeum library app. You can ask the AI agent to append items here, mark them as complete, or implement them directly.

## Planned Features / Ideas
- [ ] Date Handling: Migrate manual timestamp manipulations and `Intl.DateTimeFormat` usage to a standard library like `date-fns` or `dayjs` for consistency.
- [ ] Add richer sharing modes (edit vs. view-only access).
- [ ] Normalize categories into a [standard taxonomy](https://www.bisg.org/BISAC-Subject-Codes-main).


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
