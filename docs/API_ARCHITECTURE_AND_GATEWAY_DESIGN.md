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

## 6. Detailed Investigation: The Core Questions

### Q1: What client-side changes are needed to call exclusively the tRPC endpoints?

To eliminate the direct client Firestore SDK completely, we must audit and replace every client-side touchpoint that currently imports `firebase/firestore`.

#### Complete Client-Side Touchpoint Inventory:

| File | Current Direct Firestore Usage | Replacement via tRPC Gateway |
| :--- | :--- | :--- |
| **`src/hooks/useLibraryData.ts`** | Subscribes via `onSnapshot(query(collection('books')))` and reads `getDocsFromCache`. | Replaced by `trpc.book.list.useQuery({ libraryId })`. |
| **`src/hooks/useLibraryData.ts` (Mutations)** | Direct writes: `updateDoc(doc('books', id), changes)`, `deleteDoc(doc('books', id))`, `addDoc(...)`. | Replaced by `trpc.book.update.useMutation()`, `trpc.book.delete.useMutation()`, `trpc.book.create.useMutation()`. |
| **`src/lib/clientBulkWriter.ts`** | Batches direct `writeBatch()` or chunked `setDoc()` directly to Firestore. | Replaced by `trpc.book.batchUpsert.useMutation({ libraryId, books })`. The server executes the batch via `adminDb.batch()`. |
| **`src/stores/authStore.tsx`** | Reads/writes user profile to Firestore `/users/{uid}` via `getDoc()` and `setDoc()`. | Replaced by `trpc.user.getProfile.useQuery()` and `trpc.user.syncProfile.useMutation()`. |
| **`src/hooks/useAppPermissions.ts`** | Reads allowlist document `getDoc(doc('appSettings/allowlist/users', email))`. | Replaced by `trpc.auth.getPermissions.useQuery()`, which is verified by server middleware. |
| **`src/firebase.ts`** | Exports `export const db = getFirestore(app)`. | Removed completely! `src/firebase.ts` will **only export `auth`** for Google/Email authentication. |

#### Exact Client Setup Changes:
1. **Already in place**:
   - In `src/App.tsx`, `<trpc.Provider client={trpcClient} queryClient={queryClient}>` is already wrapped around the entire application.
   - In `src/lib/trpc.ts`, `trpcClient` is already configured with `httpBatchLink({ url: '/trpc' })` and automatically injects `Authorization: Bearer <token>` from `auth.currentUser?.getIdToken()`.
2. **Changes needed**:
   - Refactor `useLibraryData.ts` to consume `trpc.book.list.useQuery` instead of manual snapshot listeners.
   - Remove all `@firebase/firestore` imports across the `src/` directory.

---

### Q2: In your plan, when do writes migrate to the new API?

#### Strategic Sequencing: Migrate Writes FIRST (or Concurrent with Reads)

A common mistake in database migrations is trying to migrate reads and writes simultaneously across the entire application. The safest, zero-downtime path is:

```
[Phase A: Write Migration]
Client Writes  --->  [tRPC / AdminDb]  --->  [Cloud Firestore]
                                                    |
                                                    v (triggers)
Client Reads   <---------------------------- [Firestore onSnapshot]
```

#### Why Migrate Writes First?
1. **Zero State Tearing**: Because `adminDb` on the server writes directly to the same Cloud Firestore collection, the client's existing `onSnapshot` listener **still fires automatically**!
   - When a user changes a book status from "reading" to "finished" via `trpc.book.update.useMutation()`, the server updates Firestore.
   - The active client `onSnapshot` listener receives the change in real-time and re-renders the UI.
2. **Validate Permissions Early**: Migrating writes first forces us to establish and test all server-side write authorization checks (`verifyLibraryWriteAccess`) while reads continue working undisturbed.
3. **No Downtime**: Once all write paths (single edits, deletes, and bulk CSV/Goodreads imports) are 100% verified on tRPC, we flip reads from `onSnapshot` to `trpc.book.list.useQuery`.

#### The 4-Step Operational Sequence:
1. **Step 1 (API & Writes)**: Implement `trpc.book.create`, `update`, `delete`, and `batchUpsert`. Switch UI forms and actions to call these mutations.
2. **Step 2 (Client Caching Prep)**: Mount TanStack Query IndexedDB persister at the root of the app.
3. **Step 3 (Reads)**: Replace `useLibraryData`'s `onSnapshot` with `trpc.book.list.useQuery`.
4. **Step 4 (Seal the Database)**: Update `firestore.rules` to `allow read, write: if false;`.

---

### Q3: At which step does the OAuth check move to the tRPC stack? Or is it already there?

#### The Current State: **It is 80% already there, but fragmented.**

