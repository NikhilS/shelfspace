import {router, protectedProcedure} from '../trpc';
import {z} from 'zod';
import * as geminiService from '../../../services/server/gemini';

export const geminiRouter = router({
  generateClusterNames: protectedProcedure
    .input(
      z.object({
        clusters: z.array(
          z.object({
            id: z.number(),
            books: z.array(
              z.object({
                title: z.string(),
                author: z.string().optional(),
              }),
            ),
          }),
        ),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.generateClusterNames(input.clusters);
    }),

  generateBookEmbeddings: protectedProcedure
    .input(
      z.object({
        texts: z.array(z.string()),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.generateBookEmbeddings(input.texts);
    }),

  extractBooksFromImage: protectedProcedure
    .input(
      z.object({
        base64Image: z.string(),
        mimeType: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.extractBooksFromImage(
        input.base64Image,
        input.mimeType,
      );
    }),

  extractBooksFromCsv: protectedProcedure
    .input(
      z.object({
        csvText: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.extractBooksFromCsv(input.csvText);
    }),

  generateLibraryRecommendations: protectedProcedure
    .input(
      z.object({
        libraryBooks: z.array(
          z.object({
            title: z.string(),
            author: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.generateLibraryRecommendations(input.libraryBooks);
    }),

  generateBookInsights: protectedProcedure
    .input(
      z.object({
        title: z.string(),
        author: z.string(),
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
      return geminiService.generateBookInsights(
        input.title,
        input.author,
        input.type,
      );
    }),

  generateLibraryHeroImage: protectedProcedure
    .input(
      z.object({
        libraryName: z.string(),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.generateLibraryHeroImage(input.libraryName);
    }),

  getPickOfTheDay: protectedProcedure
    .input(
      z.object({
        books: z.array(
          z.object({
            title: z.string(),
            author: z.string(),
          }),
        ),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.getPickOfTheDay(input.books);
    }),

  extractBookGeoMetadataBatch: protectedProcedure
    .input(
      z.object({
        books: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            author: z.string(),
            synopsis: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.extractBookGeoMetadataBatch(input.books);
    }),

  extractBookTemporalMetadataBatch: protectedProcedure
    .input(
      z.object({
        books: z.array(
          z.object({
            id: z.string(),
            title: z.string(),
            author: z.string(),
            synopsis: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({input}) => {
      return geminiService.extractBookTemporalMetadataBatch(input.books);
    }),
});
