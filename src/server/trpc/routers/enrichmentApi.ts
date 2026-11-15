import {TRPCError} from '@trpc/server';
import {requiresAiPlanForEnrichment} from '../../../constants/enrichmentDescriptors';
import {
  enrichmentAdjudicateDuplicatesSchema,
  enrichmentAuditCoversSchema,
  enrichmentCancelJobSchema,
  enrichmentJobStatusSchema,
  enrichmentStartJobSchema,
  enrichmentTriggerSchema,
  normalizeEnrichmentType,
} from '../../../schemas/libraryApi';
import {EnrichmentService} from '../../services/enrichmentService';
import {enrichmentJobCoordinator} from '../../services/enrichmentJobCoordinator';
import {
  adjudicateDuplicateGroups,
  geminiDecisionProvider,
} from '../../services/gemini';
import {LibraryService} from '../../services/library';
import {libraryProcedure, router} from '../trpc';

function assertEnrichmentAiPlanAccess(
  enrichmentType: string,
  allowAiFallback: boolean,
): void {
  if (!allowAiFallback && requiresAiPlanForEnrichment(enrichmentType)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message:
        'AI Plan required: Your account does not have an active AI Plan for AI metadata enrichment.',
    });
  }
}

export const enrichmentApiRouter = router({
  trigger: libraryProcedure('editor')
    .input(enrichmentTriggerSchema)
    .mutation(async ({ctx, input}) => {
      const enrichmentType = normalizeEnrichmentType(
        input.enrichmentType || input.flow,
      );
      const allowAiFallback = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);
      assertEnrichmentAiPlanAccess(enrichmentType, allowAiFallback);
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
      assertEnrichmentAiPlanAccess(enrichmentType, allowAiFallback);
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
      assertEnrichmentAiPlanAccess(enrichmentType, allowAiFallback);
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

  auditPlaceholderCovers: libraryProcedure('editor')
    .input(enrichmentAuditCoversSchema)
    .mutation(async ({ctx, input}) => {
      const allowVisualAudit =
        Boolean(input.enableVisualAudit) &&
        Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);
      return await LibraryService.auditPlaceholderCovers(
        ctx.user.uid,
        ctx.user.email,
        input.libraryId,
        {
          skipAccessCheck: true,
          enableVisualAudit: allowVisualAudit,
        },
      );
    }),

  adjudicateDuplicates: libraryProcedure('viewer')
    .input(enrichmentAdjudicateDuplicatesSchema)
    .mutation(async ({ctx, input}) => {
      const allowAi = Boolean(ctx.isAdmin || ctx.hasAiPlan !== false);
      if (!allowAi || !geminiDecisionProvider.isAvailable()) {
        return {
          results: input.groups.map(group => ({
            groupKey: group.groupKey,
            isDuplicate: true,
            calibratedConfidence: 88,
            preferredSurvivorId: group.books[0]?.id,
          })),
        };
      }
      const results = await adjudicateDuplicateGroups(input.groups, {
        priority: 'INTERACTIVE',
      });
      return {results};
    }),
});
