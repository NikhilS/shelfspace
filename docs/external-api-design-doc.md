# Design Doc: Externally Accessible API for Library Application

## 1. Stack / Library Options to Build the API

### Option A: Express REST / OpenAPI Routes (Integrated into Existing `server.ts`)
* **Overview:** Add standard RESTful endpoints directly into the current Express server (`server.ts`), powered by routing modules or OpenAPI/Swagger tools (like `express-openapi-validator` or `@asteasolutions/zod-to-openapi`).
* **Pros:**
  * Zero additional server runtimes or infrastructure overhead; runs on the existing container listening on port 3000.
  * Native compatibility with standard HTTP clients, curl, python scripts, and external tools like Antigravity CLI.
  * Direct access to current Express middleware and internal services.
* **Cons:**
  * Requires maintaining separate REST handler definitions alongside tRPC procedures unless schema sharing or adapters are used.

### Option B: tRPC OpenAPI Extension (`trpc-openapi`)
* **Overview:** Use the `trpc-openapi` extension to automatically generate RESTful, OpenAPI-compliant (Swagger) endpoints directly from existing tRPC procedures by adding `meta: { openapi: { method, path } }` tags.
* **Pros:**
  * 100% single source of truth for both web frontend (tRPC) and external API (REST).
  * Automatically generates OpenAPI v3 JSON spec and Swagger UI.
  * Input/output validation automatically handled by existing Zod schemas.
* **Cons:**
  * `trpc-openapi` requires procedures to use object inputs/outputs (no primitive or void responses without wrapping).
  * Streaming responses or complex websockets require standard Express handlers.

### Option C: Standalone Fastify / Hono Microservice API Route
* **Overview:** Mount a lightweight router framework (such as Hono or Fastify) inside Node/Express or as a sub-app listening on `/api/v1/*`.
* **Pros:**
  * Extremely fast execution, clean request/response pipeline.
  * Great TypeScript support and lightweight footprint.
* **Cons:**
  * Introduces an additional framework dependency into `package.json`.

### Option D: gRPC Services (`@connectrpc/connect` or `@grpc/grpc-js`)
* **Overview:** Define API interfaces using Protocol Buffers (`.proto` schema files) and serve gRPC / gRPC-Web / Connect endpoints using Node.js gRPC frameworks like Connect-ES (`@connectrpc/connect-node`).
* **Pros:**
  * **High Performance & Low Payload Size:** Protobuf binary serialization significantly reduces payload size and serialization overhead compared to JSON.
  * **Multi-Language Client Generation:** Language-agnostic `.proto` files allow generating native client SDKs for Python, Go, Rust, Java, and CLI tools seamlessly.
  * **First-Class Streaming:** Built-in support for client, server, and bi-directional streaming over HTTP/2.
* **Cons:**
  * **Build Overhead:** Requires `.proto` compilation step (`protoc` or `buf`) to generate TypeScript stubs.
  * **Browser Constraints:** Standard web browsers cannot initiate raw HTTP/2 gRPC requests directly; requires using gRPC-Web or Connect protocol adapters.
  * **CLI & Tooling Friction:** Simple HTTP tools (`curl`, Postman, simple Python `requests`) cannot invoke gRPC endpoints without `grpcurl` or server reflection enabled.
  * **Schema Duplication:** Requires maintaining Protobuf schemas in addition to existing Zod schemas and TypeScript interfaces used across the app.

---

### Comparison Summary: tRPC vs. gRPC for External API & CLI Access

| Feature / Metric | tRPC (with OpenAPI/REST) | gRPC (`.proto` + Connect) |
| :--- | :--- | :--- |
| **Type System** | TypeScript-native (Zod schemas) | Language-agnostic Protocol Buffers (`.proto`) |
| **Code Generation** | None required (Inferred automatically) | Required (`protoc` / `@bufbuild/protoc-gen-es`) |
| **Protocol & Format** | HTTP/1.1 or HTTP/2 with JSON | HTTP/2 with Protobuf Binary (or JSON via Connect) |
| **Browser Compatibility** | Native (`fetch`, tRPC React client) | Requires gRPC-Web or Connect protocol |
| **CLI & cURL Friendliness** | Very high (standard REST/JSON) | Lower (requires `grpcurl` or protobuf stubs) |
| **Multi-Language Support** | Requires OpenAPI generation for SDKs | Native code generation for all major languages |
| **Streaming Capabilities** | Subscriptions / Server-Sent Events | Full client, server, & bi-directional streaming |
| **Code Sharing with App** | Direct (reuses shared Zod schemas & services) | Low (requires mapping Protobuf to Zod/TS) |

