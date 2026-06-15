# Design Document: Reusable Bulk Book Enrichment System

This document outlines the architectural plan for refactoring and extracting the bulk book enrichment patterns used by the **World Map** (geocoding metadata) and **Timeline** (temporal historical metadata) modules. By unifying these implementations, we eliminate code duplication, prevent future divergence, and establish a high-performance, robust, and reusable core library.

---

## 1. Context & Present Divergence

Currently, both the World Map and Timeline pages execute bulk batch enrichment, scanning for books lacking metadata, dividing them into chunks, and making parallel API requests to Gemini before persisting results back to Firestore. However, the details of their batching and parallel execution have diverged:

| Criteria | World Map (Canonical Reference) | Timeline View |
| :--- | :--- | :--- |
| **Batch Size**| 10 books per request | 20 books per request |
| **API Endpoint**| `/api/books/${libraryId}/batch-enrich-geo` | `/api/books/${libraryId}/batch-enrich-temporal` |
| **Metadata Target**| `geoMetadata` | `temporalMetadata` |
| **Concurrency Model**| **Continuous Queue Worker Pool** (up to 3 parallel workers, shift from queue dynamically) | **Block-based Concurrency Chunks** (batches of 4 parallel promises via sequential `Promise.all` steps) |
| **In-Flight Metrics**| Simple boolean `isBackfilling` indicator | Active batch index / precise `inFlightCount` count |

### Why World Map is Canonical

The World Map's **Worker Pool model** is highly robust and performs significantly better than Timeline's block-based chunking method:
* **Continuous Resource Utilization**: While block chunks (Timeline) wait for the slowest promise in a block of 4 to finish before starting any new requests, the Worker Pool (World Map) starts processing the next queued batch the moment any single worker becomes idle.
* **Safer Firestore Batching**: It maintains isolation in separate batched Firestore writes rather than forcing heavy, coupled promise steps.

---

## 2. Proposed Architecture: `useBulkEnrichment` Hook

We propose introducing a reusable React hook under `/src/hooks/useBulkEnrichment.ts` that encapsulates this canonical parallel-queued worker pool pattern.

### 2.1 Hook Signature Design

```typescript
import { Book } from '../types';

export interface BulkEnrichmentConfig<TResponse, TMetadata> {
  libraryId: string | undefined;
  apiEndpoint: string;
  metadataField: keyof Book; // e.g., 'geoMetadata' | 'temporalMetadata'
  batchSize?: number;        // Default: 10
  concurrencyLimit?: number; // Default: 3
  
  // Custom filter to identify which books need enrichment
  filterPredicate: (book: Book) => boolean;
  
  // Mapping the raw response of a single batch item to the Firestore structure
  mapMetadata: (item: TResponse) => TMetadata;

  // Event telemetry and feedback hooks
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}

export interface BulkEnrichmentState {
  isBackfilling: boolean;
  progress: {
    completed: number;
    total: number;
  };
  inFlightCount: number;
  triggerBackfill: () => Promise<void>;
  resetBackfillTracker: () => void;
}
```

### 2.2 Response Mapping & Prompt Architecture

A key strength of this design is **separation of concerns** between LLM prompting and background queue management:

* **Where do custom prompts plug in?**
  Custom prompts plug in **completely server-side** inside the backend service controllers (e.g. `server.ts` invoking `geminiService`). 
  The client and the general `useBulkEnrichment` hook remain totally agnostic of system prompts, instruction templates, and temperature settings. The client simply transmits the payload of raw book details (e.g. `{ id, title, author, synopsis }`) to the selected `apiEndpoint`. The server parses, executes structured schema calls targeting Gemini, maps them to structured output, and returns the response.
  
* **How are they kept extensible?**
  If a new page/view needs custom instructions or parameters, we create a new server-side endpoint with its corresponding mapping function and pass its address as the `apiEndpoint` config option to the hook.

### 2.3 Database Writes Architecture

* **Where do the Firestore writes happen?**
  Firestore writes happen **client-side** inside the `useBulkEnrichment` hook logic. 
* **Why client-side batching?**
  1. **Instant UI Hydration**: By performing writes client-side using the Firebase JS SDK `writeBatch(db)` mechanism, Firestore's offline persistence layer instantly applies the updates to the local cache. The map and timeline views of the active user will render the parsed geometries or events immediately without waiting for standard reactive snapshot replication loops.
  2. **Security & Auditing Model**: This approach perfectly respects Firestore Security Rules. Since requests are verified under the active user's authorization scope, the client-side SDK guarantees the user is authorized to modify only their own library sub-documents. The Node server simply acts as a secure, stateless execution utility.

### 2.4 Concurrency Pipeline Flowchart

Below is the dynamic continuous worker execution loop that will live in the extracted utility:

```
                  [ Raw Library Books ]
                            │ Filter (predicate check & attempted list prevention)
                            ▼
                     [ Backfill Queue ]
                            │ Split into Batches (e.g., Size = 10)
                            ▼
                   [ Pending Batch Queue ]
                            │
               ┌────────────┴────────────┐
               ▼                         ▼
         [ Worker 1 ]              [ Worker 2 ]               ... up to limit
               │                         │
               ├─► Queue Shift Next      ├─► Queue Shift Next
               ├─► Fetch API Proxy       ├─► Fetch API Proxy
               ├─► Write Firestore Batch ├─► Write Firestore Batch
               └────────────┬────────────┘
                            ▼
                  [ Progress Updates ]
```

---

## 3. Core Implementation Mechanics

The extracted library will coordinate the following tasks:

1. **Safety and Quota Throttling**: Automatically track attempted book IDs in local state during a trigger session to safeguard against cascading retry loops when specific books consistently trigger LLM failures.
2. **Controlled Concurrency Pool**:
   ```typescript
   const queue = [...batches];
   const workers = Array.from({ length: Math.min(concurrencyLimit, queue.length) }, async () => {
     while (queue.length > 0) {
       const nextBatch = queue.shift();
       if (nextBatch) {
         await processBatch(nextBatch);
       }
     }
   });
   await Promise.all(workers);
   ```
3. **Firestore Injection**: Consolidate database write transaction rules using direct `writeBatch` commits to guarantee the client's cache is modified in transactional units.

---

## 4. Planned Integration & Adoption Strategy

Once the hook library is finalized:
1. **World Map**: Will integrate the hook by setting `apiEndpoint: '/api/books/${libraryId}/batch-enrich-geo'`, `metadataField: 'geoMetadata'`, and a filter predicate of `b => !b.geoMetadata`.
2. **Timeline View**: Will substitute its custom chunking mechanism with `useBulkEnrichment`, passing `apiEndpoint: '/api/books/${libraryId}/batch-enrich-temporal'`, `metadataField: 'temporalMetadata'`, and `batchSize: 20` (as required by Timeline spec), while inheriting the vastly superior queue-worker continuous execution pattern.
3. **Future Extensibility**: Any new visualizers requiring bulk semantic analysis (e.g. genre tags, mood matrices, content advisories) can adopt the hook with single-line configuration changes.
