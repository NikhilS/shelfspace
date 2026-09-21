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
  └── createdAt: Timestamp

/libraries/{libraryId}
  ├── id: string
  ├── name: string
  ├── description: string
  ├── ownerId: string (UID of owner)
  ├── sharedWith: string[] (List of user emails with editor/viewer access)
  ├── isPublic: boolean
  ├── bookCount: number
  ├── createdAt: Timestamp
  ├── updatedAt: Timestamp
  │
  └── /books/{bookId} (Subcollection)
        ├── id: string
        ├── title: string
        ├── author: string
        ├── isbn: string (10 or 13 digits)
        ├── publicationYear: number
        ├── pageCount: number
        ├── coverUrl: string
        ├── genre: string
        ├── subgenres: string[]
        ├── readingStatus: "unread" | "reading" | "read" | "abandoned"
        ├── rating: number (1-5)
        ├── summary: string
        ├── spatialMetadata: { locations: [{ name, lat, lng, type }] }
        ├── temporalMetadata: { eraName, startYear, endYear }
        ├── embedding: number[] (768-dim vector for semantic clustering)
        ├── addedAt: Timestamp
        └── updatedAt: Timestamp

/apiKeys/{keyId}
  ├── id: string
  ├── keyHash: string (SHA-256 hash of plaintext key)
  ├── maskedKey: string ("bk_live_****abcd")
  ├── ownerId: string
  ├── name: string
  ├── permissions: string[]
  ├── lastUsedAt: Timestamp
  └── createdAt: Timestamp
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

## 3. Zod Runtime Validation Schemas

All domain models must have canonical Zod definitions located in `src/schemas/`:

### Book Schema (`src/schemas/book.ts`)
- **Normalized Taxonomy:** Validates primary genre against the controlled taxonomy (`Fiction`, `Non-Fiction`, `Philosophy`, `History`, `Science`, etc.) and permits up to 5 subgenres.
- **ISBN Verification:** Cleans hyphens and validates checksums for ISBN-10 and ISBN-13 via `src/lib/isbn.ts`.
- **Temporal & Spatial Metadata:** Coordinates must validate within physical geographic boundaries:
  $$\text{lat} \in [-90, 90], \quad \text{lng} \in [-180, 180]$$

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
