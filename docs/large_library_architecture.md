# Large Library Architecture & Scalability Design

This document outlines the architectural changes required to support large libraries (1,500+ books) gracefully. The primary focuses are mitigating API rate limits during bulk enrichments, preventing UI bottlenecks during client-side rendering, and improving overall system resilience.

## 1. Bulk Metadata Enrichment Architecture

Currently, bulk enrichment processes fire off many requests concurrently or sequentially without intelligent pacing, leading to HTTP 429 (Too Many Requests) errors from backend APIs like Google Books. We must move to a robust, provider-aware queuing and rate-limiting system.

### A. Provider-Specific Rate Limiting Strategies

Each backend provider has different throughput limits and requires a tailored approach.

#### Google Books API (Basic Info, Synopses, Covers)
- **Constraint:** Relatively low request limits (e.g., 100 requests per minute per IP, and daily quotas).
- **Strategy:** 
  - **Token Bucket / Pacing Limiter:** Enforce a strict max concurrency (e.g., 2-3 concurrent requests) and a fixed delay between requests.
  - **Exponential Backoff with Jitter:** On encountering a 429, pause processing for a substantial backoff window (e.g., 30s, 60s) before retrying.
  - **Batching Constraint:** Google Books does not routinely support bulk-fetching by ISBN in a single HTTP request natively, so requests must be serialized securely.

#### Gemini API (AI Generated Metadata, Summaries, Synopses)
- **Constraint:** High RPM (Requests Per Minute) but potential RPS (Requests Per Second) spikes and strict quota limits based on tier.
- **Strategy:**
  - **Concurrency Control:** Limit to ~10-15 concurrent requests depending on API tier, smoothing bursts instead of firing instantaneously.
  - **Retry Logic:** Handle transient 503 and 429 errors from Google GenAI with standard exponential backoff.
  - **Model Fallbacks:** Optionally fallback to faster/lighter models (e.g., `gemini-3.0-flash`) for bulk operations if `gemini-3.0-pro` hits rate limits.

#### Embedding API (Semantic Search & Related Books)
- **Constraint:** Similar to Gemini limits, usually bound by request per minute or token limits. 
- **Strategy:**
  - **Batch Embeddings:** Modern embedding APIs often allow batching multiple texts into a single request (e.g., passing an array of strings).
  - **Chunking:** Chunk the 1,500 library items into batches of 50-100 and process these chunks sequentially.

### B. Queue & Job Management
- **Background Processing / TRPC:** Move bulk processing logic entirely out of the client's React hooks. The client should spawn an asynchronous job via TRPC.
- **Job Yielding:** The server should process jobs asynchronously and track status in Firestore (or a similar persistence layer). In Google Cloud Run (a stateless container), long-running bulk tasks might time out. 
- **Chunked Client Execution (Alternative for Stateless Contexts):** If we must run in stateless containers without a dedicated task queue (like Cloud Tasks or Redis), the client can act as the orchestrator: 
  - Fetch the list of 1,500 books needing enrichment.
  - Process them in strictly paced chunks of `N`.
  - Pause and auto-resume, saving state between chunks.

## 2. Client-Side Rendering Bottlenecks & Solutions

Rendering 1,500+ DOM elements (cards, table rows, cover images) simultaneously will heavily degrade the React rendering thread and crash mobile browsers.

### A. Virtualization / Windowing (Existing Implementation)
- **Tables & Lists:** The collections view currently uses `TableVirtuoso` from `react-virtuoso` for virtualized table rendering. This is excellent and already prevents standard `.map()` DOM explosion for the table view.
- **Grids:** The "Shelf" cover view currently uses `VirtuosoGrid` from `react-virtuoso` for grid virtualization.
- **Action Item:** Ensure that any *new* views (e.g., timeline, duplicate matching grids) also utilize this existing `react-virtuoso` setup. Validate that `VirtuosoGrid` is properly configured to handle dynamic heights if cover images vary, as dynamic grid virtualization can be a performance bottleneck if not tuned correctly.

