import {z} from 'zod';
import {router, libraryProcedure} from '../trpc';
import {BookService} from '../../services/book';
import {
  bookCreateSchema,
  bookUpdateSchema,
  bookDeleteSchema,
  bookBatchUpsertSchema,
  bookListSchema,
  bookMergeDuplicatesSchema,
} from '../../../schemas/libraryApi';
import {bookStatusEnum} from '../../../schemas/book';
import {safeIdSchema} from '../../../schemas/common';

export const bookApiRouter = router({
  create: libraryProcedure('editor')
    .input(bookCreateSchema)
    .mutation(async ({ctx, input}) => {
      return await BookService.createBook(ctx.user.uid, input);
    }),

  update: libraryProcedure('editor')
    .input(bookUpdateSchema)
    .mutation(async ({ctx, input}) => {
      return await BookService.updateBook(ctx.user.uid, input);
    }),

  updateStatus: libraryProcedure('viewer')
    .input(
      z.object({
        libraryId: safeIdSchema,
        bookId: safeIdSchema,
        status: bookStatusEnum,
      }),
    )
    .mutation(async ({ctx, input}) => {
      return await BookService.updateBookStatus(
        ctx.user.uid,
        input.libraryId,
        input.bookId,
        input.status,
        {skipAccessCheck: true},
      );
    }),

  delete: libraryProcedure('editor')
    .input(bookDeleteSchema)
    .mutation(async ({ctx, input}) => {
      return await BookService.deleteBook(ctx.user.uid, input);
    }),

  batchUpsert: libraryProcedure('editor')
    .input(bookBatchUpsertSchema)
    .mutation(async ({ctx, input}) => {
      return await BookService.batchUpsert(ctx.user.uid, input);
    }),

  mergeDuplicates: libraryProcedure('editor')
    .input(bookMergeDuplicatesSchema)
    .mutation(async ({ctx, input}) => {
      return await BookService.mergeDuplicates(ctx.user.uid, input);
    }),

  get: libraryProcedure('viewer')
    .input(
      z.object({
        libraryId: safeIdSchema,
        bookId: safeIdSchema,
      }),
    )
    .query(async ({ctx, input}) => {
      return await BookService.getBook(
        ctx.user.uid,
        input.libraryId,
        input.bookId,
      );
    }),

  list: libraryProcedure('viewer')
    .input(
      bookListSchema.extend({
        limit: z.number().int().min(1).max(2000).optional().default(1000),
      }),
    )
    .query(async ({ctx, input}) => {
      return await BookService.listBooks(ctx.user.uid, input.libraryId, input);
    }),

  getBookDetailsChunk: libraryProcedure('viewer')
    .input(
      z.object({
        libraryId: safeIdSchema,
        bookIds: z.array(safeIdSchema).max(100),
      }),
    )
    .mutation(async ({ctx, input}) => {
      return await BookService.getBookDetailsChunk(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.bookIds,
        {skipAccessCheck: true},
      );
    }),

  listReviews: libraryProcedure('viewer')
    .input(
      z.object({
        libraryId: safeIdSchema,
        bookId: safeIdSchema,
      }),
    )
    .query(async ({ctx, input}) => {
      return await BookService.listReviews(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.bookId,
        {skipAccessCheck: true},
      );
    }),

  addReview: libraryProcedure('viewer')
    .input(
      z
        .object({
          libraryId: safeIdSchema,
          bookId: safeIdSchema,
          rating: z.number().min(1).max(5).optional(),
          text: z.string().min(1).max(5000).optional(),
          reviewText: z.string().min(1).max(5000).optional(),
        })
        .refine(data => Boolean(data.text || data.reviewText), {
          message: 'Review text is required',
        }),
    )
    .mutation(async ({ctx, input}) => {
      return await BookService.addReview(
        ctx.user.uid,
        ctx.user.email,
        ctx.user.displayName || ctx.user.name,
        input.libraryId,
        input.bookId,
        {
          rating: input.rating ?? 5,
          text: (input.text || input.reviewText || '').trim(),
        },
        {skipAccessCheck: true},
      );
    }),
});
