import {z} from 'zod';

export const libraryListSchema = z.object({}).optional().default({});

export const bookListSchema = z.object({
  libraryId: z
    .string()
    .min(1, 'libraryId is required')
    .describe('Target library ID (exactly one)'),
  filters: z
    .object({
      missingMetadata: z
        .enum(['geo', 'temporal', 'genre', 'synopsis', 'coverImage'])
        .optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(250).default(50),
  cursor: z.string().optional(),
});

export const ENRICHMENT_TYPE_LIST = [
  'geo',
  'temporal',
  'genre',
  'synopsis',
  'coverImage',
  'authorBio',
  'geoMetadata',
  'temporalMetadata',
  'genres',
  'coverUrl',
  'embedding',
  'embeddings',
] as const;

export const enrichmentTriggerSchema = z
  .object({
    libraryId: z
      .string()
      .min(1, 'libraryId is required')
      .describe('Target library ID (exactly one)'),
    bookIds: z.array(z.string().min(1)).min(1).max(100).optional(),
    books: z
      .array(
        z
          .object({
            id: z.string().min(1),
            title: z.string().min(1),
            author: z.string().optional(),
            isbn: z.string().optional(),
            synopsis: z.string().optional(),
            description: z.string().optional(),
          })
          .passthrough(),
      )
      .optional(),
    limit: z.number().int().min(1).max(100).optional().default(20),
    enrichmentType: z.enum(ENRICHMENT_TYPE_LIST).optional(),
    flow: z.enum(ENRICHMENT_TYPE_LIST).optional(),
    overwrite: z.boolean().optional().default(false),
  })
  .refine(data => !!(data.enrichmentType || data.flow), {
    message: 'Either enrichmentType or flow must be specified',
    path: ['enrichmentType'],
  })
  .transform(val => {
    const rawType = (val.enrichmentType || val.flow)!;
    // Normalize aliases to canonical short names
    const normalizedType =
      rawType === 'geoMetadata'
        ? 'geo'
        : rawType === 'temporalMetadata'
          ? 'temporal'
          : rawType === 'genres'
            ? 'genre'
            : rawType === 'coverUrl'
              ? 'coverImage'
              : rawType === 'embeddings'
                ? 'embedding'
                : rawType;

    const derivedBookIds =
      val.bookIds && val.bookIds.length > 0
        ? val.bookIds
        : val.books && val.books.length > 0
          ? val.books.map(b => b.id)
          : undefined;

    return {
      ...val,
      bookIds: derivedBookIds,
      enrichmentType: normalizedType,
      flow: normalizedType,
    };
  });

export type LibraryListInput = z.infer<typeof libraryListSchema>;
export type BookListInput = z.infer<typeof bookListSchema>;
export type EnrichmentTriggerInput = z.infer<typeof enrichmentTriggerSchema>;
