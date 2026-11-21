import {z} from 'zod';
import {safeIdSchema, safeImageUrlSchema} from './common';

export const bookStatusEnum = z.enum([
  'unset',
  'want_to_read',
  'reading',
  'finished',
  'abandoned',
]);

export const ownershipStatusEnum = z.enum(['owned', 'unowned']);
export type OwnershipStatus = z.infer<typeof ownershipStatusEnum>;

export const geoLocationReferenceSchema = z
  .object({
    name: z.string().max(300),
    adminLevel: z.enum(['city', 'state', 'country', 'region']).optional(),
    rationale: z.string().max(2000).optional(),
    coordinates: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })
      .strict()
      .optional(),
  })
  .strict();

export const bookGeoMetadataSchema = z
  .object({
    isNonEarth: z.boolean().optional(),
    locations: z.array(geoLocationReferenceSchema).max(50).optional(),
    lastSyncedAt: z.string().max(100).optional(),
  })
  .strict();

export const bookTemporalMetadataSchema = z
  .object({
    isNonHistorical: z.boolean().optional(),
    startYear: z.number().nullable().optional(),
    endYear: z.number().nullable().optional(),
    eraName: z.string().max(300).nullable().optional(),
    rationale: z.string().max(2000).nullable().optional(),
    lastSyncedAt: z.string().max(100).nullable().optional(),
  })
  .strict();

export const clusterCoordinatesSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    clusterId: z.number().optional(),
    clusterName: z.string().max(200).optional(),
    clusterThesis: z.string().max(600).optional(),
  })
  .strict();

export const readingStateKeyTypeEnum = z.enum(['book', 'ext']);
export type ReadingStateKeyType = z.infer<typeof readingStateKeyTypeEnum>;

/**
 * Deterministic stable lookup key for `/users/{userId}/readingStates/{stateKey}`:
 * - `book:<LIBRARY_ID>:<BOOK_ID>` for library-backed books (immutable across ISBN edits/enrichment).
 * - `ext:<IDENTIFIER>` for standalone unowned external editions without a library book record.
 */
export const readingStateKeySchema = z
  .string()
  .trim()
  .min(5)
  .max(280)
  .regex(
    /^(book:[a-zA-Z0-9_-]{1,128}:[a-zA-Z0-9_-]{1,128}|ext:[a-zA-Z0-9_-]{1,128})$/,
    'Reading state key must be book:<LIBRARY_ID>:<BOOK_ID> or ext:<IDENTIFIER>',
  );

/**
 * Accepts either a standard Firestore document ID (`safeIdSchema`) or a deterministic
 * reading state key (`book:...` or `ext:...`).
 */
export const safeBookOrStateIdSchema = z.union([
  safeIdSchema,
  readingStateKeySchema,
]);

/**
 * Slim `< 2KB` fallback book metadata stub embedded inside a user's reading state document.
 * Heavy prose (`synopsis`, `authorBio`), `subgenres`, `geoMetadata`, `temporalMetadata`, and
 * `clusterCoordinates` are strictly excluded and hydrated live from `/libraries/{libId}/books/{bookId}`.
 */
export const minimalBookStubSchema = z
  .object({
    title: z.string().max(300),
    author: z.string().max(300),
    isbn: z.string().max(64).optional(),
    cleanIsbn: z.string().max(64).optional(),
    coverUrl: safeImageUrlSchema.optional(),
    publishedDate: z.string().max(100).optional(),
    primaryGenre: z.string().max(200).optional(),
    series: z.string().max(200).optional(),
    format: z.enum(['physical', 'digital']).optional(),
    libraryId: safeIdSchema.optional(),
    libraryName: z.string().max(200).optional(),
    bookId: safeIdSchema.optional(),
    ownershipStatus: ownershipStatusEnum.optional(),
  })
  .strict();

export const userReadingStateBookSnapshotSchema = minimalBookStubSchema;

/**
 * Stored Firestore document schema for `/users/{userId}/readingStates/{stateKey}`.
 * Represents the exact on-disk structure persisted in Firestore.
 */
