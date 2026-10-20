import {router, libraryProcedure} from '../trpc';
import {EnrichmentService} from '../../services/enrichmentService';
import {enrichmentJobCoordinator} from '../../services/enrichmentJobCoordinator';
import {
  enrichmentTriggerSchema,
  enrichmentStartJobSchema,
  enrichmentCancelJobSchema,
  enrichmentJobStatusSchema,
  normalizeEnrichmentType,
} from '../../../schemas/libraryApi';

export const enrichmentApiRouter = router({
  trigger: libraryProcedure('editor')
    .input(enrichmentTriggerSchema)
    .mutation(async ({ctx, input}) => {
      const enrichmentType = normalizeEnrichmentType(
        input.enrichmentType || input.flow,
      );
      return await EnrichmentService.triggerBatchEnrichment(
        ctx.user.uid,
        ctx.user.email,
        {
          libraryId: input.libraryId,
          enrichmentType,
          bookIds: input.bookIds,
          overwrite: input.overwrite ?? false,
          customGenres: input.customGenres,
        },
        {skipAccessCheck: true},
      );
    }),

  triggerBatch: libraryProcedure('editor')
    .input(enrichmentTriggerSchema)
    .mutation(async ({ctx, input}) => {
      const enrichmentType = normalizeEnrichmentType(
        input.enrichmentType || input.flow,
      );
      return await EnrichmentService.triggerBatchEnrichment(
        ctx.user.uid,
        ctx.user.email,
        {
          libraryId: input.libraryId,
          enrichmentType,
          bookIds: input.bookIds,
          overwrite: input.overwrite ?? false,
          customGenres: input.customGenres,
        },
        {skipAccessCheck: true},
      );
    }),

  startJob: libraryProcedure('editor')
    .input(enrichmentStartJobSchema)
    .mutation(async ({ctx, input}) => {
      const enrichmentType = normalizeEnrichmentType(
        input.enrichmentType || input.flow,
      );
      return await enrichmentJobCoordinator.startJob(
        ctx.user.uid,
        ctx.user.email,
        {
          libraryId: input.libraryId,
          enrichmentType,
          bookIds: input.bookIds,
          overwrite: input.overwrite ?? false,
          customGenres: input.customGenres,
        },
        {skipAccessCheck: true},
      );
    }),

  cancelJob: libraryProcedure('editor')
    .input(enrichmentCancelJobSchema)
    .mutation(async ({ctx, input}) => {
      return await enrichmentJobCoordinator.cancelJob(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        input.jobId,
        {skipAccessCheck: true},
      );
    }),

  getJobStatus: libraryProcedure('viewer')
    .input(enrichmentJobStatusSchema)
    .query(async ({input}) => {
      return enrichmentJobCoordinator.getJobStatus(input.libraryId);
    }),
});
