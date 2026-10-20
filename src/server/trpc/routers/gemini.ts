import {z} from 'zod';
import {router, protectedProcedure} from '../trpc';
import {safeIdSchema} from '../../../schemas/common';
import {
  extractBooksFromImage,
  extractBooksFromCsv,
  generateLibraryHeroImage,
  generateClusterNames,
  generateBookEmbeddings,
  generateLibraryRecommendations,
  generateBookInsights,
  getPickOfTheDay,
  classifyBooks,
  extractBookGeoMetadataBatch,
  extractBookTemporalMetadataBatch,
} from '../../services/gemini';

const ALLOWED_VISION_MIME_TYPES = z.enum([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const bookGenreSchema = z.object({
  id: safeIdSchema,
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().max(500),
  synopsis: z.string().max(10000).optional(),
});

const libraryBookInputSchema = z.object({
  title: z.string().trim().min(1).max(500),
  author: z.string().trim().max(500),
  primaryGenre: z.string().max(200).optional(),
  subgenres: z.array(z.string().max(200)).max(50).optional(),
});

export const geminiRouter = router({
  extractBooksFromImage: protectedProcedure
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
    .mutation(async ({input}) => {
      return await extractBooksFromCsv(input.csvText);
    }),

  generateLibraryHeroImage: protectedProcedure
    .input(
      z.object({
        libraryName: z.string().trim().min(1).max(120),
      }),
    )
    .mutation(async ({input}) => {
      return await generateLibraryHeroImage(input.libraryName);
    }),

  generateClusterNames: protectedProcedure
    .input(
      z.object({
        clusters: z
          .array(
            z.object({
              id: z.number(),
              books: z
                .array(
                  z.object({
                    title: z.string().max(500),
                    author: z.string().max(500).optional(),
                  }),
                )
                .max(200),
            }),
          )
          .max(50),
      }),
    )
    .mutation(async ({input}) => {
      return await generateClusterNames(input.clusters);
    }),

  generateBookEmbeddings: protectedProcedure
    .input(
      z.object({
        texts: z
          .array(z.string().min(1).max(8000))
          .max(100, 'Maximum 100 embedding texts per request'),
      }),
    )
    .mutation(async ({input}) => {
      return await generateBookEmbeddings(input.texts);
    }),

  getPickOfTheDay: protectedProcedure
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

  generateBookInsights: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(500),
        author: z.string().trim().max(500).default('Unknown Author'),
        type: z.enum([
          'summary',
          'catchup',
          'similar',
          'author_bio',
          'synopsis',
        ]),
      }),
    )
    .mutation(async ({input}) => {
      return await generateBookInsights(input.title, input.author, input.type);
    }),

  generateLibraryRecommendations: protectedProcedure
    .input(
      z.object({
        books: z
          .array(libraryBookInputSchema)
          .max(500, 'Maximum 500 books in context'),
      }),
    )
    .mutation(async ({input}) => {
      return await generateLibraryRecommendations(input.books);
    }),

  classifyBooks: protectedProcedure
    .input(
      z.object({
        books: z.array(bookGenreSchema).max(100),
        customGenres: z.array(z.string().max(200)).max(100).optional(),
        libraryId: safeIdSchema.optional(),
      }),
    )
    .mutation(async ({input}) => {
      return await classifyBooks(input.books);
    }),

  extractBookGeoMetadataBatch: protectedProcedure
    .input(
      z.object({
        books: z.array(bookGenreSchema).max(100, 'Maximum 100 books per batch'),
      }),
    )
    .mutation(async ({input}) => {
      return await extractBookGeoMetadataBatch(input.books);
    }),

  extractBookTemporalMetadataBatch: protectedProcedure
    .input(
      z.object({
        books: z.array(bookGenreSchema).max(100, 'Maximum 100 books per batch'),
      }),
    )
    .mutation(async ({input}) => {
      return await extractBookTemporalMetadataBatch(input.books);
    }),
});
