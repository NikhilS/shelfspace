# Architecture & Codebase Review: The Staff Engineer Critique & Modernization Blueprint

**Author:** Staff Full-Stack Engineer  
**Date:** September 2026  
**Status:** Proposal / Strategic Roadmap  
**Target:** Monorepo (`client`, `server`, `trpc`, `firestore`)

---

## Executive Summary

The application demonstrates strong feature richness, thoughtful domain modeling (bibliographic taxonomy, spatial/temporal mapping, barcode recognition), and client-side optimization efforts (DOM virtualization, local caching). 

However, the codebase currently suffers from **architectural layering fatigue**. Multiple structural paradigms were added over time without deprecating earlier solutions:
1. **Split-brain data access**: Direct client Firestore SDK, tRPC via `firebase-admin`, and raw Express REST routes running concurrently.
2. **TanStack React Query misused**: Used with `skipToken` as a pseudo-global key-value store rather than an asynchronous query orchestrator.
3. **Hot-path telemetry overhead**: Synchronous JSON stringification and `Blob` allocations measuring payload bytes on every cache hit.
4. **Unbounded Firestore collections**: Listening to full library snapshots without pagination limits.
5. **Stateful in-memory background jobs**: Vulnerable to multi-container Cloud Run scaling and cold-start wipes.

This document details the critique, contrasts **AI Studio Dev Mode** with **Production Cloud Run**, answers the **External Client Secret API** question, and provides an actionable modernization blueprint.

---

## Part 1: The Core Critiques ("What We Hate")

### 1. The Split-Brain Data Access Pattern
The application currently maintains three separate data mutation and retrieval channels:
- **Direct Client Firestore SDK** (`useLibraryData`, `ClientBulkWriter`, `setDoc`, `updateDoc`): Talks directly to Firestore from the browser using client user credentials.
- **tRPC Routers** (`/trpc/*`): Express middleware using `firebase-admin` service credentials to execute procedures.
- **Raw Express REST** (`/api/v1/*`): Custom Express endpoints in `server.ts` manually parsing query parameters, handling JSON formatting, and performing ad-hoc error mapping.

**The Problem:**
- **Double Authorization Surface**: Security rules must be maintained twice—once in `firestore.rules` for browser clients and again in TypeScript services (`LibraryService`, `EnrichmentService`) for backend calls. Discrepancies create privilege escalation risks.
- **Inconsistent Mutation Guarantees**: Adding a book via client `ClientBulkWriter` has completely different latency, retry, and optimistic update behavior than adding via tRPC or REST.

---

### 2. React Query Abused as a Pseudo-Global Cache
In `useLibraryData.ts`:
```typescript
const libraryQuery = useQuery<Library | null>({
  queryKey: ['library', libraryId],
  queryFn: skipToken, // queryFn is never called!
});
```
TanStack React Query is imported, configured, and wrapped around the root component, but its core strengths—automatic deduplication, query execution, window focus refetching, and error retries—are bypassed using `skipToken`. 

Instead, the hook manually reads IndexedDB (`getDocsFromCache`), subscribes to real-time snapshots (`onSnapshot`), manually calls `queryClient.setQueryData`, and synchronizes four independent `useState` flags (`isLoading`, `isBooksLoading`, `isSyncing`, `isCachedFirstPaint`).

**The Problem:**
- The application incurs the bundle size and abstraction overhead of React Query while manually implementing a fragile state-mirroring layer on top.
- Dual state holding (local `useState` + React Query cache) introduces state tearing and avoidable component re-renders.

---

### 3. Telemetry Overhead on the Critical Render Path
In `src/lib/telemetry.ts`:
```typescript
export function calculatePayloadBytes(data: unknown): number {
  if (data === undefined || data === null) return 0;
  try {
    if (typeof data === 'string') return new Blob([data]).size;
    const json = JSON.stringify(data);
    return new Blob([json]).size;
  } catch {
    return 0;
  }
}
```
This is called inside `useLibraryData` during cache hydration and snapshot processing.

**The Problem:**
- Calling `JSON.stringify(cachedBooks)` followed by allocating a `new Blob([json])` on arrays of hundreds or thousands of books blocks the main JavaScript thread during initial page load and causes heavy garbage collection churn.
- Telemetry designed to monitor performance actively degrades user-perceived performance.

---

