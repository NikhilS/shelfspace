import {z} from 'zod';
import {
  router,
  protectedProcedure,
  verifyLibraryWriteAccess,
} from '../trpc';
import {MetadataRegistry} from '../../../services/server/metadata';
import {MetadataKey} from '../../../types/metadata';

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
      const CHUNK_SIZE = 10;

      for (let i = 0; i < books.length; i += CHUNK_SIZE) {
        const bookChunk = books.slice(i, i + CHUNK_SIZE);

        await Promise.all(
          bookChunk.map(async book => {
            const enrichedMetadata: Record<string, unknown> = {};

            await Promise.allSettled(
              providersToRun.map(async provider => {
                try {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  const res = await provider.fetch(book as any);
                  if (res) {
                    enrichedMetadata[provider.getKey()] = res;
                  }
                } catch (err) {
                  console.error(
                    `Provider ${provider.getKey()} failed on create for book ${book.id}:`,
                    err,
                  );
                }
              }),
            );

            results.push({id: book.id, ...enrichedMetadata});
          }),
        );
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

      console.log(
        `[TRPC Metadata] Bulk fetch requested for ${providerKey} over ${books.length} books`,
      );

      const provider = MetadataRegistry.getInstance().getProvider(
        providerKey as MetadataKey,
      );

      if (!provider) {
        throw new Error(`Unknown metadata provider: ${providerKey}`);
      }

      if (!provider.isAvailable()) {
        throw new Error(
          `Provider ${providerKey} is not properly configured (e.g. missing API keys).`,
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const extractedBatch = await provider.bulkFetch(books as any);

      const results: Record<string, unknown>[] = [];
      for (const [id, metadata] of Object.entries(extractedBatch)) {
        if (metadata) {
          results.push({id, [provider.getKey()]: metadata});
        }
      }

      return {status: 'success', results};
    }),
});