Currently:
1. **Client**: When a user logs in via Google OAuth (`signInWithPopup` in `useAuthStore.tsx`), Firebase Auth receives standard Google OAuth credentials and issues a **Firebase ID Token (JWT)**.
2. **Client tRPC Link**: `src/lib/trpc.ts` already extracts `await auth.currentUser?.getIdToken()` and sets the `Authorization: Bearer <token>` header on every tRPC request.
3. **Server tRPC Context**: `src/server/trpc/trpc.ts` already decodes the JWT using `admin.auth().verifyIdToken(token)` and checks the allowlist!

#### Why It Feels Incomplete Today (The 20% Gap):
- **Parallel Express REST Middleware**: `server.ts` has its own duplicate, standalone `authenticateApiToken` middleware that also verifies Firebase JWTs and API keys for `/api/v1` routes.
- **Client Direct Bypasses**: When the client reads or writes directly to Firestore via `firebase/firestore`, it talks to Google's edge using the client Firebase auth state, bypassing the tRPC server entirely.
- **Client Allowlist Read**: `useAppPermissions.ts` directly queries `/appSettings/allowlist/users` from the client rather than relying on the server's context.

#### When Does it Move Completely?
In **Phase 1**, when we extract the auth pipeline into a standalone, modular auth library (`src/server/auth/`), the server becomes the **sole gatekeeper**. The client does nothing with OAuth other than acquiring the token and passing it in headers.

---

## 7. The Modular Server Auth Architecture (`src/server/auth/`)

Because authentication and authorization are mission-critical, they must not be scattered inside `server.ts` or tangled inside tRPC router definitions. We will encapsulate all auth logic into a decoupled module.

### Directory Structure:
```
src/server/auth/
├── index.ts               # Public exports (middleware, context types, procedures)
├── context.ts             # Context builder (header parsing, user extraction)
├── tokenVerifier.ts       # Firebase ID Token verification (JWT)
├── apiKeyVerifier.ts      # Hashed API Key verification ('lib_live_...')
├── allowlistService.ts    # Allowlist resolution with in-memory TTL caching
├── permissions.ts         # Role definitions & RBAC checks (owner, editor, viewer)
├── procedures.ts          # Reusable tRPC procedure builders
└── __tests__/
    ├── tokenVerifier.test.ts
    ├── apiKeyVerifier.test.ts
    ├── allowlistService.test.ts
    └── procedures.test.ts
```

### 1. Unified Context & User Shape
```typescript
// src/server/auth/types.ts
export interface AuthUser {
  uid: string;
  email: string;
  authType: 'jwt' | 'api_key';
  apiKeyId?: string;
  isSuperAdmin: boolean;
}

export interface SecurityContext {
  user: AuthUser | null;
  isAppAllowed: boolean;
  isAdmin: boolean;
}
```

### 2. High-Level, Composable Procedure Builders
Instead of manual `if (!user)` checks inside procedure handlers, developers use semantic, chainable procedure builders:

```typescript
// src/server/auth/procedures.ts
import { initTRPC, TRPCError } from '@trpc/server';
import { SecurityContext } from './types';
import { LibraryService } from '../../services/server/libraryService';

const t = initTRPC.context<SecurityContext>().create();

// 1. Public (Health checks, public share links)
export const publicProcedure = t.procedure;

// 2. Authenticated + Allowlisted (General app actions)
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Authentication required' });
  }
  if (!ctx.isAppAllowed) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'User is not on the active allowlist' });
  }
  return next({ ctx: { user: ctx.user, isAppAllowed: true, isAdmin: ctx.isAdmin } });
});

// 3. Admin Only (User management, system configuration)
export const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!ctx.isAdmin) {
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Administrative access required' });
  }
  return next({ ctx });
});

// 4. Library RBAC Procedure Factory (Auto-checks library membership!)
export function libraryProcedure(requiredRole: 'viewer' | 'editor' | 'owner') {
  return protectedProcedure.use(async ({ ctx, rawInput, next }) => {
    const input = rawInput as { libraryId?: string };
    if (!input?.libraryId) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'libraryId required' });
    }

    const hasAccess = await LibraryService.verifyLibraryAccess(
      ctx.user.uid,
      ctx.user.email,
      input.libraryId,
      requiredRole
    );

    if (!hasAccess) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Insufficient permissions for library (${requiredRole} required)`,
      });
    }

    return next({ ctx: { ...ctx, libraryId: input.libraryId } });
  });
}
```

#### How Clean Endpoint Definitions Become:
```typescript
// Any new endpoint is completely protected in ONE line:
export const bookRouter = router({
  updateBook: libraryProcedure('editor')
    .input(z.object({ libraryId: z.string(), bookId: z.string(), updates: BookUpdateSchema }))
    .mutation(async ({ ctx, input }) => {
      // Guaranteed: user is logged in, allowlisted, and has editor rights on libraryId!
      return bookService.updateBook(input.libraryId, input.bookId, input.updates);
    }),
});
```

### 3. Comprehensive Test Coverage Matrix
The `src/server/auth/__tests__/` suite will test 100% of auth states in isolation:

| Test Case | Mock Condition | Expected Result |
| :--- | :--- | :--- |
| **Valid Bearer JWT** | `verifyIdToken` resolves user | Populates `ctx.user` with `authType: 'jwt'`. |
| **Expired/Malformed JWT** | `verifyIdToken` rejects with `auth/id-token-expired` | Sets `ctx.user = null`; throws `UNAUTHORIZED` on protected procedure. |
| **Valid `x-api-key`** | `ApiKeyService.validateApiKey` resolves key | Populates `ctx.user` with `authType: 'api_key'` and `apiKeyId`. |
| **Revoked/Invalid API Key** | `ApiKeyService.validateApiKey` returns null | Sets `ctx.user = null`; returns 401. |
| **Superadmin Email Bypass** | Email matches `SUPERADMIN_EMAIL` | Sets `isAppAllowed = true` and `isAdmin = true` with zero DB read. |
| **Allowlist Resolution & Cache** | Admin doc exists with `role: 'admin'` | Grants access and caches in memory for 3 minutes. |
| **Library RBAC - Viewer on Editor Action** | User has `role: 'viewer'`; procedure needs `'editor'` | Throws `FORBIDDEN` before reaching service handler. |
| **Library RBAC - Non-Member** | User has no membership document | Throws `FORBIDDEN`. |

---

## 8. Cross-Cutting Client-Side Caching & Offline Architecture

To make caching and offline access work **transparently across all existing and future data in the app**, we avoid writing custom caching logic for individual components. Instead, we establish a **Cross-Cutting Persistence Layer** using TanStack Query.

```
+-------------------------------------------------------------------------------+
|                            REACT APPLICATION UI                               |
|                                                                               |
|  [Library View]      [Timeline View]      [Constellation Map]   [Future View] |
|         \                   |                    /                   /        |
+----------\------------------|-------------------/-------------------/---------+
            \                 |                  /                   /
             v                v                 v                   v
+-------------------------------------------------------------------------------+
|                       GLOBAL TANSTACK QUERY CLIENT                            |
|                                                                               |
|  Query Cache:                                                                 |
|    ['libraries']                     --> List of user libraries               |
|    ['books', libraryId]              --> Full collection for library          |
|    ['book', bookId]                  --> Single book metadata                 |
|    ['enrichmentJob', jobId]          --> Background AI job status             |
|                                                                               |
|  Mutation Queue:                                                              |
|    [Update Book #41]                 --> Optimistic update applied locally    |
|    [Delete Book #89]                 --> Pauses when offline, flushes online  |
+---------------------------------------+---------------------------------------+
                                        |
                 +----------------------+----------------------+
                 | (Bidirectional Sync)                        | (Network Transport)
                 v                                             v
+-----------------------------------+         +---------------------------------+
|       INDEXEDDB PERSISTER         |         |          tRPC CLIENT            |
|       (via idb-keyval)            |         |     (Authorization: Bearer)     |
|                                   |         |                                 |
| - Synchronous cold boot restore   |         | - Online: fetches latest data   |
| - Persists mutations across reloads|        | - Offline: pauses mutations     |
+-----------------------------------+         +---------------------------------+
```

### 1. The Global QueryClient Configuration
Configured once at the application root (`src/lib/queryClient.ts`):

```typescript
import { QueryClient } from '@tanstack/react-query';
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { get, set, del } from 'idb-keyval';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes fresh
      gcTime: 1000 * 60 * 60 * 24 * 7, // 7 days retention in IndexedDB
      networkMode: 'offlineFirst', // Serve from IndexedDB immediately, then fetch in background
      refetchOnWindowFocus: false,
      retry: 2,
    },
    mutations: {
      networkMode: 'offlineFirst', // Pause and queue mutations if device is offline
      retry: 3,
    },
  },
});

// Configure transparent IndexedDB backing
const persister = createAsyncStoragePersister({
  storage: {
    getItem: async (key) => await get(key),
    setItem: async (key, value) => await set(key, value),
    removeItem: async (key) => await del(key),
  },
});

persistQueryClient({
  queryClient,
  persister,
  maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days cache validity
  buster: 'v1.0.0', // Bump to invalidate cache on schema changes
});
```

### 2. Standardized Hierarchical Query Keys
Every query in the app adheres to a predictable key hierarchy:
- `['libraries']`
- `['libraries', libraryId]`
- `['books', libraryId]`
- `['books', libraryId, { genre: 'Sci-Fi' }]`
- `['enrichmentJobs', libraryId]`

**Why this is cross-cutting**: When a developer creates a new feature (e.g. `readingGoals`), they simply use `['readingGoals', libraryId]`. It **automatically** gets:
1. IndexedDB offline persistence.
2. Synchronous cold-boot hydration.
3. Offline queueing if a mutation is dispatched while disconnected.

### 3. Reusable Optimistic Mutation Helper
To eliminate boilerplate across UI components, we provide a cross-cutting helper `createOptimisticMutation`:

```typescript
// src/lib/optimisticMutation.ts
import { queryClient } from './queryClient';

