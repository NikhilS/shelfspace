# Backend Architecture & Database Schema

> **Document Status:** Authoritative Backend & Database Specification  
> **Target Path:** `/docs/evergreen/04-BACKEND-AND-DATABASE-SCHEMA.md`

---

## 1. Cloud Firestore Collection Hierarchy

The database follows a hierarchical subcollection structure designed to guarantee relational boundaries and enforce cascade deletions:

```
/users/{userId}
  ├── id: string (Firebase Auth UID)
  ├── email: string
  ├── displayName: string
  ├── photoURL: string
  ├── role: "admin" | "user"
  ├── createdAt: Timestamp
  └── /readingStates/{stateKey} (Subcollection - Pure User-Centric Reading Ledger)
        ├── id: "isbn:<NORMALIZED_ISBN>" | "bookid:<BOOK_ID>" (Deterministic single-lookup key)
        ├── userId: string (Firebase Auth UID)
        ├── keyType: "isbn" | "bookid"
        ├── cleanIsbn?: string (Present when keyType === "isbn")
        ├── bookId?: string (Present when keyType === "bookid")
        ├── libraryId?: string
        ├── status: "unset" | "want_to_read" | "reading" | "finished" | "abandoned"
        ├── rating?: number (1 to 5 stars)
        ├── reviewText?: string
        ├── reviewedAt?: string (ISO-8601 timestamp)
        ├── startedAt?: string (ISO-8601 timestamp)
        ├── finishedAt?: string (ISO-8601 timestamp)
        ├── readStatusReviewedAt?: string (ISO-8601 timestamp when last triaged in Have You Read It)
        ├── bookSnapshot?: { title, author, isbn?, cleanIsbn?, coverUrl?, primaryGenre?, subgenres?, publishedDate?, synopsis?, authorBio?, series?, format?, ownershipStatus?, libraryId?, libraryName?, bookId?, geoMetadata?, temporalMetadata?, clusterCoordinates? }
        └── updatedAt: string (ISO-8601 timestamp)

/libraries/{libraryId}  (Standard collections or deterministic virtual_{userId} personal reading shelf)
  ├── id: string
  ├── name: string
  ├── ownerId: string (UID of owner)
  ├── ownerName: string
  ├── isVirtual?: boolean (true for virtual_{userId} personal reading shelves)
  ├── access: { [email: string]: "owner" | "editor" | "viewer" }
  ├── heroImageUrl: string | null
  ├── bookCount: number
  ├── createdAt: Timestamp / ISO date string
  ├── updatedAt: Timestamp / ISO date string
  │
  ├── /books/{bookId} (Subcollection - Lightweight catalog metadata, free of per-user state)
  │     ├── id: string
  │     ├── title: string
  │     ├── author: string
  │     ├── isbn: string (10 or 13 digits)
  │     ├── cleanIsbn: string (Normalized digits + X for O(1) indexed lookup)
  │     ├── dedupeKey: string (Normalized "title::author")
  │     ├── searchTokens: string[]
  │     ├── publishedDate: string
  │     ├── coverUrl: string
  │     ├── primaryGenre: string
  │     ├── subgenres: string[]
  │     ├── isCustomPrimary: boolean
  │     ├── series: string
  │     ├── format: "physical" | "digital" | "audiobook"
  │     ├── ownershipStatus?: "owned" | "unowned"
  │     ├── geoMetadata: { isNonEarth, lastSyncedAt, locations: [{ name, adminLevel, rationale, coordinates }] }
  │     ├── addedAt: Timestamp / ISO date string
  │     ├── addedBy: string (UID)
  │     └── /reviews/{userId} (Subcollection: deterministic 1-review-per-user social reviews)
  │
  ├── /bookDetails/{bookId} (Subcollection - Heavy semantic data split 1-to-1 with Book)
  │     ├── synopsis: string (Full descriptive text, up to 32KB)
  │     ├── authorBio: string
  │     ├── clusterCoordinates: { x: number, y: number }
  │     └── embedding: number[] (Semantic vector embedding for clustering)
  │
  ├── /allowedDuplicates/{allowedId} (Subcollection: dismissed duplicate book groupings)
  └── /jobs/{jobId} (Subcollection: background processing task progress)

/geolocationCache/{locationKey}
  ├── locationName: string
  ├── coordinates: { lat: number, lng: number }
  └── createdAt: Timestamp / ISO date string

/appSettings
  ├── /allowlist/users/{email}: { email, role: "admin" | "user", hasAiPlan?: boolean, grantedAt, grantedBy }
  └── /waitlist/entries/{email}: { email, displayName, photoURL, status: "pending" | "approved" | "rejected", requestedAt }
```

