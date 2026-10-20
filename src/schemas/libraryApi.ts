import {z} from 'zod';
import {
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
  bookMergeDuplicatesSchema,
  bookStatusEnum,
} from './book';
import {safeIdSchema} from './common';

export {
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
  bookMergeDuplicatesSchema,
};

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
      missingMetadata: z
        .enum([
          'geo',
          'temporal',
          'genre',
          'primaryGenre',
          'synopsis',
          'authorBio',
          'coverImage',
          'series',
          'embedding',
          'embeddings',
        ])
        .optional(),
      primaryGenre: z.string().max(200).optional(),
      status: bookStatusEnum.optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(250).optional().default(50),
  cursor: safeIdSchema.optional(),
});

export const enrichmentFlowEnum = z.enum([
  'geo',
  'geoMetadata',
  'temporal',
  'temporalMetadata',
  'genre',
  'primaryGenre',
  'synopsis',
  'authorBio',
  'coverImage',
  'coverUrl',
  'series',
  'embedding',
  'embeddings',
]);

export type RawEnrichmentFlow = z.infer<typeof enrichmentFlowEnum>;
export type CanonicalEnrichmentType =
  | 'geo'
  | 'temporal'
  | 'genre'
  | 'synopsis'
  | 'authorBio'
  | 'coverImage'
  | 'series'
  | 'embedding';

export function normalizeEnrichmentType(raw?: string): CanonicalEnrichmentType {
  switch (raw) {
    case 'geo':
    case 'geoMetadata':
      return 'geo';
    case 'temporal':
    case 'temporalMetadata':
      return 'temporal';
    case 'genre':
    case 'primaryGenre':
      return 'genre';
    case 'synopsis':
      return 'synopsis';
    case 'authorBio':
      return 'authorBio';
    case 'coverImage':
    case 'coverUrl':
      return 'coverImage';
    case 'series':
      return 'series';
    case 'embedding':
    case 'embeddings':
      return 'embedding';
    default:
      return 'genre';
  }
}

export const enrichmentTriggerSchema = z
  .object({
    libraryId: safeIdSchema,
    flow: enrichmentFlowEnum.optional(),
    enrichmentType: enrichmentFlowEnum.optional(),
    bookIds: z.array(safeIdSchema).min(1).max(100),
    overwrite: z.boolean().optional().default(false),
    customGenres: z.array(z.string().max(200)).max(100).optional(),
  })
  .refine(data => Boolean(data.flow || data.enrichmentType), {
    message: 'Either flow or enrichmentType must be provided',
  })
  .transform(data => {
    const normalized = normalizeEnrichmentType(
      data.enrichmentType || data.flow,
    );
    return {
      ...data,
      flow: normalized,
      enrichmentType: normalized,
    };
  });

export const enrichmentStartJobSchema = z
  .object({
    libraryId: safeIdSchema,
    flow: enrichmentFlowEnum.optional(),
    enrichmentType: enrichmentFlowEnum.optional(),
    bookIds: z.array(safeIdSchema).min(1).max(5000),
    overwrite: z.boolean().optional().default(false),
    customGenres: z.array(z.string().max(200)).max(100).optional(),
  })
  .transform(data => {
    const normalized = normalizeEnrichmentType(
      data.enrichmentType || data.flow || 'genre',
    );
    return {
      ...data,
      flow: normalized,
      enrichmentType: normalized,
    };
  });

export const enrichmentCancelJobSchema = z.object({
  libraryId: safeIdSchema,
  jobId: safeIdSchema.optional(),
});

export const enrichmentJobStatusSchema = z.object({
  libraryId: safeIdSchema,
});

export const libraryResetMetadataSchema = z.object({
  libraryId: safeIdSchema,
  metadataType: z.enum([
    'geo',
    'temporal',
    'genre',
    'primaryGenre',
    'synopsis',
    'authorBio',
    'coverImage',
    'series',
    'embedding',
    'sanitize',
  ]),
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
