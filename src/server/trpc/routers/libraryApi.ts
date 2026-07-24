import {router, protectedProcedure} from '../trpc';
import {
  libraryListSchema,
  bookListSchema,
  enrichmentTriggerSchema,
} from '../../../schemas/libraryApi';
import {LibraryService} from '../../../services/server/libraryService';
import {EnrichmentService} from '../../../services/server/enrichmentService';

export const libraryApiRouter = router({
  list: protectedProcedure.input(libraryListSchema).query(async ({ctx}) => {
    return LibraryService.getUserLibraries(ctx.user.uid, ctx.user.email);
  }),
});

export const bookApiRouter = router({
  list: protectedProcedure.input(bookListSchema).query(async ({input, ctx}) => {
    return LibraryService.getFilteredBooks(
      ctx.user.uid,
      ctx.user.email,
      input,
    );
  }),
});

export const enrichmentApiRouter = router({
  trigger: protectedProcedure
    .input(enrichmentTriggerSchema)
    .mutation(async ({input, ctx}) => {
      return EnrichmentService.triggerBatchEnrichment(
        ctx.user.uid,
        ctx.user.email,
        input,
      );
    }),
});