---

## 2. The Core Data Invariants & "Dirty Dozen" Defense

Because Firestore is accessed via `firebase-admin` on the server, the backend TypeScript layer must strictly enforce all relational and security invariants:

| Invariant | Attack / Failure Mode | Backend Defense |
| :--- | :--- | :--- |
| **No Orphaned Books** | Creating books under a non-existent `libraryId`. | Verify parent library exists prior to inserting books. |
| **Immutable Ownership** | Changing `ownerId` during library update. | Strip `ownerId` from update schemas; only owner can delete the library. |
| **Shadow Field Injection** | Inserting hidden fields (e.g. `{ isAdmin: true }`). | Parse all payloads with strict Zod schemas (`z.object(...).strict()`). |
| **Denial of Wallet** | Uploading $10\text{MB}$ title or summary string. | Max string length bounds: `title: z.string().min(1).max(300)`. |
| **Duplicate ID Bombing** | Submitting arrays of 50,000 duplicate IDs. | Array length bounds: `z.array(...).max(500)`. |
| **Type Poisoning** | Setting dates/timestamps as booleans or raw numbers. | Parse with `z.coerce.date()` and write as Firestore `Timestamp`. |
| **Subcollection Leaks** | Reading books from unshared libraries. | Mandatory ABAC verification before constructing Firestore subcollection query. |

---

## 3. Architecture/Data Models

> **Module Note (`src/lib/schema.ts` → `src/schemas/`):** What is conceptually referred to as the unified schema layer (`src/lib/schema.ts`) is partitioned by domain inside `src/schemas/` (`common.ts`, `book.ts`, `readingState.ts`, `libraryApi.ts`, `waitlist.ts`, `geolocation.ts`, and `schemaCompliance.ts`). Under our Single-Barrel / No-Sibling-Shim rule ([`06-CODEBASE-STRUCTURE-AND-CONVENTIONS.md`](./06-CODEBASE-STRUCTURE-AND-CONVENTIONS.md)), always import schemas and validators directly from their domain module in `src/schemas/`.

### 3.1 Three-Layer Schema Taxonomy (100% Read/Write Compliance)

