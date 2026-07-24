export enum MetadataKey {
  GEO = 'geoMetadata',
  TEMPORAL = 'temporalMetadata',
  GENRE = 'genres',
  SYNOPSIS = 'synopsis',
  AUTHOR_BIO = 'authorBio',
  EMBEDDING = 'embeddings',
  SERIES = 'series',
  BASIC_INFO = 'basicInfo', // Google Books / Wikipedia fundamental data
  COVER_IMAGE = 'coverUrl', // High-res cover images
}

export interface CoreBookData {
  id: string; // The unique storage ID for a book in the database, also used to key results in bulk operations
  title: string;
  author: string;
  isbn?: string;
}

export interface IMetadataProvider<T = unknown> {
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
