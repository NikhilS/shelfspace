import {z} from 'zod';
import type {CanonicalEnrichmentType} from '../types/metadata';
import {
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
  bookMergeDuplicatesSchema,
  bookStatusEnum,
} from './book';
import {safeIdSchema, safeImageUrlSchema, safeUrlSchema} from './common';

export {
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
  bookMergeDuplicatesSchema,
};
export type {CanonicalEnrichmentType};

export const libraryAccessRoleEnum = z.enum(['owner', 'editor', 'viewer']);
export type LibraryAccessRole = z.infer<typeof libraryAccessRoleEnum>;

/**
 * Stored Firestore document schema for `/libraries/{libraryId}`.
 */
export const storedLibraryDocSchema = z
  .object({
    id: safeIdSchema.optional(),
    name: z.string().max(200),
    ownerId: safeIdSchema,
    ownerName: z.string().max(200).optional(),
    access: z.record(z.string(), libraryAccessRoleEnum).optional(),
    collaboratorEmails: z.array(z.string().max(254)).max(200).optional(),
    activeJobId: safeIdSchema.nullable().optional(),
    heroImageUrl: safeImageUrlSchema.nullable().optional(),
    bookCount: z.number().int().min(0).optional(),
    isVirtual: z.boolean().optional(),
    createdAt: z.string().max(100).optional(),
    updatedAt: z.string().max(100).optional(),
  })
  .strict();

export type StoredLibraryDoc = z.infer<typeof storedLibraryDocSchema>;

/**
 * Stored Firestore document schema for `/libraries/{libraryId}/allowedDuplicates/{groupId}`.
 */
export const storedAllowedDuplicateDocSchema = z
  .object({
    id: safeIdSchema.optional(),
    bookIds: z.array(safeIdSchema).min(2).max(100),
    createdAt: z.string().max(100).optional(),
  })
  .strict();

export type StoredAllowedDuplicateDoc = z.infer<
  typeof storedAllowedDuplicateDocSchema
>;

export const enrichmentJobPerBookStageEnum = z.enum([
  'queued',
  'evaluating_decisions',
  'fetching_catalog',
  'fetching_ai',
  'completed',
  'skipped',
  'failed',
]);