### B. Image Optimization & Lazy Loading
- **Lazy Loading Covers:** 1,500 cover image requests happening simultaneously will exhaust browser network sockets (typically capped at 6 per domain).
- Use `loading="lazy"` native attributes or `IntersectionObservers` to only fetch cover images when they enter the viewport.
- **Thumbnail vs. High-Res:** Ensure we are rendering small thumbnail URLs in grid/list views rather than full resolution images. 

### C. State Management & Offline Persistence
- **The Limits of Local Caching:** We use Firestore's offline persistence, meaning subsequent loads are fetched from the local IndexedDB cache instead of the network. While this eliminates **read costs** and **network latency**, it *does not* eliminate Javascript memory and CPU constraints. 
- **Snapshot Thrashing (The Real Bottleneck):** If we load all 1,500 books into a single `onSnapshot` listener without pagination, every time a bulk enrichment updates a single book, Firestore pushes a brand-new array of 1,500 books to React. During a bulk enrichment of 500 books, this triggers 500 massive array re-evaluations, instantly freezing the UI thread and thrashing the garbage collector.
- **Pagination / Infinite Scroll vs. Memory:** For ~1,500 books, we can *potentially* survive loading everything into memory *if* React virtualization and `useMemo` are perfectly tuned. However, beyond 3,000+ books, extracting that much data from IndexedDB into JS memory upfront hangs the browser. Adopting cursor pagination (`startAfter`) natively protects the app from memory crashes regardless of local caching.
- **Memoization:** Extensively use `useMemo` and `useCallback` on heavy data structures (like computed categories, author groupings, or search indexes) to avoid freezing the UI on re-renders, especially if we decide to maintain a completely unpaginated local layout.

## 3. Database and Read/Write Optimization

Bulk updates cause large volumes of Firestore writes.

### A. Firestore Write Batching
- **Batched Writes:** Firestore allows up to 500 operations in a single batch. Bulk enrichment processes MUST use batched writes to commit metadata updates.
- **Cost Minimization:** Consolidating updates reduces write charges and overhead.

### B. Firestore Query Indexes
- As the library grows, queries for "Needs Enrichment" or custom sorts (e.g., sort by author, publish date) will fail without composite indexes. Ensure all heavily used sorts / filters have appropriate Firestore indexes defined.

## 4. Summary of Action Items

1. **Implement `p-limit` or Token Bucket:** Wrap all external API calls in a concurrency limiter.
2. **Add Global Retry Wrapper:** Implement an `omniFetch` or similar utility with exponential backoff for 429s.
3. **Migrate Views to Virtualized Lists:** Integrate standard virtualization libraries for Book grids and tables.
4. **Implement Firestore Pagination:** Update library fetching to support infinite scrolling.
5. **Batch Firestore Writes:** Update bulk processes to utilize Firestore batches rather than parallel document `.update()` calls.

## Appendix: Concurrency Control - `bottleneck` vs. `p-limit`

To better manage rate limits, we should standardize on robust concurrency primitives instead of manually chunking arrays using custom `while` loops. The two leading choices in the Node ecosystem are `p-limit` and `bottleneck`.

### 1. `p-limit`
**Purpose:** Pure Concurrency Control
`p-limit` restricts the number of promises that can run simultaneously. 

```javascript
import pLimit from 'p-limit';

// Only allow 3 requests to be in flight at any given exact millisecond
const limit = pLimit(3);
await Promise.all(books.map(book => limit(() => fetchMetadata(book))));
```

**Pros:**
- Incredibly lightweight (a few dozen lines of code).
- Simple API.
- Replaces custom `while` loop worker pools perfectly. It ensures there are *always* `N` requests in flight—as soon as one finishes, the next instantly starts, avoiding the "batching starvation" problem where a fast chunk waits for one slow request to finish.

**Cons:**
- **No Time-based Rate Limiting:** `p-limit` only cares about active concurrency, not *velocity*. If you limit to 5 concurrent requests, and each request takes 10ms, you will fire 500 requests per second. This will instantly trigger 429 rate limits on providers like Google Books.