### 4. Unbounded Real-Time Collection Subscriptions
In `useLibraryData.ts`:
```typescript
const booksRef = collection(db, 'libraries', libraryId, 'books');
const q = query(booksRef, orderBy('addedAt', 'desc'));
const unsubscribe = onSnapshot(q, docSnap => { ... });
```
The client subscribes to real-time snapshot events for the **entire** book collection of a library.

**The Problem:**
- **Cost & Network Scaling**: For a library with 2,000 books, opening the app executes 2,000 Firestore reads immediately and holds all documents in browser memory.
- **Snapshot Delta Churn**: Modifying a single book's reading status triggers a collection-level snapshot event that re-maps the entire array (`cachedSnapshot.docs.map(mapDocToBook)`).

---

### 5. Fragmented State Architecture
The codebase simultaneously leverages four distinct state paradigms:
- **Zustand** (`appStore.ts`, `uiStore.ts`)
- **React Context** (`authStore.tsx`, `debugStore.tsx`, `useLibraryAccess.tsx`)
- **TanStack React Query Cache** (`queryClient`)
- **Component-level useState/useRef plumbing**

**The Problem:**
- Tracing data flow requires jumping through multiple disparate mechanisms.
- Context providers high in the tree trigger widespread component tree re-renders on minor updates.

---

### 6. Stateful Background Jobs in a Stateless Cloud Server
In `enrichmentService.ts`, rate limiters, batch queues, and cancellation signals live in Node process memory:
```typescript
// In-memory queues & cancellation tokens
```

**The Problem:**
- In production, serverless containers (like Cloud Run) scale dynamically (0 to N instances) and restart on deployment or idle timeouts.
- In-flight memory queues vanish on container recycling, and cancellation signals sent to Container A do not reach jobs running on Container B.

---

## Part 2: AI Studio Dev Mode vs. Production Cloud Run

Understanding the runtime differences explains why patterns that appear to work in AI Studio can fail when deployed:

| Dimension | AI Studio Dev Mode | Production (Cloud Run / Standalone) |
| :--- | :--- | :--- |
| **Execution Command** | `tsx server.ts` (Dynamic on-the-fly TS compilation) | `node dist/server.cjs` (Pre-bundled via `esbuild` + `vite build`) |
| **Vite Mode** | Vite runs as Express middleware (`vite.middlewares`), compiling on request | Static file delivery from `dist/` with fallback routing to `index.html` |
| **Instance Count** | **Strictly 1 container** bound to the active user session | **0 to N instances**, scaling up or down based on incoming traffic |
| **Lifecycle** | Long-running container process | **Stateless & ephemeral**: containers start, handle requests, and scale down |
| **Context** | Embedded inside a sandboxed **`<iframe>`** | First-party top-level browser window (or custom domain) |
| **Auth Mechanics** | Requires popup auth (`signInWithPopup`) due to iframe sandbox constraints | Can support both popup and redirect auth; standard cookie/header handling |
| **Job Durability** | In-memory queues stay alive across calls within the session | In-memory queues are lost across container instances or cold restarts |

---

## Part 3: The External API Question: Does "Sunsetting Raw REST" Break Client Secret Keys?

### Short Answer: **NO.**

Sunsetting "Raw Express REST" does **not** mean deprecating the programmatic API for external clients or removing `lib_live_...` API key authentication. It means **refactoring where the handlers live and how they are routed**.

### Context: The Two Types of API Consumers
1. **Internal UI Client (The Web App)**:
   - Needs end-to-end TypeScript types, zero-boilerplate client calls, and automatic Zod validation.
   - Best served by **tRPC**.
2. **External Programmatic Clients (Scripts, cURL, third-party integrations)**:
   - Do not use the tRPC TypeScript client.
   - Require standard HTTP JSON: `GET /api/v1/libraries`, `x-api-key: lib_live_...`.

### The Problem With Current `server.ts`
Today, `server.ts` contains 350+ lines of raw Express routing code mixed directly with the server entry point:
- Manual route registration: `app.get('/api/v1/libraries', ...)`
- Manual query param parsing: `req.query['filters[missingMetadata]']`
- Manual status code mapping: `error?.code === 'NOT_FOUND' ? 404 : 500`

### The Recommended Clean Architecture
You maintain the external REST API contract 100%, but eliminate the raw code in `server.ts` using one of two clean patterns:

#### Option A: Extract REST Routes into a Dedicated Router (`src/server/api/v1/`)
Keep `server.ts` as a pure entry point (~40 lines). Move all `/api/v1/*` endpoints to dedicated, modular router files with shared service logic:
```
src/server/
  ├── api/
  │   └── v1/
  │       ├── authMiddleware.ts   <-- (Handles x-api-key AND Bearer JWT)
  │       ├── librariesRouter.ts  <-- (Calls LibraryService)
  │       └── enrichmentRouter.ts <-- (Calls EnrichmentService)
  ├── trpc/
  │   └── routers/                <-- (For UI client)
  └── services/                   <-- (Shared domain logic)
```
- **Outcome**: The external API remains 100% backward-compatible for all external clients and API keys (`lib_live_...`). `server.ts` simply mounts: `app.use('/api/v1', apiV1Router)`.

#### Option B: Unified tRPC OpenAPI Gateway (`trpc-openapi`)
Use `trpc-openapi` or `@trpc/server/adapters/fetch` to automatically generate and serve standard OpenAPI/REST endpoints directly from your tRPC router definitions:
- A single procedure definition powers **both** the tRPC client (`trpc.library.getBooks.useQuery()`) **and** the external REST endpoint (`GET /api/v1/libraries/:id/books`).
- Zero duplicate routing logic.

---

## Part 4: The Modernization Blueprint

### 1. Functional Partitioning: Asymmetric Authority
Establish clear operational boundaries: **The browser owns CRUD & State; the server owns Secrets & Heavy Compute.**

```
+-------------------------------------------------------------------------+
|                                BROWSER                                  |
|                                                                         |
|  [React Views] ---> [Client Firestore SDK] <=========> [Cloud Firestore]
|        |            - Fast IndexedDB cached first-paint       ^
|        |            - Standard CRUD (status, edits, deletes)  |
|        |            - Governed by firestore.rules             |
|        |                                                      |
|        +----------> [tRPC Client]                             |
|                     - Authorization: Bearer <ID_TOKEN>        |
+--------------------------|------------------------------------|---------+
                           |                                    |
                           v                                    |
+---------------------------------------------------------------+---------+
|                           EXPRESS SERVER                                |
|                                                                         |
|  [tRPC Router / REST Gateway] ---> [Auth / API Key Middleware]         |
|        |                                                                |
|        +-----------> [Gemini 2.5/Flash Engine] (Private API Key)        |
|        +-----------> [External Proxies] (ISBN search, geocoding)        |
|        +-----------> [Long-Running Batch Jobs] (Firestore-backed) ------+
+-------------------------------------------------------------------------+
```

1. **Standard CRUD -> Client Firestore SDK**:
   - Marking a book as reading/finished, editing personal tags, deleting books, or adding single entries.
   - Benefits: Instant optimistic updates, offline caching, zero backend latency.
   - Protection: Enforced via `firestore.rules`.
2. **Compute & Secrets -> tRPC & REST Gateway**:
   - Calling Gemini models for structured metadata extraction, embeddings, and recommendations.
   - `GEMINI_API_KEY` remains securely server-side.

---

### 2. Shift Enrichment to "RPC Compute -> Client Persistence"
Instead of having both the server and client write to book documents during manual enrichment:
1. Client calls: `trpc.gemini.enrichBook.mutate({ title, author })`.
2. Server executes Gemini calls and returns the structured metadata payload to the browser.
3. Client applies the payload via `updateDoc()`.

**Benefits:**
- The server remains stateless and requires no write permissions for user-interactive enrichment.
- `firestore.rules` remains the single authority for user document modifications.
- Local UI cache updates immediately.

*(Note: For asynchronous background queues processing hundreds of items when the tab may be closed, the server continues using `firebase-admin`, but writes are backed by a Firestore job queue.)*

---

### 3. Replace In-Memory State with Firestore-Backed Jobs
For multi-book background enrichments, store job status in Firestore under:
`/libraries/{libraryId}/enrichmentJobs/{jobId}`

```typescript
export interface EnrichmentJobRecord {
  id: string;
  libraryId: string;
  requestedBy: string;
  status: 'pending' | 'running' | 'completed' | 'cancelled' | 'failed';
  totalBooks: number;
  processedCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
}
```

**Benefits:**
- **Cloud Run Resilient**: Any scaled container can read the job, process the next batch chunk, and record progress.
- **Real-Time Client Updates**: The UI subscribes via `onSnapshot` to the single job document instead of polling.
- **Reliable Cancellation**: Clicking "Stop Enrichment" updates `status: 'cancelled'` in Firestore. Processing instances check this flag between batch items and halt cleanly.

---