* **Recommendation for this Application:** **tRPC (Option B) or Express REST (Option A)** is best suited for AI Studio, Antigravity CLI, and web browser workflows due to zero schema duplication, instant cURL/HTTP compatibility, and native TypeScript inference without a build step. **gRPC (Option D)** is ideal if low-latency microservice-to-microservice communication or multi-language client SDK generation is required in the future.

---

## 2. Authentication Options for External Access

### Option A: Long-Lived API Keys (Stored in Firestore)
* **How It Works:**
  * Generate secure, random API keys (e.g., `lib_live_sk_...`) hashed with SHA-256 before storing in Firestore under an `apiKeys` collection.
  * Clients pass the key in an `X-API-Key` or `Authorization: Bearer <api_key>` header.
  * Express middleware verifies the key hash against Firestore, fetches associated user ID / permissions, and attaches `ctx.user` to the request context.
* **Pros:**
  * Best developer experience for CLI tools (like Antigravity CLI) and automation scripts.
  * Easy key revocation and scope management per user/key.
* **Cons:**
  * Requires creating a UI/CLI flow for key generation and management.

### Option B: Firebase ID Tokens / Custom JWT Bearer Tokens
* **How It Works:**
  * Use standard Firebase ID Tokens passed via `Authorization: Bearer <id_token>`.
  * Alternatively, generate custom long-lived OAuth/JWT tokens signed by a server secret for machine-to-machine calls.
* **Pros:**
  * Reuses existing Firebase Admin verification logic (`admin.auth().verifyIdToken`).
  * Direct 1:1 user context mapping.
* **Cons:**
  * Short lifespan of default Firebase ID tokens (1 hour) requires refresh token handling for CLI automation.

### Option C: OAuth2 Server Flow (Client Credentials / Authorization Code)
* **How It Works:**
  * Standard OAuth2 endpoints (`/oauth/token`, `/oauth/authorize`) for third-party client integrations.
* **Pros:**
  * Standard enterprise integration pattern.
* **Cons:**
  * Higher complexity than needed for CLI or personal bulk script integrations.

---

## 3. Code Sharing Strategy with Existing Backend & tRPC

### Architecture & Service Layer Extraction
To maximize code reuse across the tRPC frontend router and the external API:

1. **Extract Business Logic into Shared Service Functions (`src/services/server/`):**
   * Decouple database operations (Firestore calls), metadata enrichment logic (Gemini/Geo providers), and library write permission checks from tRPC procedures into standalone core service modules.
   * Example core functions:
     * `getLibraryById(libraryId, userId)`
     * `enrichBooksBatch(libraryId, books, providerKey)`
     * `bulkUpdateBooks(libraryId, updates)`

2. **Unified Zod Schema Layer (`src/schemas/`):**
   * Define inputs and outputs using Zod schemas shared across tRPC routers, external REST validators, and frontend client types.

3. **Dual Transport Adapters:**
   * **tRPC Procedures:** Lightweight wrappers that unpack tRPC input, invoke the shared service function, and return results.
   * **External REST/OpenAPI Endpoints:** Express handlers that validate headers/API keys, unpack JSON body/query params using the same Zod schemas, invoke the exact same shared service functions, and return REST JSON.

---

## 4. Staff Software Engineer Implementation Strategy (tRPC + Secret API Keys)

### 4.1 System Architecture & Code Reuse Strategy

To maintain maximum maintainability and zero code duplication, the architecture strictly separates transport layers (tRPC / REST) from domain logic and validation rules:

1. **Shared Service Layer (`src/services/server/`):**
   * Decouple all database operations, permissions checks, and provider interactions from tRPC handlers into pure service functions.
   * `src/services/server/enrichmentService.ts`: Core functions for batch book enrichment, provider execution, and metadata merging.
   * `src/services/server/apiKeyService.ts`: Core functions for generating, hashing, validating, and revoking API keys in Firestore.
   * `src/services/server/libraryService.ts`: Shared permission verification functions (`verifyLibraryReadAccess`, `verifyLibraryWriteAccess`).

2. **Unified Zod Validation Schemas (`src/schemas/`):**
   * Centralize all Zod input/output schemas into `src/schemas/enrichment.ts` and `src/schemas/apiKey.ts`.
   * These schemas are imported and reused across:
     * tRPC router procedure definitions.
     * OpenAPI REST route generation (via `trpc-openapi` or Express REST handlers).
     * Frontend React forms and TypeScript client types.

3. **Transport Layer Isolation:**
   * tRPC procedures and REST endpoints act solely as lightweight transport adapters that parse input via Zod, verify context/permissions, call the shared service layer, and return standard responses.

---

### 4.2 Security Architecture & Auth Stack Extension

#### API Key Storage & Generation Model
* **Key Format:** Cryptographically secure string prefixed with `lib_live_` followed by 32 random bytes (e.g., `lib_live_7a9f8b2c4d6e8f0a1b3c5d7e9f0a2b4c`).
* **Storage Location:** Firestore `apiKeys` collection under the document ID equal to the SHA-256 hash of the key.
* **Plaintext Safety:** Raw API keys are **never stored** in Firestore or logged anywhere on the server. Only the SHA-256 hash (`keyHash`), key prefix (`lib_live_...`), partial suffix (`...a1b2`), human-readable name, owner UID, owner email, `createdAt`, `lastUsedAt`, `expiresAt`, and `revoked` status are stored.

#### Authentication Pipeline (`src/server/trpc/trpc.ts`)
The `createContext` function will be updated to handle dual-authentication seamlessly:

1. **Header Parsing:**
   * Inspect incoming HTTP headers for `X-API-Key: <key>` or `Authorization: Bearer <token_or_key>`.
2. **Auth Branching:**
   * **Branch A (API Key Detected):** If header starts with `lib_live_` or `X-API-Key` is supplied:
     * Compute SHA-256 hash of the incoming key.
     * Fetch document from Firestore `apiKeys/{keyHash}`.
     * Verify document exists, `revoked === false`, and `expiresAt` is in the future.
     * Use `crypto.timingSafeEqual` during hash verification.
     * Asynchronously touch `lastUsedAt` timestamp without blocking the request pipeline.
     * Attach synthetic user context to `ctx`: `{ uid: doc.ownerId, email: doc.ownerEmail, authType: 'api_key', apiKeyId: doc.id }`.
   * **Branch B (Firebase ID Token):** If standard JWT Bearer token:
     * Verify token using `admin.auth().verifyIdToken(token)`.
     * Attach standard user context: `{ uid: decoded.uid, email: decoded.email, authType: 'jwt' }`.

---

### 4.3 Admin UI for API Key Management

An "API & Integrations" management panel will be added to the Admin Settings interface in the React frontend:

1. **API Key List Table:**
   * Displays active and revoked keys for the authenticated user/admin.
   * Columns: Key Name, Key Prefix (`lib_live_...4f2a`), Created Date, Last Used Date, Status (Active/Revoked).
   * Actions: Revoke/Delete Key button with confirmation modal.

2. **Create API Key Dialog:**
   * Modal prompting for Key Name (e.g. "Antigravity CLI Automation Key").
   * On submission, invokes tRPC procedure `apiKey.create`.

3. **One-Time Secret Presentation:**
   * Once created, the full raw API key is presented **ONCE** in a secure modal with a copy-to-clipboard button.
   * Explicit security warning: *"Copy this key now. For your security, it will never be displayed again."*

---

### 4.4 External API Signatures & Filter Architecture