All 10 persisted collections and disk caches have canonical `.strict()` Zod definitions located in `src/schemas/` and enforce a strict three-layer separation between:
1. **Stored Document Schemas (`stored*DocSchema` / `Stored*Doc`):** The exact on-disk shape persisted in Cloud Firestore or local cache files, validated on every read and write.
2. **Mutation & API Input Schemas (`*InputSchema`):** Strictly bounded request payloads accepted by tRPC v11 procedures (stripping immutable server-owned fields like `ownerId` or `createdAt`).
3. **Hydrated Client DTOs (`src/types/`):** The domain models returned to the React application after server-side partitioning or ledger overlay (for example, merging `StoredBookDoc` + `StoredBookDetailsDoc` + the caller's `StoredUserReadingStateDoc`).

| Domain Entity / Store | Stored Document Schema (`src/schemas/` / `src/lib/schema.ts` layer) | Typed Firestore Converter (`src/server/`) | Hydrated Client DTO (`src/types/`) |
| :--- | :--- | :--- | :--- |
| **User Reading State** (`/users/{uid}/readingStates/{key}`) | `storedUserReadingStateDocSchema` (`src/schemas/readingState.ts`) | `readingStateConverter` (`readingStateLedger.ts`) | `UserReadingState` |
| **Book Catalog** (`/libraries/{id}/books/{bookId}`) | `storedBookDocSchema` (`src/schemas/book.ts`) | `bookDocConverter` & `BookPartitioner` (`bookPartitioner.ts`) | `Book` (merges `StoredBookDoc` + `StoredBookDetailsDoc` + overlaid `UserReadingState`) |
| **Heavy Book Details** (`/libraries/{id}/bookDetails/{bookId}`) | `storedBookDetailsDocSchema` (`src/schemas/book.ts`) | `bookDetailsDocConverter` & `BookPartitioner` (`bookPartitioner.ts`) | `BookDetailsPayload` |
| **Book Review** (`/books/{bookId}/reviews/{userId}`) | `storedReviewDocSchema` (`src/schemas/book.ts`) | `reviewDocConverter` (`bookReviewService.ts`) | `BookReviewRecord` |
| **Library** (`/libraries/{libraryId}`) | `storedLibraryDocSchema` (`src/schemas/libraryApi.ts`) | `libraryDocConverter` (`libraryCrudService.ts`) | `Library` / `LibraryApiRecord` |
| **Allowed Duplicates** (`/libraries/{id}/allowedDuplicates/{groupId}`) | `storedAllowedDuplicateDocSchema` (`src/schemas/libraryApi.ts`) | `allowedDuplicateConverter` (`librarySpruceService.ts`) | `StoredAllowedDuplicateDoc` |
| **User Profile** (`/users/{userId}`) | `storedUserProfileDocSchema` (`src/schemas/libraryApi.ts`) | `userProfileConverter` (`userService.ts`) | `UserProfile` |
| **Access Allowlist** (`/appSettings/allowlist/users/{email}`) | `storedAllowlistUserDocSchema` (`src/schemas/waitlist.ts`) | `allowlistDocConverter` (`allowlistService.ts`) | `StoredAllowlistUserDoc` |
| **Access Waitlist** (`/appSettings/waitlist/entries/{email}`) | `storedWaitlistEntryDocSchema` (`src/schemas/waitlist.ts`) | `waitlistDocConverter` (`waitlistService.ts`) | `WaitlistEntry` |
| **Geolocation Cache** (`/geolocationCache/{slug}` & `.cache/geocache.json`) | `storedGeolocationCacheDocSchema` & `diskGeolocationCacheSchema` (`src/schemas/geolocation.ts`) | `geolocationCacheConverter` (`geolocation.ts`) | `GeolocationCoordinates` |

---

### 3.2 How to Use the Schemas (`src/lib/schema.ts` / `src/schemas/`)

#### Defining or Extending a Stored Document Schema
Every persisted document schema in `src/schemas/` must:
- Use `z.object({...}).strict()` so unknown keys are rejected immediately.
- Bound every string (`.min()` / `.max()`), number (`.min()` / `.max()`), and array (`.max()`) to prevent Denial-of-Wallet payloads.
- Reuse shared security primitives from `src/schemas/common.ts` (`safeIdSchema`, `safeEmailSchema`, `safeUrlSchema`) and date/metadata primitives from `src/schemas/book.ts` (`firestoreDateSchema`, `bookGeoMetadataSchema`, `bookTemporalMetadataSchema`).
- Register the stored schema in `STORED_DOCUMENT_SCHEMAS` and provide a typed `buildValidStored*Fixture` helper in `src/schemas/schemaCompliance.ts`.

```typescript
import {z} from 'zod';
import {safeIdSchema} from './common';
import {firestoreDateSchema} from './book';

export const storedAllowedDuplicateDocSchema = z
  .object({
    id: safeIdSchema,
    bookIds: z.array(safeIdSchema).min(2).max(50),
    createdAt: firestoreDateSchema.optional(),
    updatedAt: firestoreDateSchema.optional(),
  })
  .strict();

export type StoredAllowedDuplicateDoc = z.infer<
  typeof storedAllowedDuplicateDocSchema
>;
```

#### Shared Runtime Validation Helpers (`src/schemas/common.ts`)
Never call raw `.parse()` without context or cast Firestore data with `as`. Always use the three context-aware validation helpers in `src/schemas/common.ts`:

1. **`validateIncomingApiData(schema, data, context)`**: Validates external or client-supplied payloads before business logic runs. Throws a `SchemaValidationError` with structured `issues` (`path`, `message`, `code`) on failure.
2. **`validateFirestoreReadPayload(schema, data, context)`**: Used inside `fromFirestore` converters (and disk cache loaders) to validate every raw document snapshot against its `stored*DocSchema` (`.strict()`). Throws a `SchemaValidationError` immediately if a stored document is malformed or contains unexpected legacy/shadow fields.
3. **`validateFirestoreWritePayload(schema, payload, context)`**: Used inside `toCreatePayload` / `toUpdatePayload` / `toFirestoreWrite` converter methods prior to calling `.set()` or `.update()`. Automatically strips `firebase-admin/firestore` `FieldValue` sentinels (`FieldValue.serverTimestamp()`, `FieldValue.delete()`, `FieldValue.increment()`, `FieldValue.arrayUnion()`) and dot-notation keys on a validation clone before running `.strict()` validation (`strict: true` by default), while returning the original sentinel-bearing payload for Firestore persistence.

#### Using Schema-Validated Fixtures in Tests (`src/schemas/schemaCompliance.ts`)
Because `fromFirestore` enforces strict Zod validation on every read, unit and integration tests that mock Firestore `doc.data()` snapshots must return schema-compliant payloads. Always construct mock documents using the typed fixture builders in `src/schemas/schemaCompliance.ts`:

```typescript
import {
  buildValidStoredBookFixture,
  buildValidStoredLibraryFixture,
} from '../../schemas/schemaCompliance';

const mockLibrary = buildValidStoredLibraryFixture({
  id: 'lib-1',
  name: 'Archival Collection',
  ownerId: 'user-1',
});

const mockBook = buildValidStoredBookFixture({
  id: 'book-1',
  title: 'The Making of the English Working Class',
  author: 'E. P. Thompson',
});
```

---

### 3.3 The Firestore Converter Patterns

Every server service that reads or writes to `getAdminDb()` must encapsulate serialization, timestamp normalization, and strict Zod validation inside a dedicated `*Converter` object. Direct `doc.data() as SomeType` casts and unvalidated `docRef.set(...)` / `docRef.update(...)` calls are forbidden.

#### Canonical Converter Structure (`fromFirestore`, `toCreatePayload`, `toUpdatePayload`)

1. **Read Path (`fromFirestore`):**
   - Normalize Firestore `Timestamp` instances (`toDate().toISOString()`) via `normalizeFirestoreTimestamp`.
   - Inject the canonical document `id` / `uid` from the snapshot reference and strip `undefined` keys.
   - Pass the candidate object through `validateFirestoreReadPayload(stored*DocSchema, candidate, {entity, documentPath, operation: 'read'})`.
2. **Create / Upsert Path (`toCreatePayload` / `toFirestoreWrite`):**
   - Construct the write payload, attaching server-authoritative fields such as `FieldValue.serverTimestamp()`.
   - Validate the full payload with `validateFirestoreWritePayload(stored*DocSchema, payload, {entity, documentPath, operation: 'create'})`.
3. **Partial Update Path (`toUpdatePayload`):**
   - Construct the patch payload (which may include `FieldValue.serverTimestamp()` or `FieldValue.delete()`).
   - Validate against `stored*DocSchema.partial()` via `validateFirestoreWritePayload(stored*DocSchema.partial(), payload, {entity, documentPath, operation: 'update'})`.

```typescript
import {FieldValue} from 'firebase-admin/firestore';
import {
  validateFirestoreReadPayload,
  validateFirestoreWritePayload,
} from '../../schemas/common';
import {
  storedUserProfileDocSchema,
  type UserProfile,
} from '../../schemas/libraryApi';
import {normalizeFirestoreTimestamp} from './book/bookPartitioner';

export const userProfileConverter = {
  toCreatePayload(user: {
    uid: string;
    email?: string;
    displayName?: string;
    photoURL?: string;
  }) {
    const payload = {
      uid: user.uid,
      email: user.email || '',
      displayName: user.displayName || '',
      photoURL: user.photoURL || '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(storedUserProfileDocSchema, payload, {
      entity: 'StoredUserProfileDoc',
      documentPath: `/users/${user.uid}`,
      operation: 'create',
    });
    return payload;
  },

  toUpdatePayload(
    uid: string,
    patch: {email?: string; displayName?: string; photoURL?: string},
  ) {
    const payload = {
      ...patch,
      updatedAt: FieldValue.serverTimestamp(),
    };
    validateFirestoreWritePayload(
      storedUserProfileDocSchema.partial(),
      payload,
      {
        entity: 'StoredUserProfileDoc',
        documentPath: `/users/${uid}`,
        operation: 'update',
      },
    );
    return payload;
  },

  fromFirestore(uid: string, raw: Record<string, unknown>): UserProfile {
    const candidate: Record<string, unknown> = {
      ...raw,
      uid,
      createdAt: normalizeFirestoreTimestamp(raw.createdAt),
      updatedAt: normalizeFirestoreTimestamp(raw.updatedAt),
    };
    for (const key of Object.keys(candidate)) {
      if (candidate[key] === undefined) {
        delete candidate[key];
      }
    }
    return validateFirestoreReadPayload(storedUserProfileDocSchema, candidate, {
      entity: 'StoredUserProfileDoc',
      documentPath: `/users/${uid}`,
      operation: 'read',
    });
  },
};
```

#### Specialized Multi-Collection Converter Patterns
- **Partitioned Book Persistence (`BookPartitioner` in `src/server/services/book/bookPartitioner.ts`):** Splits a single domain `Book` into lightweight catalog metadata (`storedBookDocSchema` at `/libraries/{libraryId}/books/{bookId}`, including computed index fields `cleanIsbn`, `dedupeKey`, and `searchTokens`) and heavy semantic details (`storedBookDetailsDocSchema` at `/libraries/{libraryId}/bookDetails/{bookId}` for `synopsis`, `authorBio`, `embedding`, and `clusterCoordinates`). Both partitions are independently validated via `validateFirestoreWritePayload` on write and `validateFirestoreReadPayload` on read before being merged into the client `Book` DTO.
- **User-Centric Reading Ledger (`readingStateConverter` in `src/server/services/book/readingStateLedger.ts`):** Persists per-user reading state at `/users/{userId}/readingStates/{stateKey}` using a deterministic single-lookup key (`isbn:<CLEAN_ISBN>` when the book has an ISBN, or `bookid:<BOOK_ID>` otherwise) and validates both the ledger state and its embedded `bookSnapshot` via `storedUserReadingStateDocSchema`.

---

### 3.4 Why Strict Zod Compliance is Enforced

Because the browser never talks directly to Firestore (`firestore.rules` is permanently locked to `allow read, write: if false;`) and all database operations run through `firebase-admin/firestore` on the server, **Firebase Admin bypasses declarative Firestore security rules**. Strict Zod compliance at both the API gateway and the converter boundary serves as our non-negotiable runtime contract:

1. **Zero-Trust Defense Against Shadow Field Injection & Mass Assignment:**
   Enforcing `.strict()` on every `stored*DocSchema` guarantees that unapproved properties (e.g., `{role: 'admin'}`, `{ownerId: 'attacker'}`, or leaked client-only UI flags) cannot be smuggled into Firestore documents during `.set()` or `.update()` mutations.
2. **Elimination of Silent Schema Drift & Legacy Field Leaks:**
   Validating every read through `validateFirestoreReadPayload` ensures that if a document on disk contains corrupted types, missing required invariants, or deprecated fields (such as legacy per-user reading fields embedded on shared `books/{bookId}` documents), the failure is caught immediately at the converter boundary with an explicit `SchemaValidationError` (`[SchemaValidation] <Entity> (<operation>) at <documentPath> failed validation...`) rather than propagating `NaN`, `undefined`, or leaked cross-user state into React components or Web Workers.
3. **Denial-of-Wallet & Resource Exhaustion Protection:**
   Strict string, numeric, and array bounds on both input and stored schemas prevent oversized embeddings, unbounded synopses, or 50,000-element array bombs from inflating Firestore storage costs or exhausting Node/browser memory.
4. **Seamless Compatibility with Firestore Atomic Sentinels:**
   By stripping `FieldValue` transforms (`serverTimestamp()`, `delete()`, `increment()`, `arrayUnion()`) on an ephemeral clone inside `validateFirestoreWritePayload`, we retain 100% `.strict()` schema checking on domain fields without sacrificing native Firestore atomic operations.
5. **Automated Architectural Regression Enforcement (`src/lib/schema.test.ts` & `src/schemas/schemaCompliance.test.ts`):**
   Our architectural test suites iterate through all 10 Firestore collections, verify converter round-trips (`fromFirestore` / `toFirestore*`) against `STORED_DOCUMENT_SCHEMAS`, reject schema drift on both read and write, and statically scan `src/server/**` to ensure every `getAdminDb()` and `.collection(...)` call maps to a registered strict Zod schema and typed converter.

---

## 4. Background Processing & Cloud Run Scalability

### Multi-Container Statelessness
The application deploys to Google Cloud Run containers that scale from zero to multiple active instances. 
- **Rule:** **Never store stateful job queues in local Node memory.** In-memory arrays or maps will be wiped during cold starts or container auto-scaling.
- **Background Tasks:** Long-running AI enrichments must record their progress in Firestore documents or emit progress chunks back to the client via streaming or polling queries.

### Firestore Batch Limits (The 500-Write Rule)
- Firestore transactions and atomic batches are strictly capped by Google Cloud at **500 operations per commit**.
- When bulk-importing books or performing bulk deletions:
  ```typescript
  // Always chunk operations into batches of <= 400
  const BATCH_SIZE = 400;
  for (let i = 0; i < operations.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = operations.slice(i, i + BATCH_SIZE);
    chunk.forEach((op) => op(batch));
    await batch.commit();
  }
  ```
