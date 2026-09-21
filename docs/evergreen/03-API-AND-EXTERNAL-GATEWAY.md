# API Architecture & External Gateway Design

> **Document Status:** Authoritative API & Gateway Standard  
> **Target Path:** `/docs/evergreen/03-API-AND-EXTERNAL-GATEWAY.md`

---

## 1. The Unified Gateway Architecture

To eliminate split-brain security rules and fragmented code paths, **book(ish)** routes 100% of data queries, mutations, and AI enrichment through a unified API Gateway layer running in the Node/Express service.

```
+-----------------------------------------------------------------------------------+
|                                     CLIENTS                                       |
|   [React Web UI]            [External Scripts / CLI]         [Future Mobile Apps] |
+-----------------------+----------------------------------+------------------------+
                        |                                  |
            tRPC HTTP   |                      REST / JSON | (X-API-Key or Bearer)
                        v                                  v
+-----------------------------------------------------------------------------------+
|                         NODE.JS / EXPRESS API GATEWAY (Port 3000)                 |
|                                                                                   |
|  1. Gateway Guards: Rate Limiting, CORS, Body Size Caps (1MB payload ceiling)     |
|  2. Unified Auth Context: TokenVerifier (Firebase JWT) + ApiKeyVerifier (SHA-256) |
|  3. Permission Matrix: Superadmin Check + Library Role (Owner/Editor/Viewer)      |
+-----------------------+----------------------------------+------------------------+
                        |                                  |
         (Internal tRPC)|                   (External REST)|
                        v                                  v
+-------------------------------+  +------------------------------------------------+
|      tRPC v11 Routers         |  |             OpenAPI / Express v1 Router        |
| - libraryApi    - apiKey      |  |  GET    /api/v1/libraries                      |
| - bookApi       - gemini      |  |  POST   /api/v1/libraries/{id}/books           |
| - metadata      - auth/user   |  |  GET    /api/v1/openapi.json (Swagger UI)      |
+-------------------------------+  +------------------------------------------------+
                        |                                  |
                        +-----------------+----------------+
                                          |
                                          v
+-----------------------------------------------------------------------------------+
|                              CLOUD FIRESTORE (Database)                           |
|                       firestore.rules: allow read, write: if false;               |
|            (100% sealed from public browser internet; accessible only via Admin)   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Internal API: tRPC v11 Specification

### Procedure Hierarchy & Authorization Middleware
Every procedure must use the most restrictive builder applicable:

```typescript
// 1. Public Procedure (No credentials required)
publicProcedure.query(...)

// 2. Protected Procedure (Valid Firebase user or valid API key required)
protectedProcedure.query(...)

// 3. Superadmin Procedure (User must belong to the verified admin allowlist)
adminProcedure.mutation(...)

// 4. Library Procedure with Role Check (Validates user has required role on the specific library)
libraryProcedure('owner').mutation(...)  // Owner-only
libraryProcedure('editor').mutation(...) // Owner or Editor
libraryProcedure('viewer').query(...)    // Owner, Editor, or Viewer (Read-only)
```

### Procedure Conventions
1. **Always Validate with Zod:** Every query and mutation must declare an `input(zodSchema)` and preferably an `output(zodSchema)`.
2. **Standardized Error Bubbling:** Use `TRPCError` with semantic codes:
   - `BAD_REQUEST`: Failed input validation or malformed ISBN.
   - `UNAUTHORIZED`: Missing or expired authentication token.
   - `FORBIDDEN`: User authenticated, but lacks permissions for the library.
   - `NOT_FOUND`: Target library or book does not exist.
   - `TOO_MANY_REQUESTS`: Rate limit exceeded.

---

## 3. External API: REST / OpenAPI v1 (`/api/v1`)

The external API allows users, automation scripts, and command-line tools to interact with their libraries programmatically.

### Base URL & Endpoints
All external endpoints are mounted under `/api/v1`:

- `GET /api/v1/openapi.json`: OpenAPI 3.0 specification document.
- `GET /api/v1/docs`: Interactive Swagger UI documentation explorer.
- `GET /api/v1/libraries`: List libraries accessible to the caller.
- `GET /api/v1/libraries/{id}`: Retrieve library metadata.
- `GET /api/v1/libraries/{id}/books`: Paginated list of books with taxonomy filters.
- `POST /api/v1/libraries/{id}/books`: Add a book to the library.
- `GET /api/v1/libraries/{id}/books/{bookId}`: Retrieve a single book volume.
- `PATCH /api/v1/libraries/{id}/books/{bookId}`: Update book metadata or reading status.
- `DELETE /api/v1/libraries/{id}/books/{bookId}`: Remove a book volume.

### Authentication Headers
The external API supports two interchangeable authentication methods:
1. **API Key Header:** `X-API-Key: bk_live_xxxxxxxxxxxxxxxxxxxxxxxx`
2. **Bearer Token:** `Authorization: Bearer <Firebase_ID_Token>`

### API Key Security & Lifecycle
- **Key Generation:** Generated client-side or server-side as high-entropy random strings with prefix (`bk_live_...`).
- **Storage Rule:** Plaintext keys are **NEVER** stored in the database. When an API key is created, compute its SHA-256 hash:
  $$\text{KeyHash} = \text{SHA256}(\text{RawKey})$$
  Store only `keyHash`, `maskedKey` (`bk_live_****1234`), `ownerId`, `name`, and `createdAt`.
- **Verification:** On incoming requests, hash the provided key and query `apiKeys/` by `keyHash`.

---

## 4. Gateway Guards & Rate Limiting

1. **Payload Size Guard:** Request bodies larger than $1\text{MB}$ are rejected with `413 Payload Too Large` to prevent denial-of-wallet memory attacks.
2. **Rate Limiting:**
   - External API Keys: Standard tier capped at $60\text{ req/min}$.
   - Unauthenticated endpoints: $30\text{ req/min}$ per IP.
   - Headers: Return `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After`.
3. **Graceful Error Envelope:**
   ```json
   {
     "error": {
       "code": "FORBIDDEN",
       "message": "You do not have editor access to this library.",
       "details": []
     }
   }
   ```