### 4. Remove Synchronous Telemetry from the Render Path
Refactor `src/lib/telemetry.ts` and `useLibraryData.ts`:
- Gate telemetry tracking behind `import.meta.env.DEV` or an opt-in debug toggle.
- Do not synchronously serialize arrays of books via `JSON.stringify` or instantiate `new Blob()`.
- Use shallow estimation or async background Web Workers for payload size diagnostics.

---

### 5. Paginate Large Library Collections
Replace full-collection `onSnapshot` listeners on large libraries:
- Use cursor-based queries with limits (`limit(50)`, `startAfter(lastVisible)`).
- Combine pagination with existing table virtualization (`TableVirtuoso` in `DataTable`).
- Restrict real-time subscriptions to active subsets (e.g., currently reading shelf or active enrichment jobs).

---

## Part 5: Deep Dive: Should We Consolidate Everything into a Unified API Layer (tRPC + OpenAPI Gateway)?

> 📘 **Dedicated In-Depth Specification**: For the full, dedicated investigation covering client caching mechanisms, offline data synchronization, iOS/Android native integration, and comprehensive performance vector comparisons, see:  
> **[`/docs/API_ARCHITECTURE_AND_GATEWAY_DESIGN.md`](./API_ARCHITECTURE_AND_GATEWAY_DESIGN.md)**.

A critical strategic question emerges: **Should we eliminate both the raw Express REST endpoints AND the direct client Firestore SDK, routing 100% of all data operations through a unified tRPC + OpenAPI backend gateway?**

How would a future **native iOS (Swift) or Android (Kotlin)** app fit into this? Would this architecture work, what are the exact trade-offs, and how would authentication and security operate?

---

### 1. How Native iOS & Android Apps Would Communicate with the Backend

In a multi-client world (Web + iOS + Android + Programmatic API), clients have very different capabilities:
- **Web App**: Built in TypeScript/React; can use the native `@trpc/client` and `@trpc/react-query` with full type inference.
- **Native iOS (Swift)** & **Native Android (Kotlin)**:
  - Do **not** have official, production-grade tRPC clients.
  - Native mobile ecosystems revolve entirely around **HTTP/JSON REST APIs** using standard networking libraries:
    - **iOS**: `URLSession` or `Alamofire`, decoding JSON via `Codable`.
    - **Android**: `Retrofit` + `OkHttp`, decoding JSON via `Kotlinx.Serialization` or `Moshi`.
- **Non-UI Programmatic Clients** (cURL, Python scripts, CLI tools): Require pure HTTP REST with `x-api-key: lib_live_...`.

#### The Solution: The "tRPC as Source of Truth + OpenAPI Projection" Pattern
By adding `trpc-openapi` (or an OpenAPI generator) to the tRPC routers, you write your procedures once in TypeScript with Zod schemas:

```typescript
// src/server/trpc/routers/book.ts
export const bookRouter = router({
  listBooks: protectedProcedure
    .meta({ openapi: { method: 'GET', path: '/v1/libraries/{libraryId}/books', tags: ['Books'] } })
    .input(z.object({ libraryId: z.string(), limit: z.number().default(50) }))
    .output(z.object({ books: z.array(BookSchema), nextCursor: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      return bookService.listBooks(ctx.user, input.libraryId, input.limit);
    }),
});
```

From this single source of truth:
1. **The Web App** connects via `@trpc/client`:
   ```typescript
   const { data } = trpc.book.listBooks.useQuery({ libraryId: '123' }); // End-to-end typed!
   ```
2. **The OpenAPI Middleware** (`createOpenApiExpressMiddleware`) automatically exposes:
   ```http
   GET /api/v1/libraries/123/books?limit=50
   Authorization: Bearer <FIREBASE_ID_TOKEN>
   ```
3. **Native iOS & Android** generate pristine, strongly-typed Swift & Kotlin models and API clients directly from the auto-generated `openapi.json` using `openapi-generator-cli`:
   ```swift
   // Native Swift (generated)
   APIClient.BooksAPI.listBooks(libraryId: "123") { response, error in ... }
   ```
   ```kotlin
   // Native Kotlin (generated)
   val books = booksApi.listBooks(libraryId = "123")
   ```
4. **External API Key Callers** use the same endpoint with their key:
   ```http
   GET /api/v1/libraries/123/books
   x-api-key: lib_live_abc123
   ```

---

### 2. Can We Completely Eliminate Direct Client Firestore?

