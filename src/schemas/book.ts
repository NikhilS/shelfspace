import {z} from 'zod';
import {safeIdSchema, safeUrlSchema} from './common';

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

export const geoLocationReferenceSchema = z.object({
  name: z.string().max(300),
  adminLevel: z.enum(['city', 'state', 'country', 'region']),
  rationale: z.string().max(2000),
  coordinates: z
    .object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    })
    .optional(),
});

export const bookGeoMetadataSchema = z.object({
  isNonEarth: z.boolean(),
  locations: z.array(geoLocationReferenceSchema).max(50),
  lastSyncedAt: z.string().max(100),
});

export const bookTemporalMetadataSchema = z.object({
  isNonHistorical: z.boolean(),
  startYear: z.number().optional(),
  endYear: z.number().optional(),
  eraName: z.string().max(300).optional(),
  rationale: z.string().max(2000).optional(),
  lastProcessedAt: z.string().max(100),
});

export const enrichmentTypeStatusSchema = z.enum([
  'completed',
  'unsupported',
  'failed',
  'pending',
  'in_progress',
  'processing',
  'skipped',
]);

export const bookEnrichmentStatusSchema = z
  .object({
    geo: enrichmentTypeStatusSchema.optional(),
    temporal: enrichmentTypeStatusSchema.optional(),
    genre: enrichmentTypeStatusSchema.optional(),
    synopsis: enrichmentTypeStatusSchema.optional(),
    authorBio: enrichmentTypeStatusSchema.optional(),
    coverImage: enrichmentTypeStatusSchema.optional(),
    series: enrichmentTypeStatusSchema.optional(),
    embedding: enrichmentTypeStatusSchema.optional(),
    lastAttemptedAt: z.string().max(100).optional(),
  })
  .strict();

export const bookDetailsMetadataSchema = z.object({
  hasSynopsis: z.boolean().optional(),
  hasAuthorBio: z.boolean().optional(),
  hasEmbedding: z.boolean().optional(),
  hasDescription: z.boolean().optional(),
  hasClusterCoordinates: z.boolean().optional(),
});

export const clusterCoordinatesSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    clusterId: z.number().optional(),
    clusterName: z.string().max(200).optional(),
  })
  .strict();

export const bookDetailsPayloadSchema = z
  .object({
    synopsis: z.string().max(50000).nullable().optional(),
    authorBio: z.string().max(50000).nullable().optional(),
    embedding: z.array(z.number()).max(4096).nullable().optional(),
    clusterCoordinates: clusterCoordinatesSchema.nullable().optional(),
    description: z.string().max(50000).nullable().optional(),
  })
  .strict();

export const bookReviewRecordSchema = z.object({
  id: safeIdSchema,
  userId: safeIdSchema,
  userName: z.string().max(200),
  rating: z.number().min(1).max(5),
  text: z.string().max(5000),
  createdAt: z.string().max(100).optional(),
});

export const coverCandidateSchema = z.object({
  url: safeUrlSchema.refine(val => val.length > 0, {
    message: 'Cover candidate URL is required',
  }),
  source: z.string().min(1).max(100),
  resolutionTier: z.enum(['ultra', 'high', 'standard']).optional(),
  widthHint: z.number().optional(),
  label: z.string().max(200).optional(),
});

export const bookMutableFieldsSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, 'title cannot be empty')
      .max(500)
      .optional(),
    author: z.string().trim().max(500).optional(),
    isbn: z.string().trim().max(64).optional(),
    coverUrl: safeUrlSchema.optional(),
    coverUrlRaw: safeUrlSchema.optional(),
    publishedDate: z.string().trim().max(100).optional(),
    primaryGenre: z.string().trim().max(200).nullable().optional(),
    subgenres: z.array(z.string().trim().max(200)).max(50).optional(),
    isCustomPrimary: z.boolean().optional(),
    series: z.string().trim().max(300).nullable().optional(),
    format: z.enum(['physical', 'digital']).optional(),
    ownershipStatus: ownershipStatusEnum.optional(),
    userStatuses: z.record(safeIdSchema, bookStatusEnum).optional(),
    userRatings: z.record(safeIdSchema, z.number().min(1).max(5)).optional(),
    status: bookStatusEnum.optional(),
    synopsis: z.string().max(50000).nullable().optional(),
    description: z.string().max(50000).nullable().optional(),
    authorBio: z.string().max(50000).nullable().optional(),
    embedding: z.array(z.number()).max(4096).nullable().optional(),
    embeddings: z.array(z.number()).max(4096).nullable().optional(),
    clusterCoordinates: clusterCoordinatesSchema.nullable().optional(),
    geoMetadata: z.any().optional(),
    temporalMetadata: z.any().optional(),
    enrichmentStatus: bookEnrichmentStatusSchema.optional(),
    bookDetailsMetadata: bookDetailsMetadataSchema.optional(),
    heavyDetails: bookDetailsPayloadSchema.optional(),
    heavyData: bookDetailsPayloadSchema.optional(),
    coverCandidates: z.array(coverCandidateSchema).max(50).optional(),
    sources: z.array(z.string().max(100)).max(30).optional(),
    fieldSources: z.record(safeIdSchema, z.string().max(100)).optional(),
    skippedProviders: z.array(z.string().max(100)).max(30).optional(),
  })
  .strict();

export const bookCreateSchema = bookMutableFieldsSchema
  .extend({
    libraryId: safeIdSchema,
    id: safeIdSchema.optional(),
    bookId: safeIdSchema.optional(),
    title: z.string().trim().min(1, 'title is required').max(500),
    author: z.string().trim().max(500).default('Unknown Author'),
    format: z.enum(['physical', 'digital']).optional().default('physical'),
  })
  .strict();

