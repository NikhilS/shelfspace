import {z} from 'zod';
import {safeIdSchema, safeImageUrlSchema} from './common';

export const recommendationSourceSchema = z.enum([
  'ai_curator',
  'catalog_graph',
  'shelf',
]);

export type RecommendationSource = z.infer<typeof recommendationSourceSchema>;

export const recommendationCategoryFilterSchema = z.enum([
  'all',
  'discover',
  'from_shelves',
  'series_and_authors',
]);

export type RecommendationCategoryFilter = z.infer<
  typeof recommendationCategoryFilterSchema
>;

export const bookRecommendationItemSchema = z.object({
  id: z.string().trim().min(1).max(300),
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().min(1).max(500),
  isbn: z.string().trim().max(64).optional(),
  coverUrl: safeImageUrlSchema.optional(),
  publishedDate: z.string().trim().max(100).optional(),
  primaryGenre: z.string().trim().max(200).optional(),
  subgenres: z.array(z.string().trim().max(200)).max(50).optional(),
  synopsis: z.string().max(50000).optional(),
  series: z.string().trim().max(300).optional(),
  source: recommendationSourceSchema,
  reason: z.string().trim().min(1).max(2000),
  matchTag: z.string().trim().min(1).max(200),
  libraryId: safeIdSchema.optional(),
  libraryName: z.string().trim().max(200).optional(),
  bookId: safeIdSchema.optional(),
  readingStatus: z.enum(['unset', 'want_to_read']).optional(),
});

export type BookRecommendationItem = z.infer<
  typeof bookRecommendationItemSchema
>;

export const getRecommendationsInputSchema = z
  .object({
    filter: recommendationCategoryFilterSchema.optional().default('all'),
    limit: z.number().int().min(1).max(24).optional().default(12),
    includeAi: z.boolean().optional().default(true),
    refreshSeed: z.number().int().min(0).max(1000000).optional().default(0),
  })
  .optional();

export type GetRecommendationsInput = z.infer<
  typeof getRecommendationsInputSchema
>;

export const getRecommendationsOutputSchema = z.object({
  items: z.array(bookRecommendationItemSchema),
  tasteSummary: z.object({
    topGenres: z.array(z.string()),
    topAuthors: z.array(z.string()),
    activeSeries: z.array(z.string()),
    finishedCount: z.number().int().nonnegative(),
    unreadShelfCount: z.number().int().nonnegative(),
  }),
});

export type GetRecommendationsOutput = z.infer<
  typeof getRecommendationsOutputSchema
>;
