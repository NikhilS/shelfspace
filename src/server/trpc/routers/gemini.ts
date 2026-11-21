import {z} from 'zod';
import {router, protectedProcedure, aiProtectedProcedure} from '../trpc';
import {
  extractBooksFromImage,
  extractBooksFromCsv,
  generateLibraryHeroImage,
  generateClusterThemes,
  generateBookInsights,
  getPickOfTheDay,
} from '../../services/gemini';

const ALLOWED_VISION_MIME_TYPES = z.enum([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const libraryBookInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().max(500),
  primaryGenre: z.string().max(200).optional(),
  subgenres: z.array(z.string().max(200)).max(50).optional(),
});

const clusterInputSchema = z
  .array(
    z.object({
      id: z.number(),
      totalCount: z.number().int().min(0).max(50000).optional(),
      books: z
        .array(
          z.object({
            title: z.string().max(500),
            author: z.string().max(500).optional(),
            primaryGenre: z.string().max(200).optional(),
            synopsis: z.string().max(2000).optional(),
          }),
        )
        .max(2000),
    }),
  )
  .max(50);

export const geminiRouter = router({
  extractBooksFromImage: aiProtectedProcedure
    .input(
      z.object({
        base64Image: z
          .string()
          .min(1)
          .max(15 * 1024 * 1024, 'Image payload exceeds 15MB limit'),
        mimeType: ALLOWED_VISION_MIME_TYPES,
      }),
    )
    .mutation(async ({input}) => {
      return await extractBooksFromImage(input.base64Image, input.mimeType);
    }),

  extractBooksFromCsv: protectedProcedure
    .input(
      z.object({
        csvText: z
          .string()
          .min(1)
          .max(500_000, 'CSV payload exceeds 500KB limit'),
      }),
    )
    .mutation(async ({ctx, input}) => {
      const allowAiFallback = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);
      return await extractBooksFromCsv(input.csvText, {allowAiFallback});
    }),

  generateLibraryHeroImage: aiProtectedProcedure
    .input(
      z.object({
        libraryName: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(async ({input}) => {
      return await generateLibraryHeroImage(input.libraryName);
    }),

  generateClusterThemes: aiProtectedProcedure
    .input(
      z.object({
        clusters: clusterInputSchema,
      }),
    )
    .mutation(async ({input}) => {
      return await generateClusterThemes(input.clusters);
    }),

  getPickOfTheDay: aiProtectedProcedure
    .input(
      z.object({
        books: z
          .array(libraryBookInputSchema)
          .max(500, 'Maximum 500 books in context'),
      }),
    )
    .mutation(async ({input}) => {
      return await getPickOfTheDay(input.books);
    }),

  generateBookInsights: aiProtectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(500),
        author: z.string().trim().max(500).default('Unknown Author'),
        type: z.enum([
          'summary',
          'catchup',
          'similar',
          'authorBio',
          'synopsis',
        ]),
      }),
    )
    .mutation(async ({input}) => {
      return await generateBookInsights(input.title, input.author, input.type);
    }),
});