export const bookUpdateSchema = z
  .object({
    libraryId: safeIdSchema,
    bookId: safeIdSchema,
    updates: bookMutableFieldsSchema,
  })
  .strict();

export const bookDeleteSchema = z
  .object({
    libraryId: safeIdSchema,
    bookId: safeIdSchema,
  })
  .strict();

export const bookBatchItemSchema = bookMutableFieldsSchema
  .extend({
    id: safeIdSchema.optional(),
    bookId: safeIdSchema.optional(),
    action: z.enum(['create', 'update', 'delete', 'upsert']).optional(),
    operation: z.enum(['create', 'update', 'delete', 'upsert']).optional(),
  })
  .strict();

export const bookBatchOperationSchema = z
  .object({
    type: z.enum(['create', 'update', 'delete', 'set']),
    bookId: safeIdSchema.optional(),
    data: bookMutableFieldsSchema
      .extend({
        id: safeIdSchema.optional(),
        bookId: safeIdSchema.optional(),
      })
      .strict()
      .optional(),
    heavyData: bookDetailsPayloadSchema.optional(),
    merge: z.boolean().optional(),
  })
  .strict();

export const bookDetailsSchema = z.object({
  title: z.string(),
  author: z.string(),
  isbn: z.string(),
  coverUrl: safeUrlSchema,
  publishedDate: z.string(),
  primaryGenre: z.string().optional(),
  subgenres: z.array(z.string()).optional(),
  isCustomPrimary: z.boolean().optional(),
  series: z.string().optional(),
  synopsis: z.string().optional(),
  authorBio: z.string().optional(),
  format: z.enum(['physical', 'digital']).optional(),
  coverCandidates: z.array(coverCandidateSchema).optional(),
  sources: z.array(z.string()).optional(),
  fieldSources: z.record(z.string(), z.string()).optional(),
  skippedProviders: z.array(z.string()).optional(),
});

export const bookBatchUpsertSchema = z
  .object({
    libraryId: safeIdSchema,
    books: z
      .array(bookBatchItemSchema)
      .max(5000, 'Maximum 5000 books per batch')
      .optional(),
    operations: z
      .array(bookBatchOperationSchema)
      .max(5000, 'Maximum 5000 operations per batch')
      .optional(),
    enrichOnCreate: z.boolean().optional(),
  })
  .strict()
  .refine(
    data =>
      (data.books && data.books.length > 0) ||
      (data.operations && data.operations.length > 0),
    {
      message:
        'Either books or operations array must be provided and non-empty',
    },
  );

export const bookListSchema = z.object({
  libraryId: safeIdSchema,
  filters: z
    .object({
      missingMetadata: z
        .enum([
          'geo',
          'temporal',
          'genre',
          'primaryGenre',
          'synopsis',
          'coverImage',
          'series',
        ])
        .optional(),
      primaryGenre: z.string().max(200).optional(),
      status: bookStatusEnum.optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(2000).optional().default(1000),
  cursor: safeIdSchema.optional(),
});

export const bookMergeDuplicatesSchema = z
  .object({
    libraryId: safeIdSchema,
    survivorBookId: safeIdSchema,
    duplicateBookIds: z
      .array(safeIdSchema)
      .min(1, 'At least one duplicateBookId is required')
      .max(100, 'Maximum 100 duplicateBookIds per merge'),
    mergedFields: z
      .object({
        title: z.string().trim().max(500).optional(),
        author: z.string().trim().max(500).optional(),
        isbn: z.string().trim().max(64).optional(),
        coverUrl: safeUrlSchema.optional(),
        coverUrlRaw: safeUrlSchema.optional(),
        publishedDate: z.string().trim().max(100).optional(),
        primaryGenre: z.string().trim().max(200).optional(),
        subgenres: z.array(z.string().trim().max(200)).max(50).optional(),
        isCustomPrimary: z.boolean().optional(),
        series: z.string().trim().max(300).optional(),
        format: z.enum(['physical', 'digital']).optional(),
        synopsis: z.string().max(50000).optional(),
        authorBio: z.string().max(50000).optional(),
        geoMetadata: z.any().optional(),
        temporalMetadata: z.any().optional(),
      })
      .strict(),
  })
  .strict();

export type CoverCandidate = z.infer<typeof coverCandidateSchema>;
export type BookDetails = z.infer<typeof bookDetailsSchema>;
export type GeoLocationReference = z.infer<typeof geoLocationReferenceSchema>;
export type BookGeoMetadata = z.infer<typeof bookGeoMetadataSchema>;
export type BookTemporalMetadata = z.infer<typeof bookTemporalMetadataSchema>;
export type EnrichmentTypeStatus = z.infer<typeof enrichmentTypeStatusSchema>;
export type BookEnrichmentStatus = z.infer<typeof bookEnrichmentStatusSchema>;
export type BookDetailsMetadata = z.infer<typeof bookDetailsMetadataSchema>;
export type ClusterCoordinates = z.infer<typeof clusterCoordinatesSchema>;
export type BookDetailsPayload = z.infer<typeof bookDetailsPayloadSchema>;
export type BookReviewRecord = z.infer<typeof bookReviewRecordSchema>;

export type BookCreateInput = z.input<typeof bookCreateSchema>;
export type BookUpdateInput = z.infer<typeof bookUpdateSchema>;
export type BookDeleteInput = z.infer<typeof bookDeleteSchema>;
export type BookBatchUpsertInput = z.infer<typeof bookBatchUpsertSchema>;
export type BookListInput = z.input<typeof bookListSchema>;
export type BookMergeDuplicatesInput = z.infer<
  typeof bookMergeDuplicatesSchema
>;
