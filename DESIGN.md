# Design Document: Bibliophile Hub (V3.0)

## Executive Summary
Bibliophile Hub is a high-performance library management and semantic discovery platform. It leverages a hybrid cloud architecture (Express + Vite + Firebase) and state-of-the-art Generative AI (Google Gemini) to transform a flat list of books into an interactive, AI-enriched knowledge graph. The system excels at structured data extraction from unstructured sources (images, CSVs) and provides novel spatial navigation through thematic book clustering.

---

## 1. System Architecture

The platform follows a **Full-Stack SPA** architecture with a specialized backend service for long-running jobs and administrative operations.

### 1.1 Hybrid Computation Model
- **Frontend (React 19 + Vite)**: Handles the immersive UI, real-time data synchronization via Firestore, and heavy non-blocking compute (UMAP projection) using Web Workers.
- **Backend (Express + Firebase Admin SDK)**: Provides a stable environment for atomic batch operations, such as library-wide deduplication and the "Background Resync" engine which prevents client-side timeouts during large-scale metadata enrichment.
- **AI Orchestration (Google GenAI SDK)**: A multi-model pipeline utilizing `Gemini 3.1 Pro` for multimodal analysis and `Gemini Flash` for high-throughput metadata mapping.

### 1.2 Data Infrastructure: The Split-Collection Pattern
To optimize for **Total Cost of Ownership (TCO)** and **Time to First Paint (TTFP)**, the system implements a split-collection strategy for books.

| Collection | Role | Data Content |
| :--- | :--- | :--- |
| `books` | **Primary Index** | Lightweight metadata (Title, Author, ISBN) for high-speed list rendering. |
| `bookDetails`| **Metadata Vault**| High-payload fields (Synopsis, Embeddings, Multi-paragraph bios). |

**Architectural Insight:** By separating the 768-dimensional embedding vectors (approx. 6KB per book) into `bookDetails`, we reduce the egress overhead of the primary `libraryView` by ~95%, enabling smooth 60FPS scrolling with thousands of entries.

---

## 2. Core Service Implementation

### 2.1 Resilient Ingestion: Tiered Metadata Pipeline
The internal `bookApi` service implements a "Fall-Back-Forward" strategy to maximize successful ingestion even when specific APIs are down or data is missing.

```typescript
// Architecture: Tiered Metadata Resolution
export async function searchBookByIsbn(isbn: string): Promise<BookDetails | null> {
  // Tier 1: Google Books API (Rich metadata, High-Res covers)
  const gBooks = await fetchGoogleBooks(isbn);
  if (gBooks) return mapToInternalSchema(gBooks);

  // Tier 2: OpenLibrary API (Open-source fallback)
  const olBooks = await fetchOpenLibrary(isbn);
  if (olBooks) return mapToInternalSchema(olBooks);

  // Tier 3 (Optional UI Trigger): Gemini Vision
  // Used if current scans/photos fail to provide valid ISBNs.
}
```

### 2.2 Semantic Constellation Map (UMAP Projection)
The high-dimensional thematic relationship is projected into 2D space using **UMAP (Uniform Manifold Approximation and Projection)**.

1.  **Embedding Generation**: Synopses are converted into vectors using `gemini-embedding-2-preview`.
2.  **Worker-Based Projection**: Since UMAP is computationally intensive, the calculation is offloaded to a `Web Worker`.
3.  **Clustering**: K-Means identifies thematic groups.
4.  **AI Labeling**: `Gemini Flash` analyzes the book titles within a cluster to generate a poetic name (e.g., *"Nebula of Stoic Philosophy"*).

```typescript
// Web Worker Implementation (src/workers/umapWorker.ts)
self.onmessage = async (e: MessageEvent) => {
  const { embeddings, config } = e.data;
  const umap = new UMAP(config);
  const nRows = embeddings.length;
  const nCols = embeddings[0].length;

  // Flattened access for performance
  const data = new Float32Array(nRows * nCols);
  embeddings.forEach((emb, i) => data.set(emb, i * nCols));

  const projection = umap.fit(data);
  self.postMessage({ projection });
};
```

---

## 3. Background Processing & Jobs

The Express backend manages the **Library Resync Service**. This service iterates through a library's entries and performs "data healing":
- Generating missing covers via OpenLibrary.
- Extracting missing genres or series info using `Gemini Flash`.
- Pruning orphan `bookDetails` documents.

The progress is tracked via a `Job` entity in Firestore, allowing the frontend to show a real-time progress bar:
```typescript
// Background Job State
interface Job {
  status: 'running' | 'completed' | 'failed';
  progress: number;
  total: number;
  updatedAt: Timestamp;
}
```

---

## 4. Security & Access Control

The system adheres to a **Zero-Trust Relational Model** enforced via Firestore Security Rules.

- **Library Ownership**: Every document has an `ownerId`.
- **Shared Access**: Collaboration is enabled via a `sharedWith` array (list of guest emails). Access is granted only if the authenticated user matches either the owner or a guest.
- **Relational Integrity**: `isValidBook()` rules verify that a book document's parent library actually exists and is owned/accessible by the requester.

---

## 5. Design Decisions & Tradeoffs

### 5.1 Choice of Gemini over OpenAI
The decision to use Gemini was driven by its **multimodal native architecture**. Extracting lists of books from a single photo of a shelf requires a massive context window and strong spatial reasoning (Vision), where `Gemini 3.1 Pro` outperformed competitors in terms of both extraction accuracy and latency for high-resolution images.

### 5.2 Local Persistence vs Live Fetch
The app uses **Firestore Persistence**. This "Offline-First" decision ensures that librarians can browse their collections in areas of poor connectivity (e.g., basement libraries) and reduces the perceived latency of the application to near-zero for repeat visits.

### 5.3 Selection of Recharts
For the Constellation Map, `recharts` was selected over raw `d3` to maintain high developer velocity while providing a declarative, React-friendly way to manage the SVG layer. Custom voronoi-based hit detection was implemented on top of the chart to handle high-density point interaction.

---

## 6. Future Roadmap (The "Librarian's Vision")
- **Audio-Visual Ingestion**: Real-time video stream shelf scanning.
- **Public Shared Links**: Read-only public galleries for collectors to showcase their library.
- **Physical/Digital Sync**: Integration with Kindle/Calibre metadata exports.
