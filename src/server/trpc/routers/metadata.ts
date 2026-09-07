import {z} from 'zod';
import {router, protectedProcedure, verifyLibraryWriteAccess} from '../trpc';
import {MetadataRegistry} from '../../../services/server/metadata';
import {MetadataKey} from '../../../types/metadata';
import {ENRICHMENT_CONSTANTS} from '../../../constants/enrichment';
import {EnrichmentService} from '../../../services/server/enrichmentService';
import {EnrichmentTriggerInput} from '../../../schemas/libraryApi';

export const metadataRouter = router({
  enrichCreate: protectedProcedure
    .input(
      z.object({
        libraryId: z.string(),
        books: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              author: z.string(),
              synopsis: z.string().optional(),
              description: z.string().optional(),
            })
            .passthrough(),
        ),
      }),
    )
    .mutation(async ({input, ctx}) => {
      const {books, libraryId} = input;
      await verifyLibraryWriteAccess(libraryId, ctx.user);

      console.log(
        `[TRPC Metadata] Initial creation fetch requested for ${books.length} books`,
      );

      const isBulkUpload = books.length > 20;
      const activeProviders = MetadataRegistry.getInstance()
        .getAllProviders()
        .filter(p => p.shouldFetchOnCreate() && p.isAvailable());

      // If it's a massive bulk upload, only run the embedding provider
      // to keep the upload fast and prevent Gemini API timeouts.
      // The rest can be fetched later or via a background job.
      const providersToRun = isBulkUpload
        ? activeProviders.filter(
            p => p.getKey() === ('embedding' as MetadataKey),
          )
        : activeProviders;

      const results: Record<string, unknown>[] = [];
      const CHUNK_SIZE = ENRICHMENT_CONSTANTS.GEMINI_CHUNK_SIZE;

      for (let i = 0; i < books.length; i += CHUNK_SIZE) {
        const bookChunk = books.slice(i, i + CHUNK_SIZE);
        const chunkResults: Record<string, Record<string, unknown>> = {};
        for (const book of bookChunk) {
          chunkResults[book.id] = {id: book.id};
        }

        await Promise.allSettled(
          providersToRun.map(async provider => {
            try {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const batchRes = await provider.bulkFetch(bookChunk as any);
              if (batchRes) {
                for (const [bookId, val] of Object.entries(batchRes)) {
                  if (val && chunkResults[bookId]) {
                    chunkResults[bookId][provider.getKey()] = val;
                  }
                }
              }
            } catch (err) {
              console.error(
                `Provider ${provider.getKey()} failed in bulkFetch on create for chunk:`,
                err,
              );
            }
          }),
        );

        for (const book of bookChunk) {
          results.push(chunkResults[book.id]);
        }
      }

      return {status: 'success', results};
    }),

  bulkFetch: protectedProcedure
    .input(
      z.object({
        libraryId: z.string(),
        providerKey: z.string(), // e.g. 'geo'
        books: z.array(
          z
            .object({
              id: z.string(),
              title: z.string(),
              author: z.string(),
              synopsis: z.string().optional(),
              description: z.string().optional(),
            })
            .passthrough(),
        ),
      }),
    )
    .mutation(async ({input, ctx}) => {
      const {providerKey, books, libraryId} = input;
      await verifyLibraryWriteAccess(libraryId, ctx.user);

      return EnrichmentService.triggerBatchEnrichment(
        ctx.user.uid,
        ctx.user.email,
        {
          libraryId,
          bookIds: books.map(b => b.id),
          enrichmentType:
            providerKey as EnrichmentTriggerInput['enrichmentType'],
        },
      );
    }),
});