### 2. `bottleneck`
**Purpose:** Advanced Job Scheduling & Rate Limiting
`bottleneck` is a full-featured task queue designed explicitly for interacting with rate-limited APIs.

```javascript
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 3,         // Max 3 requests in flight
  minTime: 333,             // Wait at least 333ms between launching requests
  reservoir: 100,           // Max 100 requests...
  reservoirRefreshAmount: 100,
  reservoirRefreshInterval: 60000 // ...per 1 minute
});

await Promise.all(books.map(book => limiter.schedule(() => fetchMetadata(book))));
```

**Pros:**
- **Time-based Throttling:** `minTime` guarantees a minimum delay between launching requests.
- **Reservoirs (Quotas):** Natively supports "X requests per minute" bucket logic.
- **Clustering:** Can be backed by Redis for multi-instance (Cloud Run) distributed rate limiting.
- **Priority Queues:** Assign higher weights to user-driven requests vs background batch processing.

**Cons:**
- Heavier dependency.
- More complex configuration.
- Abandonware risk (the original `bottleneck` package has not seen major updates recently, though it is stable).

### Tradeoffs against Today's Approach (Custom Worker Pool)
Today, in `useBulkEnrichment.ts` and TRPC, we chunk lists into batches of 20 and use fixed worker loops:
- **Inefficient Pacing vs. Steady Flow:** In our current batch approach, if a batch has 19 fast books and 1 slow book, the worker waits for the slow book to finish before taking the next batch. Both `p-limit` and `bottleneck` solve this by ensuring a continuous stream.
- **Spikey Traffic:** Our current approach sends bursts of requests. `bottleneck` can smooth this using `minTime`.

### Recommendation

**For this application, I strongly recommend `bottleneck`.** 

While `p-limit` is excellent for local, non-network bottlenecks (e.g., controlling CPU-heavy child processes), the core issue we are facing is **HTTP 429 Too Many Requests** from external APIs. 

Google Books and Gemini enforce velocity quotas (Requests Per Minute/Second), not just pure concurrency. Only `bottleneck` allows us to define `minTime` (delay between requests) and `reservoir` (burst limits) which mathematically guarantees we never breach the provider's token bucket algorithm, gracefully queuing and slowing down execution without requiring complex try-catch exponential backoff ping-ponging.

## Appendix B: Audit of Bulk Actions & Migration Plan

As part of migrating to `bottleneck`, we need to systematically replace legacy `Promise.all()` batching and custom `while`-loop workers. Here is the audit of current bulk-y actions and how to migrate them safely:

### 1. Client-Side UI Enrichment (`src/hooks/useBulkEnrichment.ts`)
*   **Current State:** The client groups 1,500 books into batches of `50`. It then creates `3` async worker arrays simulating a thread pool. Each worker constantly calls `queue.shift()` to get the next batch and posts it to the TRPC server.
*   **Risk:** If the server resolves a batch quickly, the client immediately hits the server again. It only limits "in-flight batches", not overall throughput.
*   **Migration Plan:** 
    *   **Remove Batching:** Stop manually slicing arrays by 50. 
    *   **Implement Bottleneck:** Create a singleton `Bottleneck` instance on the client. 
    *   **Schedule Jobs:** Map the 1,500 books to `limiter.schedule(() => processSingleBook(book))`. 
    *   The `Bottleneck` instance will natively handle sending them gracefully based on a predefined `minTime` limit.