**Yes.** In this consolidated architecture:
- Neither the Web App, nor the iOS App, nor the Android App ever imports the Firestore Client SDK (`firebase/firestore`).
- The database is completely hidden behind the server API Gateway.

```
+------------------------------------------------------------------------------------+
|                                    CLIENTS                                         |
|                                                                                    |
|  [Web App (React)]        [iOS App (Swift)]     [Android App (Kotlin)]   [Scripts] |
|   via @trpc/client       via generated Swift    via generated Retrofit    via cURL |
+---------------------------------------\--------------------------------------------+
                                         \ (HTTP / JSON / Authorization: Bearer or x-api-key)
                                          v
+------------------------------------------------------------------------------------+
|                         UNIFIED API GATEWAY (Node / Express)                       |
|                                                                                    |
|  +-------------------------------------------------------------------------------+ |
|  |                           Unified Auth Middleware                             | |
|  |     - Verifies Firebase JWT (Web, iOS, Android)                               | |
|  |     - OR Verifies Hashed API Key (CLI, External Scripts)                      | |
|  |     - Injects: ctx.user = { uid, email, libraryRole }                         | |
|  +-------------------------------------------------------------------------------+ |
|  |                      tRPC Routers + OpenAPI HTTP Handler                      | |
|  |     - Input validation via Zod                                                | |
|  |     - Output shaping & sanitization via Zod                                   | |
|  +-------------------------------------------------------------------------------+ |
|  |                         Domain Services & Repositories                        | |
|  |     - LibraryService, BookService, EnrichmentService                          | |
|  +-------------------------------------------------------------------------------+ |
|                                          |                                         |
|                 +------------------------+------------------------+                |
|                 v                                                 v                |
|       [Gemini AI / External APIs]                       [Cloud Firestore]          |
|        (Private Keys Server-Side)                 (Accessed ONLY via Admin SDK)    |
+------------------------------------------------------------------------------------+
```

---

### 3. How Authentication & Security Would Work

If you eliminate direct client Firestore, the security model becomes dramatically simpler and far more secure than client-side BaaS:

#### A. The Client Auth Flow
1. **Identity Provider Only**: The client (Web, iOS, Android) uses the Firebase Auth SDK **strictly for identity and credential retrieval** (Google Sign-In, Apple Sign-In, Email link, Passkeys).
2. **Token Acquisition**: After authentication, the client retrieves the Firebase ID Token:
   - Web: `const token = await auth.currentUser?.getIdToken();`
   - iOS: `Auth.auth().currentUser?.getIDToken { token, error in ... }`
   - Android: `FirebaseAuth.getInstance().currentUser?.getIdToken(false)...`
3. **Bearer Token in Headers**: Every request to the gateway passes this token:
   ```http
   Authorization: Bearer <FIREBASE_ID_TOKEN>
   ```

#### B. Unified Server Context & Authorization Pipeline
Inside `src/server/trpc/trpc.ts`:
```typescript
export async function createContext({ req, res }: CreateExpressContextOptions) {
  let user: AuthenticatedUser | null = null;
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  // 1. Check Bearer Token (Web & Mobile UI clients)
  if (authHeader?.startsWith('Bearer ')) {
    const idToken = authHeader.substring(7);
    try {
      const decoded = await adminAuth.verifyIdToken(idToken);
      user = {
        uid: decoded.uid,
        email: decoded.email,
        authType: 'jwt',
      };
    } catch {
      // Invalid/expired token
    }
  }

  // 2. Check API Key (External scripts & programmatic clients)
  if (!user && apiKeyHeader) {
    const verifiedKey = await apiKeyService.validateKey(apiKeyHeader);
    if (verifiedKey) {
      user = {
        uid: verifiedKey.userId,
        authType: 'api_key',
        keyId: verifiedKey.id,
      };
    }
  }

  return { req, res, user };
}
```

#### C. Locking Down Firestore Completely
Because no client directly connects to Firestore, `firestore.rules` is replaced with an impenetrable deny-all rule:
```javascript
// firestore.rules
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false; // Reject 100% of public internet traffic!
    }
  }
}
```
- **Zero Public Surface**: The database cannot be touched directly by DevTools, Postman, or compromised API tokens. 
- **Centralized Authorization**: Authorization logic lives entirely in domain services (`src/services/server/libraryService.ts`). If a user tries to access Library X, the service checks ownership or collaborator access in TypeScript before fetching books.

---

### 4. Detailed Trade-Offs Analysis: Direct Firestore vs. Consolidated API Gateway