The external API exposes three core procedures for library discovery, filtered book querying, and targeted batch metadata enrichment.

#### Filter Representation in OpenAPI & tRPC
To ensure a clean developer experience across both REST (OpenAPI) and tRPC:
* **Query Parameters & Input Schema:** Filters are defined using a unified, extensible Zod object schema grouped under `filters`. In REST, filter fields can be passed as query parameters (e.g., `GET /api/v1/libraries/:libraryId/books?filters.missingMetadata=geo&limit=50`). In tRPC, the exact same Zod schema validates the input object (`{ libraryId: 'lib_123', filters: { missingMetadata: 'geo' } }`).
* **Single Library Target:** All library-scoped endpoints target **exactly one** `libraryId` per request.
* **Extensible Filter Schema:** The `missingMetadata` filter parameter is nested inside `filters`, allowing seamless addition of future search criteria (e.g., `author`, `readingStatus`, `addedAfter`) without breaking the root request signature. The initial `missingMetadata` filter uses a strongly-typed Zod enum matching the 5 core metadata dimensions: `geo`, `temporal`, `genre`, `synopsis`, and `coverImage`.
* **Pagination & Cursor Support:** Includes standard `limit` (default 50, max 250) and `cursor` (opaque token) parameters to support deterministic streaming/chunking of large book collections.

---

#### 1. `library.list`
* **Transport / Path:** `GET /api/v1/libraries` (REST) / `trpc.library.list` (tRPC)
* **Description:** Lists all libraries accessible to the authenticated caller (either owned directly or shared via collaborator permissions). Returns both the caller's computed access level for each library (`callerRole`) and the complete collaborator access mapping (`access` map & `ownerId`).
* **Input Schema (Zod):**
  ```typescript
  z.object({})
  ```
* **Output Schema (Zod):**
  ```typescript
  z.object({
    libraries: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        ownerId: z.string(),
        ownerName: z.string().optional(),
        // Represents the authenticated caller's calculated permission level for this library.
        // For API key requests, this resolves to the role of the user who issued the key (ctx.uid).
        callerRole: z.enum(['owner', 'editor', 'viewer']),
        // Map of collaborator email address -> granted role for multi-user sharing
        access: z.record(z.string(), z.enum(['owner', 'editor', 'viewer'])).optional(),
        bookCount: z.number().optional(),
        createdAt: z.string().optional(),
        updatedAt: z.string().optional(),
      })
    ),
  })
  ```
* **Access Control:** Requires authenticated user context (JWT or API Key).

#### 2. `book.list`
* **Transport / Path:** `GET /api/v1/libraries/:libraryId/books` (REST) / `trpc.book.list` (tRPC)
* **Description:** Retrieves books within a specific library (exactly one `libraryId`), supporting optional metadata filters inside the extensible `filters` object.
* **Input Schema (Zod):**
  ```typescript
  z.object({
    libraryId: z.string().min(1).describe('Target library ID (exactly one)'),
    filters: z
      .object({
        missingMetadata: z
          .enum(['geo', 'temporal', 'genre', 'synopsis', 'coverImage'])
          .optional(),
      })
      .optional(),
    limit: z.number().int().min(1).max(250).default(50),
    cursor: z.string().optional(),
  })
  ```
* **Output Schema (Zod):**
  ```typescript
  z.object({
    books: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        author: z.string(),
        isbn: z.string().optional(),
        synopsis: z.string().optional(),
        genre: z.string().optional(),
        coverImage: z.string().optional(),
        geoData: z.record(z.unknown()).optional(),
        temporalData: z.record(z.unknown()).optional(),
        metadataStatus: z.object({
          hasGeo: z.boolean(),
          hasTemporal: z.boolean(),
          hasGenre: z.boolean(),
          hasSynopsis: z.boolean(),
          hasCoverImage: z.boolean(),
        }),
      })
    ),
    nextCursor: z.string().optional(),
  })
  ```
* **Access Control:** Requires authenticated user context (JWT or API Key) and read permission on `libraryId`.