### 2. Server-side Rate Throttling (`src/lib/utils.ts` -> `throttledMapWithRetry`)
*   **Current State:** A highly-utilized global helper that takes an array and a concurrency limit, creating a custom `while`-loop worker pool, similar to the client setup, but running on the server. Used by `CoverImageMetadataProvider`, `AuthorBioMetadataProvider`, and `SynopsisMetadataProvider`.
*   **Risk:** Like the client, it is vulnerable to provider rate limits. An array of 100 fast-resolving promises with `concurrency=5` will still evaluate in <100ms, triggering 429 errors from Google Books.
*   **Migration Plan (Direct Sweeping Replace):**
    *   **Delete the primitive:** Completely remove `throttledMapWithRetry` from `src/lib/utils.ts`.
    *   **Create Global Singletons:** Define API-specific `Bottleneck` instances in a central file (e.g., `src/services/server/limiters.ts`):
        ```javascript
        export const googleBooksLimiter = new Bottleneck({ 
            maxConcurrent: 3, 
            minTime: 200, // 5 requests/sec maximum
            // Add retry logic natively
        });
        ```
    *   **Refactor Providers:** Update `CoverImageMetadataProvider`, `AuthorBioMetadataProvider`, and `SynopsisMetadataProvider` to import this global limiter and directly schedule tasks, dropping array chunking entirely.
        ```javascript
        import { googleBooksLimiter } from '../limiters';
        
        async bulkFetch(books) {
          // Simply map the array through the global limiter. 
          // The limiter guarantees API safety across the entire server.
          const results = await Promise.all(
            books.map(book => googleBooksLimiter.schedule(() => fetchCover(book)))
          );
          // ...
        }
        ```
    *   **The Result:** By sweeping through and updating all call sites, we completely remove the mental overhead of custom "batch sizes" and "worker counts" from our business logic, trusting the global singleton to handle API velocity perfectly.

### 3. Native Gemini Batch Processing (`src/services/server/metadata/providers/GeoMetadataProvider.ts` & others)
*   **Current State:** The Gemini API supports native structured batching (e.g. "Extract coordinates for these 50 books in one JSON payload"). This is used in `GeoMetadataProvider`, `GenreMetadataProvider`, etc., to save tokens and time. 
*   **Risk:** If multiple users trigger batch enrichments simultaneously, the TRPC server might fire multiple massive prompts against the Gemini endpoint instantaneously.
*   **Migration Plan:** 
    *   Do NOT map each book individually to Gemini (that wastes tokens and context). 
    *   Keep the array chunking for Gemini prompts.
    *   However, we should configure a globally shared "Gemini `Bottleneck` Limiter" on the server.
    *   Wrap the final `await model.generateContent()` calls in `geminiLimiter.schedule(...)`. This guarantees that across the entire server, regardless of how many users trigger batch jobs, the outbound requests to Google's GenAI API never exceed the exact quota limits.

### 5. Why We Should Use `bottleneck` on *Both* Client and Server (Full Replacement)

We absolutely *should* replace all handwritten primitives (chunking loops, array manual slices, nested `while` loops) with `bottleneck` across **both the client and the server**.

Handwritten loops are brittle and fail to respect *velocity* (requests over time), only limiting *concurrency* (active requests). Using `bottleneck` symmetrically provides a robust, decoupled queuing system.

**If we did this:**
- **Client `bottleneck`** would act as an **Admission Queue**. It would take a batch of 1,500 books and slowly trickle them to the TRPC server using `minTime` to prevent overloading the network interface, avoiding UI freezing, and chunking payload sizes smoothly. 
- **Server `bottleneck`** would act as the **Global Processing Queue**. It enforces strict API compliance. It would receive the trickled tasks from the client and enforce the global API token limits (e.g., Google Books max requests per minute) across all active users.

Here is how their queues and throttling interact, modeled using queueing theory.

---

## Appendix C: System Interaction & Queueing Theory Model

To model the interaction between the Client Bottleneck and the Server Bottleneck, we can use the concepts of **Queuing Networks** and the **Token Bucket Algorithm**.

### 1. The Model Hierarchy (Tandem Queues)

Our system becomes a tandem queue system: **Node 1 (Browser)** → **Node 2 (Node.js Server)** → **Node 3 (Google API/Gemini)**.

