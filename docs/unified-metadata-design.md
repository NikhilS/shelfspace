# Unified Metadata Layer: Design Document

## 1. Overview
The application currently treats various metadata enrichments (Geo, Temporal, Genres, Embeddings, Insights) as disjointed capabilities. When a book is processed or backfilled, manual orchestration and varying API signatures are used for each data type.

This design document proposes a unified layer that abstracts metadata fetching and storing into a generic interface, managed by a central registry.

## 2. Goals
- **Standardization**: Give every metadata source (Google Books, Wikipedia, Gemini batch methods) a consistent interface.
- **Extensibility**: Make adding a new metadata type (e.g. "Tropes", "Reading Age") as simple as implementing one class and registering it, without having to hardcode logic into backend routes or React hooks.
- **Bulk Efficiency**: Allow the application to seamlessly switch between single `fetch()` and `bulkFetch()` without changing core business logic.
- **Event-Driven Updates**: Standardize what happens "on book create" vs "on manual backfill".

## 3. Core Architecture

### 3.1 Metadata Types
Define an enum encompassing all current metadata domains. The enum values serve as both the unique identifier representing the type of metadata and the exact field name used in the database schema:
```typescript
export enum MetadataKey {
  GEO = 'geoMetadata',
  TEMPORAL = 'temporalMetadata',
  GENRE = 'genres',
  SYNOPSIS = 'synopsis',
  AUTHOR_BIO = 'authorBio',
  EMBEDDING = 'embeddings',
  SERIES = 'series',
  BASIC_INFO = 'basicInfo' // Google Books / Wikipedia fundamental data
}
```

### 3.2 The Generic Provider Interface
Every metadata domain must implement this interface:

```typescript
export interface CoreBookData {
  id: string; // The unique storage ID for a book in the database, also used to key results in bulk operations
  title: string;
  author: string;
  isbn?: string;
}

export interface IMetadataProvider<T = any> {
  // 1. Identification & Storage Mapping
  // Serves as both the unique identifier for the provider and the exact field name in the database model.
  getKey(): MetadataKey;

  // 2. Data Fetching
  // Fetch metadata for a single book. Return type `T` varies by provider.
  fetch(book: CoreBookData): Promise<T>;

  // Fetch metadata for multiple books, optimizing for batch APIs or parallel limits.
  // Returns a map of Book ID -> Extracted Metadata (T).
  bulkFetch(books: CoreBookData[]): Promise<Record<string, T>>;

  // 3. Configuration
  // Should this metadata type be fetched synchronously/asynchronously the moment a new book is added?
  shouldFetchOnCreate(): boolean;

  // Determines if the provider has all necessary config to run (e.g. valid GEMINI_API_KEY)
  isAvailable(): boolean;
}
```

### 3.3 The Central Registry
An application-level singleton registry where providers are instantiated up front.

```typescript
export class MetadataRegistry {
  private static instance: MetadataRegistry;
  private providers: Map<MetadataKey, IMetadataProvider> = new Map();

  static getInstance(): MetadataRegistry {
    if (!this.instance) this.instance = new MetadataRegistry();
    return this.instance;
  }

  register(provider: IMetadataProvider) {
    this.providers.set(provider.getKey(), provider);
  }

  getProvider(type: MetadataKey): IMetadataProvider | undefined {
    return this.providers.get(type);
  }

  getAllProviders(): IMetadataProvider[] {
    return Array.from(this.providers.values());
  }
}
```

## 4. Application Flow

### 4.1 On Book Addition (Single Event)
Currently, basic Google Books metadata is pulled in an ad-hoc manner. In the new world, adding a book triggers the registry:

1. A new `CoreBookData` object is assembled.
2. `MetadataRegistry.getInstance().getAllProviders()` is called.
3. The system filters for `provider.shouldFetchOnCreate() === true` and `provider.isAvailable() === true`.
4. It fires a `Promise.allSettled()` mapping over `provider.fetch()`.
5. The responses are merged using `provider.getKey()` as the root object path, and one comprehensive save is performed on the database.

### 4.2 Bulk Updating / `useBulkEnrichment`
The `useBulkEnrichment` hook and the bulk processing queue can now be vastly simplified.

1. The user selects a metadata type target (e.g., "Enrich Temporal").
2. The UI queues books lacking that storage key.
3. The backend uses `registry.getProvider(targetType).bulkFetch(books)`.
4. The backend merges the returning `Map<string, T>` onto the corresponding Firebase document IDs in a single batched transaction.