#### 3. `enrichment.trigger`
* **Transport / Path:** `POST /api/v1/libraries/:libraryId/enrichment/trigger` (REST) / `trpc.enrichment.trigger` (tRPC)
* **Description:** Triggers a targeted batch enrichment flow (`geo`, `temporal`, `genre`, `synopsis`, or `coverImage`) for a specific list of book IDs inside exactly one library.
* **Input Schema (Zod):**
  ```typescript
  z.object({
    libraryId: z.string().min(1).describe('Target library ID (exactly one)'),
    bookIds: z.array(z.string().min(1)).min(1).max(250),
    enrichmentType: z.enum(['geo', 'temporal', 'genre', 'synopsis', 'coverImage']),
  })
  ```
* **Output Schema (Zod):**
  ```typescript
  z.object({
    status: z.enum(['success', 'partial_success', 'failed']),
    enrichmentType: z.enum(['geo', 'temporal', 'genre', 'synopsis', 'coverImage']),
    processedCount: z.number(),
    results: z.array(
      z.object({
        bookId: z.string(),
        status: z.enum(['updated', 'failed', 'skipped']),
        data: z.record(z.unknown()).optional(),
        errorCode: z
          .number()
          .int()
          .optional()
          .describe('HTTP status code representing failure mode (e.g., 404, 422, 502, 504, 500)'),
        errorMessage: z
          .string()
          .optional()
          .describe('Detailed human-readable error description for debugging'),
      })
    ),
  })
  ```
* **Item-Level Failure Error Codes:**
  * `404` (**Book Not Found**): The specified `bookId` does not exist within the targeted `libraryId`.
    * *Example:* `errorMessage: "Book 'book_99' not found in library 'lib_123'"`
  * `422` (**Unprocessable Metadata**): Book is missing required preliminary data needed for this specific enrichment type (e.g. missing title/author needed for geo resolution).
    * *Example:* `errorMessage: "Book lacks title and ISBN required for location lookup"`
  * `502` (**Upstream Provider Error**): The external metadata provider (e.g. Google Books, Open Library, Gemini) returned an upstream error.
    * *Example:* `errorMessage: "Geocoding provider returned 502 Bad Gateway"`
  * `504` (**Provider Timeout**): Upstream provider request timed out during extraction.
    * *Example:* `errorMessage: "Gemini synopsis extraction request timed out after 15000ms"`
  * `500` (**Internal Write Error**): Database write failure while saving enriched properties to Firestore.
    * *Example:* `errorMessage: "Firestore document write failed for book 'book_12'"`
* **Access Control:** Requires authenticated user context (JWT or API Key) and write permission on `libraryId`.

---

### 4.5 Release, Testing & Safety Strategy

To deploy this update safely into production without breaking existing web app users or frontend interactions, implementation follows a strict 4-phase rollout:

#### Phase 1: Shared Service Layer Extraction (Zero-Breaking Refactor)
* Extract core logic into `src/services/server/` and Zod schemas into `src/schemas/`.
* Refactor existing tRPC procedures to delegate to these services.
* **Verification:** Run `compile_applet` and `lint_applet` to ensure zero regressions in existing web UI.

#### Phase 2: Auth Stack Extension & Integration Test Suite
* Implement `apiKeyService.ts` and update `createContext` in `src/server/trpc/trpc.ts`.
* Create automated integration verification script (`test-api-key-auth.cjs`) testing:
  1. Valid API Key attaches correct user context.
  2. Invalid/malformed API Key returns 401 Unauthorized.
  3. Revoked API Key returns 401 Unauthorized.
  4. Access denied when user context lacks permission for a specified `libraryId`.
  5. Existing Firebase JWT Bearer authentication continues working unchanged.

#### Phase 3: Admin UI Rollout
* Implement the API Key management component in the Admin Settings UI.
* Test key creation, one-time secret display, key revocation, and last-used timestamp updates.

#### Phase 4: OpenAPI REST Gateway & CLI Verification
* Expose tRPC routers via REST endpoints or `trpc-openapi`.
* Verify external access via `curl` and Antigravity CLI scripts passing `X-API-Key`.

