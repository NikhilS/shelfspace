---
name: bookish-public-api
description: Complete usage guide and LLM skill for calling the Bookish Public REST API (v1) and tRPC endpoints. Teaches AI agents and LLMs how to authenticate, list libraries, query books with filters, trigger AI enrichment, and handle errors.
---

# Bookish Public API: LLM & AI Agent Skill Guide

This document serves as an actionable instruction guide and operational skill specification for **Large Language Models (LLMs)**, **AI Agents**, and **automated CLI tools** to interact with the **Bookish Application Public API**.

---

## 1. System Overview & Base URLs

* **Production Public Base URL:** `https://bookish.ai.studio`
* **Development Base URL:** `https://ais-dev-wmoalwurv757ott2t3spar-577404056751.us-east1.run.app`
* **Protocol & Format:** Standard RESTful HTTP using standard `JSON` payloads (`Content-Type: application/json`).

---

## 2. Authentication Specifications

All requests to `/api/v1/*` endpoints require authentication. The API supports two credential mechanisms:

### Method A: Long-Lived API Key (Recommended for Agents & CLI Tools)
API keys start with the prefix `lib_live_`.

Pass the API key in **either** of the following headers:
* **Option 1 (Header):** `X-API-Key: lib_live_YOUR_KEY_HERE`
* **Option 2 (Bearer Token):** `Authorization: Bearer lib_live_YOUR_KEY_HERE`

### Method B: Firebase JWT Token (For Authenticated User Sessions)
For user-delegated requests, pass a valid Firebase ID Token:
* `Authorization: Bearer <firebase_id_token>`

---

## 3. Endpoints Reference & Schemas

### Endpoint 1: List All Accessible Libraries

Retrieves a list of all libraries owned by or shared with the authenticated user/API key.

* **HTTP Method:** `GET`
* **Path:** `/api/v1/libraries`
* **Headers:**
  ```http
  Authorization: Bearer lib_live_YOUR_KEY
  ```
* **Success Response (`200 OK`):**
  ```json
  [
    {
      "id": "lib_default_123",
      "name": "My Personal Library",
      "description": "Main collection of fiction and history",
      "ownerId": "usr_998877",
      "isPublic": false,
      "access": {
        "user@example.com": "owner"
      },
      "createdAt": "2026-01-15T10:00:00.000Z"
    }
  ]
  ```

---

### Endpoint 2: Get Books in a Library (With Filtering & Pagination)

Retrieves books from a specific library. Supports filtering for books with missing metadata (useful before running enrichment jobs) and cursor pagination.

* **HTTP Method:** `GET`
* **Path:** `/api/v1/libraries/:libraryId/books`
* **Path Parameters:**
  * `libraryId` *(string, required)*: The unique ID of the library (e.g. `lib_default_123`).
* **Query Parameters:**
  * `missingMetadata` *(string, optional)*: Filter for books missing specific fields.
    * Allowed values: `genres`, `publishedDate`, `isbn`, `coverUrl`, `synopsis`
  * `limit` *(integer, optional)*: Number of books to return (Default: `50`, Max: `100`).
  * `cursor` *(string, optional)*: Opaque pagination cursor from a previous response.
* **Example Request URL:**
  `https://bookish.ai.studio/api/v1/libraries/lib_default_123/books?missingMetadata=genres&limit=25`
* **Success Response (`200 OK`):**
  ```json
  {
    "books": [
      {
        "id": "book_abc123",
        "title": "Dune",
        "author": "Frank Herbert",
        "publishedDate": "1965",
        "isbn": "9780441172719",
        "genres": [],
        "coverUrl": null,
        "synopsis": null,
        "addedBy": "usr_998877",
        "createdAt": "2026-02-01T12:00:00.000Z"
      }
    ],
    "nextCursor": "book_abc123"
  }
  ```

---

### Endpoint 3: Trigger Batch AI Enrichment

