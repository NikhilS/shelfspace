# Unified API Architecture & Gateway Design: The Trade-off Analysis & Blueprint

**Author:** Staff Full-Stack & Systems Architect  
**Date:** September 2026  
**Status:** Proposal & Strategic Evaluation  
**Target:** Monorepo (`client`, `server`, `trpc`, `firestore`, future `mobile`)

---

## Executive Summary

The core architectural dilemma in modern web and mobile applications is deciding where data authority lives:

1. **The Client-Centric BaaS Model (Direct Client Firestore SDK)**: The browser and mobile apps communicate directly with Cloud Firestore using client SDKs, relying on `firestore.rules` for security, while an auxiliary server handles secret API keys (Gemini AI).
2. **The Unified API Gateway Model (tRPC + OpenAPI BFF)**: The database is completely sealed from the public internet. All clients (Web, iOS, Android, External CLI/API keys) route 100% of data reads and mutations through a single, type-safe API Gateway.

This document pulls this critical architectural debate into its own dedicated analysis. It explicitly evaluates the "free" features of native Firestore vs. the architectural purity of a unified gateway, details how **client-side caching and offline access** work without the Firestore SDK, provides a thorough **performance and latency investigation**, and presents a concrete implementation blueprint.

---

## 1. The Core Dilemma: What Does Native Firestore Give You "For Free"?

### Is it true that Firestore native client libraries give features for free, but make the external API a completely different code path?

**Yes, that is 100% correct.**

When you use the official client Firestore SDK (`firebase/firestore` on web, or Firebase Apple/Android SDKs), Google provides a massive amount of client-side infrastructure out of the box:

| Native Firestore Client SDK Feature | What You Get "For Free" | The Hidden Architectural Cost |
| :--- | :--- | :--- |
| **Native Offline Persistence** | Automatically caches documents in IndexedDB (Web) or SQLite (iOS/Android). Zero code required. | Bound to Firestore's proprietary document cache schema. Cannot be easily queried or migrated outside the SDK. |
| **Real-time Snapshot Delta Streaming** | `onSnapshot` maintains open WebSockets and pushes document-level binary deltas whenever data changes. | Unbounded listeners on large collections incur high Firestore read billing and significant browser heap usage. |
| **Built-in Offline Mutation Queue** | When offline, `setDoc` / `updateDoc` write to local storage and automatically flush in the background when connectivity resumes. | Error handling on conflict resolution or rejection by security rules happens asynchronously and is notoriously difficult to surface gracefully in UI. |
| **Multi-Tab Cache Synchronization** | If a user opens Library in Tab A and Tab B, edits made in Tab A instantly appear in Tab B via BroadcastChannel. | Locked into the browser context. |

### The Inherent Downside: The Fragmented Code Path

While the UI gets these features, **the external programmatic API and AI features cannot use the client Firestore SDK**:

```
[Web UI] ---------------------> [Client Firestore SDK] -----> [Cloud Firestore]
                                (Uses firestore.rules)               ^
                                                                     |
[External Scripts / cURL] ----> [Express REST /api/v1]                |
                                (Uses x-api-key & firebase-admin) ----+
                                                                     |
[AI Enrichment Compute] ------> [tRPC / Gemini Service]              |
                                (Uses process.env.GEMINI_API_KEY) ---+
```

1. **Split-Brain Security**:
   - Browser reads/writes are governed by `firestore.rules` (written in declarative Common Expression Language - CEL).
   - External API and server reads/writes bypass `firestore.rules` using `firebase-admin` service accounts and must re-implement authorization checks in TypeScript.
   - Any discrepancy between the rules and backend code creates a security vulnerability or inconsistent validation behavior.
2. **Mobile Duplication**:
   - If you build a native iOS (Swift) or Android (Kotlin) app, you would have to bundle the heavy Firebase Native SDKs into the mobile apps *and* still write separate HTTP networking code to talk to your backend for Gemini AI enrichment. The exact same split-brain would be replicated on mobile.
3. **Data Leaks & Transformation Gaps**:
   - The client SDK downloads whole documents directly from Firestore. You cannot easily sanitize internal fields or compute derived fields on the fly without custom client logic.

---

## 2. The Unified Gateway Architecture (tRPC + OpenAPI)

