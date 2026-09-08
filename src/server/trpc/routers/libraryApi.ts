import {z} from 'zod';
import {TRPCError} from '@trpc/server';
import {router, protectedProcedure} from '../trpc';
import {
  libraryListSchema,
  bookListSchema,
  enrichmentTriggerSchema,
} from '../../../schemas/libraryApi';
import {LibraryService} from '../../../services/server/libraryService';
import {EnrichmentService} from '../../../services/server/enrichmentService';

export const libraryApiRouter = router({
  /**
   * @deprecated Retired in Phase 5: All real-time library operations natively use the client Firestore SDK.
   */
  list: protectedProcedure.input(libraryListSchema).query(async () => {
    throw new TRPCError({
      code: 'METHOD_NOT_ALLOWED',
      message:
        'trpc.library.list has been retired in Phase 5. All real-time library operations natively use the client Firestore SDK.',
    });
  }),
  resetMetadata: protectedProcedure
    .input(
      z.object({
        libraryId: z.string(),
        metadataType: z.string(),
      }),
    )
    .mutation(async ({input, ctx}) => {
      return LibraryService.resetMetadata(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.metadataType,
      );
    }),
});

/**
 * @deprecated Retired in Phase 5: All real-time book queries natively use the client Firestore SDK.
 */
export const bookApiRouter = router({
  /**
   * @deprecated Retired in Phase 5: All real-time book operations natively use the client Firestore SDK.
   */
  list: protectedProcedure.input(bookListSchema).query(async () => {
    throw new TRPCError({
      code: 'METHOD_NOT_ALLOWED',
      message:
        'trpc.book.list has been retired in Phase 5. All real-time book queries natively use the client Firestore SDK.',
    });
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