Triggers background metadata generation or enrichment (genres, synopsis, historical timelines, author bio, or geolocation data) for a list of book IDs.

* **HTTP Method:** `POST`
* **Path:** `/api/v1/libraries/:libraryId/enrichment/trigger`
* **Path Parameters:**
  * `libraryId` *(string, required)*: The target library ID.
* **Request Body (`application/json`):**
  * `bookIds` *(array of strings, required)*: List of book IDs to enrich. Must contain at least 1 item.
  * `enrichmentType` *(string, required)*: The type of enrichment to execute.
    * Allowed values:
      * `"GENRES"` - Auto-detect and suggest book genres
      * `"HISTORICAL_TIMELINE"` - Generate key historical events referenced in the book
      * `"GEOLOCATION_MAP"` - Extract geographic locations and coordinates
      * `"WIKIPEDIA_BIO"` - Fetch author background information
      * `"COMPLETE_AUTOFILL"` - Full metadata autofill (genres, synopsis, cover, dates)
* **Example Payload:**
  ```json
  {
    "bookIds": ["book_abc123", "book_xyz789"],
    "enrichmentType": "GENRES"
  }
  ```
* **Success Response (`200 OK`):**
  ```json
  {
    "success": true,
    "processedCount": 2,
    "results": [
      {
        "bookId": "book_abc123",
        "status": "success",
        "enrichedData": {
          "genres": ["Science Fiction", "Space Opera", "Classics"]
        }
      },
      {
        "bookId": "book_xyz789",
        "status": "success",
        "enrichedData": {
          "genres": ["Historical Fiction", "Mystery"]
        }
      }
    ]
  }
  ```

---

## 4. Operational Playbook for LLM / AI Agents

When an AI Agent is tasked with managing or querying a library, it should follow this sequential execution plan:

```
[Agent Goal]
    │
    ├── Step 1: Discover Available Libraries
    │   └── Send GET /api/v1/libraries
    │   └── Select target `libraryId`
    │
    ├── Step 2: Query Books & Inspect Missing Metadata
    │   └── Send GET /api/v1/libraries/{libraryId}/books?missingMetadata=genres
    │   └── Collect list of `bookIds` requiring update
    │
    └── Step 3: Trigger Enrichment Operation
        └── Send POST /api/v1/libraries/{libraryId}/enrichment/trigger
        └── Verify response status (`success: true`)
```

---

## 5. Ready-to-Use Code & Tool Call Snippets

### A. cURL CLI Commands

```bash
# 1. List Libraries
curl -X GET "https://bookish.ai.studio/api/v1/libraries" \
  -H "X-API-Key: lib_live_YOUR_API_KEY"

# 2. List Books with Missing Genres
curl -X GET "https://bookish.ai.studio/api/v1/libraries/YOUR_LIBRARY_ID/books?missingMetadata=genres&limit=50" \
  -H "X-API-Key: lib_live_YOUR_API_KEY"

# 3. Trigger Batch Genre Enrichment
curl -X POST "https://bookish.ai.studio/api/v1/libraries/YOUR_LIBRARY_ID/enrichment/trigger" \
  -H "X-API-Key: lib_live_YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "bookIds": ["book_1", "book_2"],
    "enrichmentType": "GENRES"
  }'
```

---

### B. Python Agent (`httpx` / `requests`)

```python
import httpx

BASE_URL = "https://bookish.ai.studio"
API_KEY = "lib_live_YOUR_API_KEY"

headers = {
    "X-API-Key": API_KEY,
    "Content-Type": "application/json"
}

def auto_enrich_library(library_id: str):
    with httpx.Client(base_url=BASE_URL, headers=headers) as client:
        # Step 1: Find books missing genres
        res = client.get(f"/api/v1/libraries/{library_id}/books", params={"missingMetadata": "genres"})
        res.raise_for_status()
        books = res.json().get("books", [])
        
        if not books:
            print("No books missing genres found.")
            return

        book_ids = [b["id"] for b in books]
        print(f"Found {len(book_ids)} books needing genre enrichment: {book_ids}")

        # Step 2: Trigger enrichment
        enrich_res = client.post(
            f"/api/v1/libraries/{library_id}/enrichment/trigger",
            json={"bookIds": book_ids, "enrichmentType": "GENRES"}
        )
        enrich_res.raise_for_status()
        print("Enrichment Result:", enrich_res.json())

# Usage
# auto_enrich_library("lib_default_123")
```

