import {z} from 'zod';
import {router, protectedProcedure} from '../trpc';
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
    .mutation(async ({input}) => {
      const {books} = input;
      console.log(
        `[TRPC Metadata] Initial creation fetch requested for ${books.length} books`,
      );

      const activeProviders = MetadataRegistry.getInstance()
        .getAllProviders()
        .filter(p => p.shouldFetchOnCreate() && p.isAvailable());

      const results = [];
      for (const book of books) {
        const enrichedMetadata: Record<string, unknown> = {};

        await Promise.allSettled(
          activeProviders.map(async provider => {
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
    .mutation(async ({input}) => {
      const {providerKey, books} = input;
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

      const results = [];
      for (const [id, metadata] of Object.entries(extractedBatch)) {
        if (metadata) {
          results.push({id, [provider.getKey()]: metadata});
        }
      }

      return {status: 'success', results};
    }),
});
