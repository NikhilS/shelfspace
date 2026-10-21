# API Architecture & Gateway Design

> **Document Status:** Authoritative API & Gateway Standard  
> **Target Path:** `/docs/evergreen/03-API-AND-EXTERNAL-GATEWAY.md`

---

## 1. The Unified tRPC Gateway Architecture

To eliminate split-brain security rules and redundant REST wrappers, **book(ish)** routes 100% of data queries, mutations, and AI enrichment through a unified tRPC v11 Gateway running in the Node/Express service, complemented by a dedicated Server-Sent Events (SSE) progress stream.

```
+-----------------------------------------------------------------------------------+
|                                BOOK(ISH) WEB CLIENT                               |
|   [React 19 + TanStack Query + tRPC Client]          [EventSource SSE Progress]   |
+-----------------------+----------------------------------+------------------------+
                        |                                  |
            tRPC HTTP   | (Bearer Firebase JWT)            | GET /api/enrichment/stream
                        v                                  v
+-----------------------------------------------------------------------------------+
|                         NODE.JS / EXPRESS API GATEWAY (Port 3000)                 |
|                                                                                   |
|  1. Gateway Guards: Security Headers, Rate Limiting, Scoped Body Size Caps        |
|  2. Single-Path Auth Context: TokenVerifier (Firebase Admin ID Token JWT)         |
|  3. Permission Matrix: Platform Allowlist + Library Role (Owner/Editor/Viewer)    |
+-----------------------+----------------------------------+------------------------+
                        |                                  |
                        v                                  v
+-----------------------------------------------+  +--------------------------------+
|               tRPC v11 AppRouter              |  |     SSE Enrichment Stream      |
| - library       - metadata                    |  |  Real-time job snapshots and   |
| - book          - gemini                      |  |  item progress events          |
| - enrichment    - auth / user                 |  |                                |
+-----------------------+-----------------------+  +---------------+----------------+
                        |                                          |
                        +--------------------+---------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------+
|                   CLOUD FIRESTORE & CLOUD STORAGE (Admin SDK Only)                |
|  - Accessed exclusively by the Node.js server via firebase-admin                  |
|  - Client & direct SDK access sealed (firestore.rules & storage.rules: if false)  |
+-----------------------------------------------------------------------------------+
```

---

## 2. tRPC v11 Specification

### Procedure Hierarchy & Authorization Middleware
Every procedure must use the most restrictive builder applicable:

```typescript
// 1. Public Procedure (No credentials required)
publicProcedure.query(...)

// 2. Authenticated Procedure (Valid Firebase JWT required; used pre-allowlist for waitlist status/join)
authenticatedProcedure.query(...)

// 3. Protected Procedure (Valid Firebase JWT + verified allowlist membership required)
protectedProcedure.query(...)

// 4. AI Protected Procedure (Protected + requires caller to have an active AI Plan or Admin role)
aiProtectedProcedure.mutation(...)

// 5. Administrator Procedure (Caller must belong to the verified admin allowlist)
adminProcedure.mutation(...)

// 6. Library Procedure with Role Check (Validates caller has required role on the target library)
libraryProcedure('owner').mutation(...)  // Owner-only
libraryProcedure('editor').mutation(...) // Owner or Editor
libraryProcedure('viewer').query(...)    // Owner, Editor, or Viewer (Read-only)
```

### Procedure Conventions
1. **Always Validate with Zod:** Every query and mutation must declare an `input(zodSchema)` using hardened primitives (`safeIdSchema`, `safeUrlSchema`, `safeEmailSchema`) and strict object schemas.
2. **Request-Isolated Library Access:** `libraryProcedure` captures resolved library metadata and caller roles via `AsyncLocalStorage` (`captureLibraryAccess`), eliminating global mutable caches across concurrent requests.
3. **Standardized Error Bubbling:** Use `TRPCError` with semantic codes:
   - `BAD_REQUEST`: Failed input validation or malformed identifier/ISBN.
   - `UNAUTHORIZED`: Missing or expired Firebase ID Token (`Bearer <JWT>`).
   - `FORBIDDEN`: User authenticated, but lacks allowlist membership or required library role.
   - `NOT_FOUND`: Target library or book does not exist.
   - `TOO_MANY_REQUESTS`: Rate limit exceeded.

---

## 3. Gateway Guards & Rate Limiting

1. **Payload Size Guards:**
   - Default JSON/URL-encoded request bodies are capped at `2MB`.
   - Base64 image vision and upload endpoints (`gemini.extractBooksFromImage`, `library.uploadImage`) use a scoped `15MB` parser with a `5MB` decoded binary buffer cap and raster magic-byte verification.
2. **Sliding-Window Rate Limiting:**
   - `/trpc`: $300\text{ req/min}$ per authenticated user/IP.
   - `/api/enrichment/stream`: $30\text{ req/min}$ per user/IP and max $5$ concurrent SSE streams per user.
   - `/api/client-log`: $20\text{ req/min}$ per IP.
   - Emits `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers on `429 Too Many Requests`.
3. **Log Sanitization & Token Redaction:**
   - Query parameters containing tokens (`?token=...`) are redacted (`[REDACTED]`) before HTTP access logs are written.
   - Client error logs strip control characters (`\r`, `\n`, ANSI escapes) and enforce strict field truncation.