export function createOptimisticMutation<TData, TVariables>({
  queryKey,
  updateCache,
}: {
  queryKey: unknown[];
  updateCache: (oldData: TData | undefined, variables: TVariables) => TData;
}) {
  return {
    onMutate: async (variables: TVariables) => {
      // 1. Cancel any outgoing refetches to avoid overwriting optimistic update
      await queryClient.cancelQueries({ queryKey });

      // 2. Snapshot the previous cache value for rollback
      const previousData = queryClient.getQueryData<TData>(queryKey);

      // 3. Optimistically update TanStack Query cache (and trigger IndexedDB write)
      queryClient.setQueryData<TData>(queryKey, (old) => updateCache(old, variables));

      return { previousData };
    },
    onError: (_err: unknown, _newVal: TVariables, context?: { previousData?: TData }) => {
      // 4. Roll back on error
      if (context?.previousData) {
        queryClient.setQueryData<TData>(queryKey, context.previousData);
      }
    },
    onSettled: () => {
      // 5. Invalidate to refetch authoritative state from server
      void queryClient.invalidateQueries({ queryKey });
    },
  };
}
```

#### How Clean UI Component Mutations Look:
```typescript
const updateBook = trpc.book.update.useMutation({
  ...createOptimisticMutation<Book[], { bookId: string; updates: Partial<Book> }>({
    queryKey: ['books', libraryId],
    updateCache: (books, { bookId, updates }) =>
      books?.map((b) => (b.id === bookId ? { ...b, ...updates } : b)) ?? [],
  }),
});

// Calling updateBook.mutate({ bookId: '123', updates: { status: 'finished' } })
// -> UI updates in 0ms!
// -> Written to IndexedDB immediately!
// -> If offline, queued and flushes upon reconnect!
```

---

## 9. Comprehensive Implementation Roadmap

```
  [Phase 1: Auth & Modular Gateway]
  - Create src/server/auth/ module with 100% unit test coverage.
  - Mount unified auth middleware in createContext.
  - Extract /api/v1 routes from server.ts into src/server/api/v1/.
  - Deprecate duplicate auth code in server.ts.
                 |
                 v
  [Phase 2: Server CRUD Procedures & Write Migration]
  - Create trpc.book.create, update, delete, batchUpsert.
  - Add OpenAPI metadata annotations (trpc-openapi).
  - Migrate client write touchpoints (useLibraryData, ClientBulkWriter) to tRPC mutations.
  - Reads remain on Firestore onSnapshot (zero UI disruption).
                 |
                 v
  [Phase 3: Cross-Cutting Client Cache & Read Migration]
  - Configure @tanstack/react-query-persist-client with idb-keyval in App.tsx.
  - Migrate useLibraryData from onSnapshot to trpc.book.list.useQuery.
  - Verify instant <15ms cold start hydration from IndexedDB.
                 |
                 v
  [Phase 4: Seal Firestore Database & Cleanup]
  - Update firestore.rules to `allow read, write: if false;`.
  - Remove firebase/firestore package from client bundles.
  - Expose generated openapi.json for documentation and testing.
```

| Phase | Core Deliverable | Risk / Mitigation | Effort |
| :--- | :--- | :--- | :--- |
| **Phase 1** | **Modular Auth Library (`src/server/auth/`)**: Decouple token verification, API key verification, allowlist caching, and RBAC procedures with full unit test coverage. | **Low**: Existing tRPC and REST routes continue functioning; auth logic is consolidated without changing endpoints. | 1.5 days |
| **Phase 2** | **CRUD Procedures & Write Migration**: Build `trpc.book.*` mutations. Point UI actions (`updateBook`, `deleteBook`, `bulkImport`) to tRPC. | **Low**: Reads stay on `onSnapshot`, so UI updates immediately when server writes to Firestore. | 2 days |
| **Phase 3** | **Client Persistence & Read Migration**: Set up IndexedDB persister; switch `useLibraryData` to `trpc.book.list.useQuery`. | **Medium**: Requires testing offline cold boot and optimistic rollback behaviors. | 2 days |
| **Phase 4** | **Database Lockdown & Bundle Optimization**: Set `firestore.rules` to deny all client access; remove `@firebase/firestore` from client bundle. | **Low**: If any client code still tries to access Firestore directly, the test suite and deny-all rule immediately catch it. | 1 day |