In this model, **we eliminate the direct client Firestore SDK entirely**. The database is locked down, and all clients speak to the API Gateway.

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
|  |     - Single Zod schema definition for Input and Output                       | |
|  |     - Automatically serves /trpc for Web and /api/v1 for REST/OpenAPI         | |
|  +-------------------------------------------------------------------------------+ |
|  |                         Domain Services & Repositories                        | |
|  |     - LibraryService, BookService, EnrichmentService                          | |
|  +-------------------------------------------------------------------------------+ |
|                                          |                                         |
|                 +------------------------+------------------------+                |
|                 v                                                 v                |
|       [Gemini AI / External APIs]                       [Cloud Firestore]          |
|        (Private Keys Server-Side)                 (100% Sealed: allow false)       |
+------------------------------------------------------------------------------------+
```

### How the Single Code Path Works:
- Procedures are written once using tRPC + Zod.
- `trpc-openapi` or `@trpc/server/adapters/fetch` exposes both:
  - **tRPC endpoints** (`/trpc/*`) for the Web React UI.
  - **REST OpenAPI endpoints** (`/api/v1/*`) for Mobile apps and External API keys.
- **`firestore.rules` is set to `allow false`**. No direct client access is allowed.

---

## 3. How to Handle Client-Side Caching & Offline Access Without Native Firestore

A common misconception is that without the native Firestore SDK, you lose offline capabilities and instant caching. In reality, modern client-side architectures handle caching and offline access cleanly using industry-standard tools:

### A. Web Application (React + TanStack Query + IndexedDB)

Instead of using `skipToken` or raw Firestore listeners, TanStack Query natively supports robust offline persistence through its **Persist Client Plugin**:

```typescript
// src/lib/queryClient.ts
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval'; // Lightweight IndexedDB wrapper

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: 1000 * 60 * 60 * 24, // 24 hours retention in storage
      networkMode: 'offlineFirst', // Serve from cache immediately when offline
    },
    mutations: {
      networkMode: 'offlineFirst',
    },
  },
});

// Sync entire query cache to browser IndexedDB
const idbPersister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => await get(key),
    setItem: async (key, value) => await set(key, value),
    removeItem: async (key) => await del(key),
  },
});

persistQueryClient({
  queryClient,
  persister: idbPersister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
});
```

#### How Web Offline Works in Practice:
1. **Instant First Paint (<15ms)**: On cold app launch (even with zero network or airplane mode), `persistQueryClient` hydrates the entire library from IndexedDB synchronously into the React state.
2. **Optimistic Mutations**: When a user marks a book as "Finished", TanStack Query's `onMutate` applies the change to the local cache immediately (0ms UI latency) and updates IndexedDB.
3. **Background Sync Queue**: If the network is offline, mutations pause in TanStack Query's mutation queue (`resumePausedMutations`). As soon as `window.addEventListener('online')` fires, the queue flushes pending updates to the API Gateway.

---

### B. Native iOS (Swift + SwiftData / GRDB)

On iOS, the gold standard architecture does not use Firebase SDKs. It uses **SwiftData** (or SQLite via GRDB) as the local source of truth:

```
[SwiftUI View] <======> [SwiftData Local Store (SQLite)]
                                ^
                                | (Sync Engine)
                                v
                     [Generated OpenAPI Client]
                                ^
                                | (HTTPS / Bearer Token)
                                v
                     [Unified API Gateway]
```

1. **Local-First Rendering**: The UI binds directly to `@Query` from SwiftData. The UI never waits for network requests.
2. **Network Sync Engine**: Background tasks (`BGAppRefreshTask`) or network monitors (`NWPathMonitor`) fetch delta changes from `GET /api/v1/libraries/{id}/books?since=TIMESTAMP` and upsert into SwiftData.
3. **Offline Resilience**: All user edits write to SwiftData immediately with a `syncState = .pending` flag. A background queue flushes pending items when connectivity returns.

---

### C. Native Android (Kotlin + Room Database + WorkManager)

On Android, this is the canonical **Offline-First Architecture** recommended by Google Architecture Guidelines:

1. **Room Database (SQLite)**: Acts as the single source of truth for the UI (`Flow<List<BookEntity>>`).
2. **Retrofit API Client**: Generated from the OpenAPI spec.
3. **WorkManager**: Schedules offline mutation jobs that survive app process death and device reboots, automatically executing when network constraints (`NetworkType.CONNECTED`) are satisfied.

---

## 4. Performance Investigation: Would Performance Suffer?

To answer whether performance suffers, we must measure performance across four distinct vectors:

### Vector 1: First Paint & Cold Start Time
* **Direct Client Firestore SDK**:
  - Requires downloading and parsing the heavy Firebase Firestore JS SDK (~120KB gzipped).
  - Must boot the internal Firebase WebWorker and initialize IndexedDB persistence.
  - Initial cold render typically takes **250ms - 450ms**.
* **Unified Gateway + TanStack Query Persist**:
  - **Much smaller JavaScript bundle**: Stripping `firebase/firestore` saves ~90KB of client JS.
  - Hydrates plain JSON from IndexedDB via `idb-keyval` in **<15ms**.
  - **Verdict: The Unified Gateway is FASTER on first paint.**

---

### Vector 2: User Mutation Latency (Click to Visual Update)
* **Direct Client Firestore SDK**:
  - Executes optimistic update in memory; returns almost instantly (0ms).
* **Unified Gateway with TanStack Query / SwiftData / Room**:
  - Executes optimistic update via `onMutate` or local DB write; returns instantly (0ms).
* **Verdict: TIE. Both provide instantaneous 0ms perceived latency.**

---

### Vector 3: Memory & Garbage Collection Pressure
* **Direct Client Firestore SDK**:
  - `onSnapshot` holds active references to every document snapshot object in memory to calculate deltas.
  - For a library with 2,000 books, Firestore instantiates 2,000 complex DocumentSnapshot instances with internal metadata, watch listeners, and protobuf descriptors.
  - High memory footprint and GC pauses during scroll/filter interactions.
* **Unified Gateway**:
  - Books are stored as simple, flat JavaScript objects in TanStack Query cache.
  - Can be easily virtualized and garbage collected when views unmount.
  - **Verdict: The Unified Gateway is SUBSTANTIALLY LIGHTER on memory.**

---

### Vector 4: Network & Server Latency (The Real Trade-Off)
* **Direct Client Firestore SDK**:
  - Traffic routes directly to Google's globally distributed Firestore edge infrastructure.
  - No server intermediate hop; Google handles all caching and load balancing.
* **Unified Gateway**:
  - Every uncached network request hits your Cloud Run container.
  - **The Costs**:
    - Adds ~20ms - 40ms of latency for the intermediate container hop (Express + Firebase Admin).
    - **Cold Starts**: If Cloud Run scales to zero, an uncached cold request can take 1.5s - 2.5s (unless `minInstances: 1` is configured).
  - **The Mitigations**:
    - **HTTP ETag & 304 Not Modified Caching**: The server can return `304 Not Modified` in 10ms if the library hasn't changed, consuming zero Firestore read costs!
    - **In-Memory Server Caching**: Frequently accessed metadata (taxonomy, genres) can be cached in Redis or container memory.
* **Verdict: Client Firestore has lower network hop latency; Gateway requires minimum instances or HTTP caching to match.**

---

## 5. Architectural Comparison Matrix

| Factor | Direct Client Firestore (Current BaaS) | Unified Gateway (tRPC + OpenAPI) | Winner |
| :--- | :--- | :--- | :--- |
| **Security & Auditing** | Split between `firestore.rules` and server TypeScript. Vulnerable to misconfigurations. | Single TypeScript layer. Firestore is completely locked (`allow false`). | **Gateway** (By far) |
| **Code Maintainability** | 3 different ways to access data (Client SDK, tRPC, Express). Duplicate logic. | 1 single router and Zod schema powering Web, Mobile, and API keys. | **Gateway** |
| **Native Mobile Apps** | Awkward. Must bundle heavy Firebase SDKs and still write custom networking for AI. | Native Swift/Kotlin clients auto-generated from OpenAPI specs. | **Gateway** |
| **Bundle Size (Web)** | Heavy (~120KB+ for Firestore client SDK). | Lightweight (~35KB for tRPC/React Query). | **Gateway** |
| **Offline First** | Free, zero-code IndexedDB persistence out of the box. | Requires configured TanStack Query Persister (Web) or SQLite (Mobile). | **Client Firestore** |
| **Real-Time Collaboration** | Instant sub-second delta streaming via built-in WebSockets. | Requires polling or explicit SSE/tRPC Subscriptions. | **Client Firestore** |
| **Database Portability** | Permanently vendor-locked to Google Firebase. | 100% portable. Backend can switch to PostgreSQL / Cloud SQL without touching clients. | **Gateway** |
| **Cloud Run Compute Cost** | Near zero (Google handles CRUD reads/writes at edge). | Moderate (Container handles all incoming requests and serialization). | **Client Firestore** |

---

## 6. Staff Recommendation & Implementation Strategy

### The Strategic Verdict

For a **personal book library, reading tracker, and AI curation tool**, the requirements are:
1. Fast local viewing and search.
2. Rich AI enrichment (Gemini) that requires secure backend keys.
3. Programmatic API access (`x-api-key`) for external scripts/tools.
4. Future readiness for native iOS and Android apps.
5. High security and clean, maintainable code.

**Notice what is NOT on this list:**
- We are *not* building a collaborative multiplayer whiteboarding app (like Figma).
- We are *not* building a real-time messaging chat room (like Slack).

For this domain, **the real-time WebSocket capabilities of native Firestore are an architectural distraction** that costs you code cleanliness, creates split-brain security risks, and complicates mobile development.

### The Phased Migration Plan

#### Phase 1: Mount OpenAPI on tRPC
- Install `trpc-openapi`.
- Annotate existing procedures in `src/server/trpc/routers/` with OpenAPI metadata (HTTP method, path, tags).
- Mount the OpenAPI Express middleware at `/api/v1`.
- Verify that external API keys (`x-api-key: lib_live_...`) authenticate cleanly against `/api/v1/libraries`.

#### Phase 2: Set Up Client Query Persistence (Web)
- Configure `@tanstack/react-query-persist-client` with `idb-keyval` in the React web app.
- Ensure the app hydrates instantly from IndexedDB on startup.

#### Phase 3: Transition Client Data Fetching to tRPC
- Migrate `useLibraryData.ts` from direct Firestore `onSnapshot` / `collection` calls to `trpc.library.getBooks.useQuery()`.
- Add optimistic mutation handlers (`onMutate`) for status updates and edits.

#### Phase 4: Lock Down Firestore
- Update `firestore.rules` to `allow read, write: if false;`.
- Remove all `@firebase/firestore` imports from client bundles.
- Generate `openapi.json` for future native iOS and Android client generation.