## 5. Current Metadata Map (Implementation Plan)

By observing the current database fields and `gemini` service footprint, we will need to implement the following classes extending `IMetadataProvider`:

- **GeoMetadataProvider**: Wraps `extractBookGeoMetadata` and `extractBookGeoMetadataBatch`.
- **TemporalMetadataProvider**: Wraps `extractBookTemporalMetadataBatch`. (Can simulate `.fetch()` by extracting a batch of 1).
- **GenreMetadataProvider**: Wraps `classifyBooks`.
- **SynopsisMetadataProvider**: Wraps `generateBookInsights(..., 'synopsis')`.
- **AuthorBioMetadataProvider**: Wraps `generateBookInsights(..., 'author_bio')`.
- **EmbeddingMetadataProvider**: Wraps `generateBookEmbeddings`.

## 6. Bulk Fetch Batching, Throttling, and Async Processing Strategy

Given that large libraries can contain hundreds or thousands of books, metadata enrichment operations can easily hit API rate limits or timeout boundaries if executed simultaneously. To protect both our backend infrastructure and external API quotas (e.g. Gemini, Google Books), the `bulkFetch` layer requires a robust batched and throttled execution pipeline.

### Core Utility: `throttledMapWithRetry`

We will rely on a generic async control-flow utility function: `throttledMapWithRetry<T, R>`. This utility will be adopted universally across all non-natively-batched `IMetadataProvider` implementations.

**Key responsibilities of this utility:**
- **Concurrency Control**: It limits the number of active promises running concurrently (e.g., executing exactly `5` concurrent API calls max).
- **Exponential Backoff**: If an API call fails with common transient errors (e.g. 429 Too Many Requests, 500 Internal Server Error), it intercepts the error and re-queues the item with an exponentially increasing delay.
- **Permanent Failure Handling**: If an item exhausts its maximum retry count, the error is logged and the utility gracefully continues processing the rest of the array without blowing up the entire batch operation.

### `IMetadataProvider.bulkFetch` Patterns

Providers will generally fall into one of two implementation patterns for their `bulkFetch` method:

1. **Native Batching (e.g., Gemini Structured Output)**:
   For scenarios like `GeoMetadataProvider` or `TemporalMetadataProvider` that utilize structured JSON payloads in a single prompt to Gemini, the provider will group multiple `CoreBookData` elements and pass them directly to an upstream batch function. Rate limiting here is handled at the network level rather than per-item mapping.

2. **Parallelized Single Fetching (e.g., Synopsis, Author Bio)**:
   For sources that only support single-item queries, providers will internally call their own `.fetch()` method wrapped inside `throttledMapWithRetry()`.
   ```typescript
   async bulkFetch(books: CoreBookData[]): Promise<Record<string, string>> {
     const results: Record<string, string> = {};
     await throttledMapWithRetry(books, 5, async (book) => {
       try {
         const res = await this.fetch(book);
         if (res) {
           results[book.id] = res;
         }
       } catch (error) {
         console.error(`Batch error for ${book.id}:`, error);
       }
     });
     return results;
   }
   ```

### Client-Side Invocation & UI Safety
- The UI hook (`useBulkEnrichment`) orchestrates the overall job by segmenting chunks of books (e.g. 10 or 20 items per HTTP POST) to the server's `bulk` endpoint.
- This creates two layers of protection:
  - **Level 1 (Client)**: Chunks HTTP requests to avoid API Gateway/Cloud Run timeouts (max 60-second execution window).
  - **Level 2 (Server)**: Within that HTTP window, `throttledMapWithRetry` executes the chunk with strict concurrency limits and backoffs, ensuring it safely resolves within the server's compute limits.

## 7. Implementation Considerations
1. **Dependencies Between Providers**: Some providers (Geo, Temporal) perform much better when they have access to a `synopsis`. Since `synopsis` is no longer part of `CoreBookData` and is now its own metadata provider (`MetadataKey.SYNOPSIS`), providers will query the `MetadataRegistry` to fetch their missing dependencies on-demand. For instance, if `TemporalMetadataProvider` requires a synopsis for better accuracy, it will look up `MetadataKey.SYNOPSIS` via the registry and call `.fetch()` on the fly if the book doesn't already have one.
2. **Partial Failures**: If a `bulkFetch` fails midway (or a single book times out), the provider needs to ensure it only returns successful keys in the `Record<string, T>` to avoid overwriting existing data with `null`.