Consolidating everything into a unified API gateway is a standard Staff-level architectural choice, but it carries clear trade-offs:

| Dimension | Option 1: Direct Client Firestore (Current BaaS) | Option 2: Consolidated API Gateway (tRPC + OpenAPI) |
| :--- | :--- | :--- |
| **Security Surface** | **High risk**: Requires writing and maintaining complex `firestore.rules` for browser access, plus separate backend auth. | **Very low risk**: Firestore rules set to `allow false`. All checks happen in typed TypeScript services. |
| **Code Duplication** | High: Logic split across client hooks, server controllers, and security rules. | **Zero**: Single router, single Zod schema for both UI and external REST. |
| **Mobile Integration** | Awkward: Mobile must import heavy Firebase SDKs; custom server features (AI enrichment) require custom networking. | **Ideal**: Auto-generates native Swift/Kotlin network layers from standard OpenAPI specs. |
| **Database Portability** | **Locked to Firebase**: Client UI is tightly bound to `onSnapshot`, `doc()`, `collection()`. | **Completely Portable**: Backend can swap Firestore for PostgreSQL / Cloud SQL without changing client code. |
| **Data Shaping & Leaks** | Weak: Firestore sends whole documents; computed fields must be calculated on client. | **Strong**: Zod output schemas strictly strip sensitive fields and compute derived metadata server-side. |
| **Offline Support** | **Built-in & Free**: Firestore SDK has built-in IndexedDB / SQLite offline queueing. | **Manual**: Offline caching must be handled by TanStack Query (`persistQueryClient`), Room (Android), or SwiftData (iOS). |
| **Real-time Sync** | **Instant**: Native WebSockets push snapshot deltas on every document change. | **Polling or SSE**: Standard queries require polling or explicit Server-Sent Events / tRPC subscriptions. |
| **Server Compute Costs** | Zero for CRUD: Clients hit Google's Firestore infrastructure directly. | Container CPU: Cloud Run handles every request, queries DB via Admin SDK, and serializes JSON. |

---

### 5. Staff Recommendation: Should We Do It?

#### **Verdict: YES, Consolidate to a Unified API Gateway.**

For a book curation and library management system (unlike a multiplayer game or collaborative real-time canvas), **instant sub-millisecond document streaming is far less valuable than consistent security, cross-platform mobile readiness, and clean architecture.**

#### Why this is the right move:
1. **The Library Domain Doesn't Need Heavy Sockets**: You read books, search metadata, enrich summaries, and categorize tags. Standard HTTP request/response caching (via TanStack Query on Web, SwiftData/URLSession on iOS, and Retrofit/Room on Android) is faster, cleaner, and uses less battery/bandwidth than holding open persistent Firestore WebSocket listeners.
2. **Mobile Readiness Becomes Instant**: A native Swift or Kotlin app can be spun up in days by running `openapi-generator` against the auto-generated `openapi.json`.
3. **Security is Bulletproof**: One single place to audit access (`LibraryService`), zero client-side database rules to debug, and Firestore locked to `allow false`.
4. **Resolves the Split-Brain Instantly**: Eliminates raw `server.ts` routes, eliminates duplicate client writes, and unifies external API keys with UI sessions under a single Zod pipeline.

---

## Part 6: Action Plan & Implementation Phases

| Phase | Milestone | Priority | Effort |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Server Entrypoint Clean-up**: Extract `/api/v1` routes out of `server.ts` into `src/server/api/v1/`. Preserve full backward compatibility for `x-api-key` and `lib_live_` callers. | High | 1-2 days |
| **Phase 2** | **Hot-Path Optimization**: Remove `calculatePayloadBytes` synchronous `Blob` allocations from `useLibraryData.ts`. Gate debug instrumentation. | High | 0.5 day |
| **Phase 3** | **Durable Background Jobs**: Replace in-memory queue variables in `enrichmentService.ts` with Firestore `/enrichmentJobs/` documents. Enable safe Cloud Run scaling. | Medium | 2-3 days |
| **Phase 4** | **API Gateway Consolidation (tRPC + OpenAPI)**: Mount `trpc-openapi`, route all library and book queries through tRPC, and generate OpenAPI docs. | High | 3-4 days |
| **Phase 5** | **Client SDK Migration & Database Lockdown**: Migrate `useLibraryData` to use `trpc.book.listBooks.useQuery()`, retire direct client Firestore imports, and set `firestore.rules` to `allow false`. | High | 3 days |

