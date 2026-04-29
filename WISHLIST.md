# Wish List & Feature Requests

This file tracks feature ideas, planned improvements, and requested features for the Athenaeum library app. You can ask the AI agent to append items here, mark them as complete, or implement them directly.

## Planned Features / Ideas
- [ ] Add richer sharing modes (edit vs. view-only access).
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
- [ ] Normalize categories into a standard taxonomy.
- [x] Once we have normalized categories, add some visualizations to the home page (e.g., a pie chart).

## Completed
- [x] Configure PWA installation
- [x] Create custom library-themed SVG favicon