export const storedUserReadingStateDocSchema = z
  .object({
    id: readingStateKeySchema,
    userId: safeIdSchema,
    keyType: readingStateKeyTypeEnum,
    cleanIsbn: z.string().max(64).optional(),
    bookId: safeIdSchema.optional(),
    libraryId: safeIdSchema.optional(),
    status: bookStatusEnum.optional(),
    rating: z.number().min(1).max(5).optional(),
    reviewText: z.string().max(5000).optional(),
    reviewedAt: z.string().max(100).nullable().optional(),
    startedAt: z.string().max(100).nullable().optional(),
    finishedAt: z.string().max(100).nullable().optional(),
    readStatusReviewedAt: z.string().max(100).nullable().optional(),
    bookSnapshot: minimalBookStubSchema.optional(),
    updatedAt: z.string().max(100).optional(),
  })
  .strict();

/**
 * Hydrated UserReadingState DTO returned to application callers.
 */
export const userReadingStateSchema = storedUserReadingStateDocSchema
  .extend({
    status: bookStatusEnum,
    bookSnapshot: minimalBookStubSchema,
  })
  .strict();

const SAFE_SEGMENT_REGEX = /^[a-zA-Z0-9_-]{1,128}$/;

export function resolveReadingStateKeyType(
  stateKey: string,
): ReadingStateKeyType {
  if (stateKey.startsWith('book:')) {
    return 'book';
  }
  return 'ext';
}

/**
 * Computes the deterministic stable key for `/users/{userId}/readingStates/{stateKey}`:
 * - When `libraryId` is present (and not `'external'`) with a valid `bookId`, returns `book:<libraryId>:<bookId>`.
 *   This guarantees ISBN edits or AI enrichment never change the document ID or orphan collaborator reading states.
 * - For standalone external books without a library container, returns `ext:<NORMALIZED_ISBN>` when an ISBN exists,
 *   or `ext:<BOOK_ID>` otherwise.
 * - Idempotent when `bookId` is already a canonical `book:...` or `ext:...` state key.
 */
export function computeReadingStateKey(input: {
  libraryId?: string | null;
  isbn?: string | null;
  cleanIsbn?: string | null;
  bookId: string;
}): string {
  const rawBookId = (input.bookId || '').trim();
  const rawLibraryId = (input.libraryId || '').trim();

  if (rawBookId.startsWith('book:')) {
    const parts = rawBookId.split(':');
    if (
      parts.length === 3 &&
      SAFE_SEGMENT_REGEX.test(parts[1]) &&
      SAFE_SEGMENT_REGEX.test(parts[2])
    ) {
      return rawBookId;
    }
  }

  let extractedBookId = rawBookId;
  let isbnFromBookId = '';

  if (rawBookId.startsWith('ext:')) {
    const extPayload = rawBookId.slice('ext:'.length).trim();
    if (/^[0-9X]{1,64}$/i.test(extPayload)) {
      isbnFromBookId = extPayload;
      extractedBookId = '';
    } else {
      extractedBookId = extPayload;
    }
  }

  if (
    rawLibraryId.length > 0 &&
    rawLibraryId !== 'external' &&
    SAFE_SEGMENT_REGEX.test(rawLibraryId) &&
    extractedBookId.length > 0 &&
    SAFE_SEGMENT_REGEX.test(extractedBookId)
  ) {
    return `book:${rawLibraryId}:${extractedBookId}`;
  }

  const normalizedIsbn = (input.cleanIsbn || input.isbn || isbnFromBookId || '')
    .trim()
    .replace(/[^0-9X]/gi, '')
    .toUpperCase();

  if (normalizedIsbn.length > 0) {
    return `ext:${normalizedIsbn}`;
  }

  const fallbackId = SAFE_SEGMENT_REGEX.test(extractedBookId)
    ? extractedBookId
    : 'unknown_book';
  return `ext:${fallbackId}`;
}

export type GeoLocationReference = z.infer<typeof geoLocationReferenceSchema>;
export type BookGeoMetadata = z.infer<typeof bookGeoMetadataSchema>;
export type BookTemporalMetadata = z.infer<typeof bookTemporalMetadataSchema>;
export type ClusterCoordinates = z.infer<typeof clusterCoordinatesSchema>;
export type MinimalBookStub = z.infer<typeof minimalBookStubSchema>;
export type UserReadingStateBookSnapshot = MinimalBookStub;
export type StoredUserReadingStateDoc = z.infer<
  typeof storedUserReadingStateDocSchema
>;
export type UserReadingState = z.infer<typeof userReadingStateSchema>;
