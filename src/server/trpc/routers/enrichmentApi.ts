import {TRPCError} from '@trpc/server';
import {router, libraryProcedure} from '../trpc';
import {EnrichmentService} from '../../services/enrichmentService';
import {enrichmentJobCoordinator} from '../../services/enrichmentJobCoordinator';
import {
  enrichmentTriggerSchema,
  enrichmentStartJobSchema,
  enrichmentCancelJobSchema,
  enrichmentJobStatusSchema,
  normalizeEnrichmentType,
  CanonicalEnrichmentType,
} from '../../../schemas/libraryApi';

const PURE_AI_ENRICHMENT_TYPES = new Set<CanonicalEnrichmentType>([
  'geo',
  'temporal',
  'genre',
  'embedding',
]);

export const enrichmentApiRouter = router({
  trigger: libraryProcedure('editor')
    .input(enrichmentTriggerSchema)
    .mutation(async ({ctx, input}) => {
      const enrichmentType = normalizeEnrichmentType(
        input.enrichmentType || input.flow,
      );
      const allowAiFallback = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);
      if (!allowAiFallback && PURE_AI_ENRICHMENT_TYPES.has(enrichmentType)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'AI Plan required: Your account does not have an active AI Plan for AI metadata enrichment.',
        });
      }
      return await EnrichmentService.triggerBatchEnrichment(
        ctx.user.uid,
        ctx.user.email,
        {
          libraryId: input.libraryId,
          enrichmentType,
          bookIds: input.bookIds,
          overwrite: input.overwrite ?? false,
          customGenres: input.customGenres,
          allowAiFallback,
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
      const allowAiFallback = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);
      if (!allowAiFallback && PURE_AI_ENRICHMENT_TYPES.has(enrichmentType)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'AI Plan required: Your account does not have an active AI Plan for AI metadata enrichment.',
        });
      }
      return await EnrichmentService.triggerBatchEnrichment(
        ctx.user.uid,
        ctx.user.email,
        {
          libraryId: input.libraryId,
          enrichmentType,
          bookIds: input.bookIds,
          overwrite: input.overwrite ?? false,
          customGenres: input.customGenres,
          allowAiFallback,
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
      const allowAiFallback = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);
      if (!allowAiFallback && PURE_AI_ENRICHMENT_TYPES.has(enrichmentType)) {
        throw new TRPCError({
          code: 'FORBIDDEN',
          message:
            'AI Plan required: Your account does not have an active AI Plan for AI metadata enrichment.',
        });
      }
      return await enrichmentJobCoordinator.startJob(
        ctx.user.uid,
        ctx.user.email,
        {
          libraryId: input.libraryId,
          enrichmentType,
          bookIds: input.bookIds,
          overwrite: input.overwrite ?? false,
          customGenres: input.customGenres,
          allowAiFallback,
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
