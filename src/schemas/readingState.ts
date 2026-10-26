import {z} from 'zod';
import {safeIdSchema, safeImageUrlSchema} from './common';

export const bookStatusEnum = z.enum([
  'unset',
  'want_to_read',
  'reading',
  'finished',
  'completed',
  'abandoned',
]);

export const ownershipStatusEnum = z.enum(['owned', 'unowned']);
export type OwnershipStatus = z.infer<typeof ownershipStatusEnum>;

export const geoLocationReferenceSchema = z
  .object({
    name: z.string().max(300),
    adminLevel: z
      .enum([
        'city',
        'state',
        'country',
        'region',
        'City',
        'State',
        'Country',
        'Region',
      ])
      .optional(),
    rationale: z.string().max(2000).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
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
    lastProcessedAt: z.string().max(100).nullable().optional(),
    lastSyncedAt: z.string().max(100).nullable().optional(),
  })
  .strict();

export const clusterCoordinatesSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    clusterId: z.number().optional(),
    clusterName: z.string().max(200).optional(),
  })
  .strict();

/**
 * Deterministic single-lookup key for `/users/{userId}/readingStates/{stateKey}`:
 * - `isbn:<NORMALIZED_ISBN>` when the book has a normalized ISBN (digits and 'X' only).
 * - `bookid:<BOOK_ID>` when the book has no ISBN in the system.
 */
export const readingStateKeySchema = z
  .string()
  .trim()
  .min(6)
  .max(160)
  .regex(
    /^(isbn:[0-9X]{1,64}|bookid:[a-zA-Z0-9_-]{1,128})$/,
    'Reading state key must be isbn:<NORMALIZED_ISBN> or bookid:<BOOK_ID>',
  );

/**
 * Denormalized book metadata snapshot embedded inside a user's reading state document
 * so `/users/{userId}/readingStates` can render the Personal Reading Room in a single query.
 */
export const userReadingStateBookSnapshotSchema = z
  .object({
    title: z.string().max(500),
    author: z.string().max(500),
    isbn: z.string().max(64).optional(),
    cleanIsbn: z.string().max(64).optional(),
    coverUrl: safeImageUrlSchema.optional(),
    publishedDate: z.string().max(100).optional(),
    primaryGenre: z.string().max(200).optional(),
    subgenres: z.array(z.string().max(200)).max(50).optional(),
    series: z.string().max(300).optional(),
    format: z.enum(['physical', 'digital']).optional(),
    synopsis: z.string().max(50000).optional(),
    authorBio: z.string().max(50000).optional(),
    geoMetadata: bookGeoMetadataSchema.optional(),
    temporalMetadata: bookTemporalMetadataSchema.optional(),
    clusterCoordinates: clusterCoordinatesSchema.nullable().optional(),
    libraryId: safeIdSchema.optional(),
    libraryName: z.string().max(200).optional(),
    bookId: safeIdSchema.optional(),
    ownershipStatus: ownershipStatusEnum.optional(),
  })
  .strict();

/**
 * Stored Firestore document schema for `/users/{userId}/readingStates/{stateKey}`.
 * Represents the exact on-disk structure persisted in Firestore.
 */
export const storedUserReadingStateDocSchema = z
  .object({
    id: readingStateKeySchema,
    userId: safeIdSchema,
    keyType: z.enum(['isbn', 'bookid']),
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
    bookSnapshot: userReadingStateBookSnapshotSchema.optional(),
    updatedAt: z.string().max(100).optional(),
  })
  .strict();

/**
 * Hydrated UserReadingState DTO returned to application callers.
 */
export const userReadingStateSchema = storedUserReadingStateDocSchema
  .extend({
    status: bookStatusEnum,
    bookSnapshot: userReadingStateBookSnapshotSchema,
  })
  .strict();

/**
 * Computes the deterministic single-lookup key for `/users/{userId}/readingStates/{stateKey}`.
 * - If the book has a normalized ISBN (digits and 'X' only), returns `isbn:<NORMALIZED_ISBN>`.
 * - Otherwise, returns `bookid:<BOOK_ID>`.
 */
export function computeReadingStateKey(input: {
  isbn?: string | null;
  cleanIsbn?: string | null;
  bookId: string;
}): string {
  const normalizedIsbn = (input.cleanIsbn || input.isbn || '')
    .trim()
    .replace(/[^0-9X]/gi, '')
    .toUpperCase();
  if (normalizedIsbn.length > 0) {
    return `isbn:${normalizedIsbn}`;
  }
  return `bookid:${input.bookId}`;
}

export type GeoLocationReference = z.infer<typeof geoLocationReferenceSchema>;
export type BookGeoMetadata = z.infer<typeof bookGeoMetadataSchema>;
export type BookTemporalMetadata = z.infer<typeof bookTemporalMetadataSchema>;
export type ClusterCoordinates = z.infer<typeof clusterCoordinatesSchema>;
export type UserReadingStateBookSnapshot = z.infer<
  typeof userReadingStateBookSnapshotSchema
>;
export type StoredUserReadingStateDoc = z.infer<
  typeof storedUserReadingStateDocSchema
>;
export type UserReadingState = z.infer<typeof userReadingStateSchema>;