---

### C. Node.js / TypeScript (`fetch`)

```typescript
const BASE_URL = 'https://bookish.ai.studio';
const API_KEY = 'lib_live_YOUR_API_KEY';

async function listLibraries() {
  const response = await fetch(`${BASE_URL}/api/v1/libraries`, {
    method: 'GET',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`API Error ${response.status}: ${await response.text()}`);
  }

  const libraries = await response.json();
  console.log('User Libraries:', libraries);
  return libraries;
}
```

---

## 6. Declarative JSON Schema for LLM Function Calling Tools

If integrating this API into an LLM Agent system (e.g. OpenAI Function Calling, Gemini Tools, LangChain, or AutoGen), define the tools using the following JSON Schemas:

```json
[
  {
    "name": "list_libraries",
    "description": "Lists all book libraries accessible by the current user or API key.",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    }
  },
  {
    "name": "get_library_books",
    "description": "Queries books from a library with optional filtering for missing metadata.",
    "parameters": {
      "type": "object",
      "properties": {
        "libraryId": {
          "type": "string",
          "description": "Unique identifier of the library."
        },
        "missingMetadata": {
          "type": "string",
          "enum": ["genres", "publishedDate", "isbn", "coverUrl", "synopsis"],
          "description": "Filter books missing specific metadata fields."
        },
        "limit": {
          "type": "integer",
          "default": 50,
          "description": "Maximum number of books to retrieve (1-100)."
        },
        "cursor": {
          "type": "string",
          "description": "Opaque cursor for retrieving the next page of results."
        }
      },
      "required": ["libraryId"]
    }
  },
  {
    "name": "trigger_book_enrichment",
    "description": "Triggers AI or metadata enrichment on a list of books in a library.",
    "parameters": {
      "type": "object",
      "properties": {
        "libraryId": {
          "type": "string",
          "description": "Unique identifier of the library."
        },
        "bookIds": {
          "type": "array",
          "items": { "type": "string" },
          "description": "List of book IDs to enrich."
        },
        "enrichmentType": {
          "type": "string",
          "enum": ["GENRES", "HISTORICAL_TIMELINE", "GEOLOCATION_MAP", "WIKIPEDIA_BIO", "COMPLETE_AUTOFILL"],
          "description": "Type of enrichment operation to perform."
        }
      },
      "required": ["libraryId", "bookIds", "enrichmentType"]
    }
  }
]
```

---

## 7. Error Handling & Retry Matrix

| HTTP Code | Error Message | Cause / Action for AI Agent |
| :--- | :--- | :--- |
| `401 Unauthorized` | `Unauthorized: Missing API key or Authorization header` | Ensure `X-API-Key` or `Authorization: Bearer` header is present. |
| `401 Unauthorized` | `Unauthorized: Invalid or revoked API key` | The provided API key does not exist or was revoked. Re-issue key. |
| `403 Forbidden` | `Forbidden: Access denied to library` | The user/API key lacks read or write permissions for the library. |
| `404 Not Found` | `Not Found: ...` | Target library or endpoint URL is incorrect. |
| `400 Bad Request` | `Field 'bookIds' must be a non-empty array` | Ensure request payload satisfies JSON schema constraints. |
| `500 Internal Server Error` | `Internal server error...` | Temporary server/database issue. Retry with backoff (1s, 2s, 4s). |

---
