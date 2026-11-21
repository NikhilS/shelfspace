import {z} from 'zod';
import {router, protectedProcedure, adminProcedure} from '../trpc';
import {catalogOrchestrator} from '../../services/catalog';
import {serverTelemetryBuffer} from '../../services/telemetry/serverTelemetryBuffer';

export const metadataRouter = router({
  /**
   * Priority-preempted ISBN lookup across all 8 federated catalog providers.
   */
  searchByIsbn: protectedProcedure
    .input(
      z.object({
        isbn: z.string().trim().min(1).max(64),
        priority: z.enum(['INTERACTIVE', 'BATCH']).optional(),
      }),
    )
    .mutation(async ({input}) => {
      return catalogOrchestrator.searchByIsbn(input.isbn, {
        priority: input.priority ?? 'INTERACTIVE',
        verifyCovers: true,
      });
    }),

  /**
   * Priority-preempted Title & Author lookup across all 8 federated catalog providers.
   */
  searchByTitleAndAuthor: protectedProcedure
    .input(
      z.object({
        title: z.string().trim().min(1).max(500),
        author: z.string().trim().max(500).optional().default(''),
        isbn: z.string().trim().max(64).optional(),
        priority: z.enum(['INTERACTIVE', 'BATCH']).optional(),
      }),
    )
    .mutation(async ({input}) => {
      const result = await catalogOrchestrator.searchByQuery(
        {
          title: input.title,
          author: input.author || undefined,
          isbn: input.isbn,
          limit: 10,
        },
        {
          priority: input.priority ?? 'INTERACTIVE',
          verifyCovers: true,
        },
      );
      return result.books[0] ?? null;
    }),

  /**
   * Priority-preempted general query search across all 8 federated catalog providers.
   */
  searchByTitle: protectedProcedure
    .input(
      z.object({
        query: z.string().trim().min(1).max(500),
        limit: z.number().min(1).max(30).optional(),
      }),
    )
    .mutation(async ({input}) => {
      const result = await catalogOrchestrator.searchByQuery(
        {
          rawQuery: input.query,
          limit: input.limit ?? 15,
        },
        {
          priority: 'INTERACTIVE',
          verifyCovers: false,
        },
      );
      return result.books;
    }),

  /**
   * Federated cover candidate resolver for the interactive Cover Gallery Picker
   * in Book Cover Studio (EditBookForm & ManualEntryTab).
   */
  fetchCoverCandidates: protectedProcedure
    .input(
      z.object({
        isbn: z.string().trim().max(64).optional(),
        title: z.string().trim().max(500).optional(),
        author: z.string().trim().max(500).optional(),
      }),
    )
    .mutation(async ({input}) => {
      return catalogOrchestrator.fetchCoverCandidates(
        {
          isbn: input.isbn,
          title: input.title,
          author: input.author,
        },
        {
          priority: 'INTERACTIVE',
          verifyCovers: true,
        },
      );
    }),

  /**
   * Live capacity and quota status across all catalog providers (Admin-only).
   */
  providerCapacities: adminProcedure.query(() => {
    return catalogOrchestrator.inspectAllCapacities('INTERACTIVE');
  }),

  /**
   * Server-side outbound API call telemetry and quota scheduler snapshot
   * for the in-app Debug Console HUD (Admin-only).
   */
  debugTelemetry: adminProcedure
    .input(
      z
        .object({
          sinceMs: z.number().optional(),
        })
        .optional(),
    )
    .query(({input}) => {
      return serverTelemetryBuffer.getSnapshot(input?.sinceMs);
    }),
});
