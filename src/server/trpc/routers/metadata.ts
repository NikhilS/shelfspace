import {z} from 'zod';
import {router, protectedProcedure, adminProcedure} from '../trpc';
import {MetadataRegistry} from '../../services/metadata';
import {MetadataKey, CoreBookData} from '../../../types/metadata';
import {catalogOrchestrator, wikipediaProvider} from '../../services/catalog';
import {serverTelemetryBuffer} from '../../services/telemetry/serverTelemetryBuffer';
import {safeIdSchema, safeUrlSchema} from '../../../schemas/common';

const coreBookSchema = z
  .object({
    id: safeIdSchema,
    title: z.string().trim().min(1).max(500),
    author: z.string().trim().max(500),
    isbn: z.string().trim().max(64).optional(),
    primaryGenre: z.string().trim().max(200).optional(),
    subgenres: z.array(z.string().trim().max(200)).max(50).optional(),
    synopsis: z.string().max(50000).optional(),
    description: z.string().max(50000).optional(),
    publishedDate: z.string().max(100).optional(),
    coverUrl: safeUrlSchema.optional(),
    series: z.string().max(300).optional(),
  })
  .strict();

export const metadataRouter = router({
  /**
   * Enriches newly created books across all on-create metadata providers.
   */
  enrichCreate: protectedProcedure
    .input(
      z.object({
        books: z
          .array(coreBookSchema)
          .max(100, 'Maximum 100 books per enrichment batch'),
      }),
    )
    .mutation(async ({input}) => {
      const registry = MetadataRegistry.getInstance();
      const createProviders = registry
        .getAllProviders()
        .filter(p => p.shouldFetchOnCreate() && p.isAvailable());

      const enrichedResults: Record<string, Record<string, unknown>> = {};
      for (const b of input.books) {
        enrichedResults[b.id] = {};
      }

      const providerPromises = createProviders.map(async provider => {
        const key = provider.getKey();
        try {
          const batchResult = await provider.bulkFetch(
            input.books as CoreBookData[],
          );
          for (const [bookId, metadata] of Object.entries(batchResult)) {
            if (metadata !== null && metadata !== undefined) {
              if (!enrichedResults[bookId]) enrichedResults[bookId] = {};
              enrichedResults[bookId][key] = metadata;
            }
          }
        } catch (error) {
          console.error(
            `Error running on-create provider for key ${key}:`,
            error,
          );
        }
      });

      await Promise.all(providerPromises);
      return enrichedResults;
    }),

  /**
   * Enriches existing books for a specific MetadataKey.
   */
  enrichSpruceUp: protectedProcedure
    .input(
      z.object({
        providerKey: z.nativeEnum(MetadataKey),
        books: z
          .array(coreBookSchema)
          .max(100, 'Maximum 100 books per enrichment batch'),
      }),
    )
    .mutation(async ({input}) => {
      const registry = MetadataRegistry.getInstance();
      const provider = registry.getProvider(input.providerKey);

      if (!provider) {
        throw new Error(`No provider registered for key: ${input.providerKey}`);
      }

      if (!provider.isAvailable()) {
        throw new Error(
          `Provider for key ${input.providerKey} is currently unavailable`,
        );
      }

      try {
        return await provider.bulkFetch(input.books as CoreBookData[]);
      } catch (error) {
        console.error(
          `Error running spruce-up provider for key ${input.providerKey}:`,
          error,
        );
        throw error;
      }
    }),

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
          title: input.query,
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
   * Server-side author biography lookup via WikipediaProvider.
   */
  fetchAuthorBio: protectedProcedure
    .input(z.object({author: z.string().trim().min(1).max(500)}))
    .mutation(async ({input}) => {
      return wikipediaProvider.fetchAuthorBio(input.author, {
        priority: 'INTERACTIVE',
      });
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