export const storedBookJobTelemetrySchema = z
  .object({
    bookId: safeIdSchema,
    stage: enrichmentJobPerBookStageEnum,
    winningProviders: z
      .record(z.string().max(64), z.string().max(100))
      .optional(),
    updatedFields: z.array(z.string().max(64)).max(20).optional(),
    error: z.string().max(500).optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const storedActiveEnrichmentWaveSchema = z
  .object({
    waveNumber: z.number().int().min(1).max(20),
    totalWaves: z.number().int().min(1).max(20),
    tier: z.enum(['decision', 'catalog', 'generative', 'embedding']),
    remainingInWave: z.number().int().nonnegative(),
  })
  .strict();

export const canonicalEnrichmentTypeEnum = z.enum([
  'geo',
  'temporal',
  'genre',
  'synopsis',
  'authorBio',
  'coverImage',
  'series',
  'embedding',
]);

export const enrichmentJobStatusEnum = z.enum([
  'running',
  'cancelling',
  'completed',
  'cancelled',
  'failed',
]);

/**
 * Stored Firestore document schema for `/libraries/{libraryId}/jobs/{jobId}`.
 * Persists active and recent enrichment jobs across stateless Cloud Run replicas.
 */
export const storedEnrichmentJobDocSchema = z
  .object({
    id: safeIdSchema.optional(),
    libraryId: safeIdSchema,
    ownerUid: safeIdSchema.optional(),
    ownerEmail: z.string().max(254).optional(),
    leaseOwnerId: safeIdSchema.optional(),
    leaseExpiresAtMs: z.number().int().nonnegative().optional(),
    enrichmentType: canonicalEnrichmentTypeEnum,
    status: enrichmentJobStatusEnum,
    totalBooks: z.number().int().nonnegative(),
    completedBooks: z.number().int().nonnegative(),
    failedBooks: z.number().int().nonnegative(),
    skippedBooks: z.number().int().nonnegative(),
    overwrite: z.boolean(),
    cancelRequested: z.boolean().optional(),
    pendingBookIds: z.array(safeIdSchema).max(5000).optional(),
    customGenres: z.array(z.string().max(200)).max(100).optional(),
    allowAiFallback: z.boolean().optional(),
    activeWave: storedActiveEnrichmentWaveSchema.optional(),
    perBookStates: z
      .record(safeIdSchema, storedBookJobTelemetrySchema)
      .optional(),
    startedAt: z.number().int().nonnegative(),
    completedAt: z.number().int().nonnegative().optional(),
    updatedAtMs: z.number().int().nonnegative(),
    updatedAt: z.string().max(100).optional(),
  })
  .strict();

export type StoredEnrichmentJobDoc = z.infer<
  typeof storedEnrichmentJobDocSchema
>;

/**
 * Stored Firestore document schema for `/users/{userId}`.
 */
export const storedUserProfileDocSchema = z
  .object({
    uid: safeIdSchema,
    email: z.string().max(254).optional(),
    displayName: z.string().max(120).optional(),
    photoURL: safeUrlSchema.optional(),
    createdAt: z.string().max(100).optional(),
    updatedAt: z.string().max(100).optional(),
  })
  .strict();

export type StoredUserProfileDoc = z.infer<typeof storedUserProfileDocSchema>;
export type UserProfile = StoredUserProfileDoc;

export const libraryScopeSchema = z.enum(['owned', 'shared', 'all']);
export type LibraryScope = z.infer<typeof libraryScopeSchema>;

export const libraryListSchema = z
  .object({
    scopes: z
      .array(libraryScopeSchema)
      .max(3)
      .optional()
      .default(['owned', 'shared']),
  })
  .optional()
  .default({scopes: ['owned', 'shared']});

export const bookListSchema = z.object({
  libraryId: safeIdSchema,
  filters: z
    .object({
      missingMetadata: canonicalEnrichmentTypeEnum.optional(),
      primaryGenre: z.string().max(200).optional(),
      status: bookStatusEnum.optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(250).optional().default(50),
  cursor: safeIdSchema.optional(),
});

export const enrichmentTriggerSchema = z.object({
  libraryId: safeIdSchema,
  enrichmentType: canonicalEnrichmentTypeEnum,
  bookIds: z.array(safeIdSchema).min(1).max(100),
  overwrite: z.boolean().optional().default(false),
  customGenres: z.array(z.string().max(200)).max(100).optional(),
});

export const enrichmentStartJobSchema = z.object({
  libraryId: safeIdSchema,
  enrichmentType: canonicalEnrichmentTypeEnum,
  bookIds: z.array(safeIdSchema).min(1).max(5000),
  overwrite: z.boolean().optional().default(false),
  customGenres: z.array(z.string().max(200)).max(100).optional(),
});

export const enrichmentCancelJobSchema = z.object({
  libraryId: safeIdSchema,
  jobId: safeIdSchema.optional(),
});

export const enrichmentJobStatusSchema = z.object({
  libraryId: safeIdSchema,
});

export const enrichmentAuditCoversSchema = z.object({
  libraryId: safeIdSchema,
  enableVisualAudit: z.boolean().optional(),
});

export const duplicateAdjudicationCandidateSchema = z.object({
  id: safeIdSchema,
  title: z.string().trim().min(1).max(500),
  author: z.string().max(300).optional(),
  isbn: z.string().max(40).optional(),
  series: z.string().max(300).optional(),
  publishedDate: z.string().max(60).optional(),
  pageCount: z.number().int().min(0).max(50000).optional(),
  hasCover: z.boolean().optional(),
  hasSynopsis: z.boolean().optional(),
});

export const enrichmentAdjudicateDuplicatesSchema = z.object({
  libraryId: safeIdSchema,
  groups: z
    .array(
      z.object({
        groupKey: z.string().trim().min(1).max(2048),
        books: z.array(duplicateAdjudicationCandidateSchema).min(2).max(12),
      }),
    )
    .min(1)
    .max(50),
});

export const libraryResetMetadataSchema = z.object({
  libraryId: safeIdSchema,
  metadataType: canonicalEnrichmentTypeEnum,
});

export const libraryUploadImageSchema = z.object({
  libraryId: safeIdSchema,
  path: z
    .string()
    .trim()
    .min(1, 'path is required')
    .max(300, 'path exceeds maximum length')
    .refine(
      val => !val.includes('..') && !val.includes('//') && !val.includes('\\'),
      'Invalid storage path',
    ),
  base64Data: z
    .string()
    .min(1, 'base64Data is required')
    .max(10 * 1024 * 1024, 'Image payload exceeds maximum allowed size'),
});
