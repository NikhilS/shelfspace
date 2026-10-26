import {z} from 'zod';
import {router, protectedProcedure} from '../trpc';
import {ReadingTrackerService} from '../../services/readingTracker';
import {safeIdSchema, safeImageUrlSchema} from '../../../schemas/common';
import {safeBookOrStateIdSchema} from '../../../schemas/readingState';

export const trackedShelfEnum = z.enum([
  'want_to_read',
  'reading',
  'finished',
  'abandoned',
]);

export const readingTrackerRouter = router({
  getShelf: protectedProcedure
    .input(
      z
        .object({
          shelf: z
            .enum(['all', 'want_to_read', 'reading', 'finished', 'abandoned'])
            .optional()
            .default('all'),
        })
        .optional(),
    )
    .query(async ({ctx, input}) => {
      return await ReadingTrackerService.getPersonalReadingShelf(
        ctx.user.uid,
        ctx.user.email,
        {shelf: input?.shelf ?? 'all'},
      );
    }),

  getUnreadLibraryBooks: protectedProcedure.query(async ({ctx}) => {
    return await ReadingTrackerService.getUnreadLibraryBooks(
      ctx.user.uid,
      ctx.user.email,
    );
  }),

  searchUnified: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(300),
      }),
    )
    .query(async ({ctx, input}) => {
      return await ReadingTrackerService.searchUnifiedCatalog(
        ctx.user.uid,
        ctx.user.email,
        input.query,
      );
    }),

  trackBook: protectedProcedure
    .input(
      z
        .object({
          source: z.enum(['library', 'external']),
          status: z.enum([
            'unset',
            'want_to_read',
            'reading',
            'finished',
            'abandoned',
          ]),
          libraryId: safeIdSchema.optional(),
          bookId: safeBookOrStateIdSchema.optional(),
          targetLibraryId: safeIdSchema.optional(),
          bookData: z
            .object({
              title: z.string().trim().min(1).max(500),
              author: z.string().trim().max(500).optional(),
              isbn: z.string().trim().max(64).optional(),
              coverUrl: safeImageUrlSchema.optional(),
              publishedDate: z.string().trim().max(100).optional(),
              primaryGenre: z.string().trim().max(200).optional(),
              subgenres: z.array(z.string().trim().max(200)).max(50).optional(),
              synopsis: z.string().max(50000).optional(),
              authorBio: z.string().max(50000).optional(),
              series: z.string().trim().max(300).optional(),
              format: z.enum(['physical', 'digital']).optional(),
            })
            .optional(),
          rating: z.number().min(1).max(5).optional(),
          reviewText: z.string().max(5000).optional(),
        })
        .refine(
          data =>
            data.source === 'library'
              ? Boolean(data.libraryId && data.bookId)
              : Boolean(data.bookData && data.bookData.title),
          {
            message:
              'Library source requires libraryId and bookId; external source requires bookData.title',
          },
        ),
    )
    .mutation(async ({ctx, input}) => {
      return await ReadingTrackerService.trackBook(
        ctx.user.uid,
        ctx.user.email,
        ctx.user.displayName || ctx.user.name,
        input,
      );
    }),
});