1.  **Client-Side Node (The Ingress Pacer - `M/D/c` type model)**
    *   **Arrival Rate ($\lambda_{client}$):** The user clicks "Enrich All". 1,500 jobs instantly enter the client queue. 
    *   **Service Rate ($\mu_{client}$):** Controlled by `bottleneck`. For example, `maxConcurrent: 5`, `minTime: 50`.
    *   **Purpose:** To prevent "Buffer Bloat" on the TRPC server. Instead of sending 1,500 payloads instantly (which would consume massive memory on the server holding pending HTTP connections), the client acts as a buffer. It smoothly hands off work to the server at a predictable, manageable pace.

2.  **Server-Side Node (The Global Funnel - Token Bucket Filter)**
    *   **Arrival Rate ($\lambda_{server}$):** The sum of all $\mu_{client}$ outputs from all active users. For instance, if 3 users are enriching, $\lambda_{server} = 3 \times \mu_{client}$.
    *   **Service Rate ($\mu_{server}$):** Strictly defined by the API provider's limits. We configure a server `bottleneck` with a Reservoir (Token Bucket) mimicking the provider. For Google Books, this is `reservoir: 100`, `reservoirRefreshInterval: 60000` (100 requests per minute).
    *   **Purpose:** Maximum Throughput without Penalty. The server's job is solely to absorb the steady stream from the clients and emit requests to Google/Gemini exactly at the maximum safe speed limit.

### 2. Interaction & Backpressure

How do these queues interact? What happens if the server queues up too much?

**Scenario: System Under Heavy Load**
Assume the Client is emitting 10 requests per second ($\mu_{client} = 10$). The Server is only allowed to send 2 requests per second to Google Books ($\mu_{server} = 2$). 

*   Since $\lambda_{server} > \mu_{server}$, the Server's `bottleneck` queue length will grow infinitely, eventually causing memory exhaustion or HTTP timeout limits to drop the TRPC request.
*   **The Fix: Backpressure via Await.** Because `bottleneck` integrates natively with Javascript Promises, we achieve implicit backpressure.
    *   The Client sends a TRPC request. The TRPC router calls `limiter.schedule()`.
    *   The Server's `limiter` pauses the Promise because its queue is saturated.
    *   Because the Client's Promise is now pending (awaiting the server), the Client's `bottleneck` *also* pauses its queue because it hit its `maxConcurrent` limit of in-flight promises!

### 3. Design Diagram: The Perfect Flow

1.  **UI Thread:** `useBulkEnrichment` loops over 1,500 books.
    ```javascript
    // Client Bottleneck: Focuses on Concurrency, preventing browser lockup
    const clientLimiter = new Bottleneck({ maxConcurrent: 10 });
    const promises = books.map(b => clientLimiter.schedule(() => trpc.enrich.mutate(b)));
    ```
2.  **Network Layer:** At most 10 active HTTP connections exist per browser.
3.  **TRPC Server:** Receives the mutation. 
    ```javascript
    // Server Bottleneck: Focuses on Velocity/Quotas, preventing 429s globally
    const googleBooksLimiter = new Bottleneck({ 
        minTime: 200, // Max 5 per second
        reservoir: 100, reservoirRefreshInterval: 60 * 1000 // Max 100 per minute
    });
    // The TRPC route simply pushes the job into the global funnel
    return googleBooksLimiter.schedule(() => fetchGoogleBooks(input.isbn));
    ```

### 4. Why This is Superior to Hand-Written Primitives

1.  **Decoupling:** The client no longer needs to know *what* the Google bounds are. It just knows it should pace itself to keep the UI smooth. The server no longer needs complex array-chunking loops.
2.  **Little's Law ($L = \lambda W$):** By defining `minTime` and `maxConcurrent` precisely, we can use Little's Law to calculate exact worst-case queue lengths and wait times, rather than hoping arbitrary `setTimeout` delays in `while` loops happen to evade 429 errors.
3.  **No Dead Space:** Handwritten nested loops often cause pipeline bubbles (idle time while waiting for a single slow request to let a new batch process). `Bottleneck` is fully dynamic: the exact millisecond a request resolves, a new token is generated, and top-priority items are immediately fired, maintaining 100% optimal API utilization.
