import {z} from 'zod';

export const libraryListSchema = z.object({});

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

export const enrichmentTriggerSchema = z.object({
  libraryId: z
    .string()
    .min(1, 'libraryId is required')
    .describe('Target library ID (exactly one)'),
  bookIds: z.array(z.string().min(1)).min(1).max(250),
  enrichmentType: z.enum([
    'geo',
    'temporal',
    'genre',
    'synopsis',
    'coverImage',
    'authorBio',
  ]),
});

export type LibraryListInput = z.infer<typeof libraryListSchema>;
export type BookListInput = z.infer<typeof bookListSchema>;
export type EnrichmentTriggerInput = z.infer<typeof enrichmentTriggerSchema>;
