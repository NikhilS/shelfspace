import {z} from 'zod';
import {
  type CoreBookData,
  type EnrichmentPipelineStage,
  type MetadataBulkFetchOptions,
  MetadataKey,
  type MetadataPersistenceContext,
  type MetadataPersistencePatch,
  type MetadataPlugin,
  type StageBookOutcome,
} from '../../../../types/metadata';
import {catalogOrchestrator} from '../../catalog';
import {hydrateCatalogForResidualBooks} from '../bonusCatalogPatcher';
import {runPluginStagesToRecord} from '../stageRunner';

const coverImagePluginOutputSchema: z.ZodType<string | null> = z
  .string()
  .nullable();

export class CoverImageMetadataProvider implements MetadataPlugin<
  string | null
> {
  readonly statusKey = 'coverImage' as const;
  readonly needsSynopsis = false;
  readonly supportsHybridAiFallback = false;
  readonly outputSchema = coverImagePluginOutputSchema;

  readonly stages: ReadonlyArray<EnrichmentPipelineStage<string | null>> = [
    {
      id: 'cover-catalog',
      tier: 'catalog',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        if (books.length === 0 || options?.signal?.aborted) {
          return outcomes;
        }

        const residualForDetails: CoreBookData[] = [];

        await Promise.all(
          books.map(async book => {
            if (options?.signal?.aborted) {
              return;
            }
            try {
              if (book.isbn || book.title) {
                const candidateRes =
                  await catalogOrchestrator.fetchCoverCandidates(
                    {
                      isbn: book.isbn,
                      title: book.title,
                      author: book.author || undefined,
                    },
                    {
                      priority: 'BATCH',
                      verifyCovers: true,
                      signal: options?.signal,
                    },
                  );
                if (candidateRes.candidates.length > 0) {
                  outcomes.set(book.id, {
                    status: 'resolved',
                    value: candidateRes.candidates[0].url,
                    winningProvider: candidateRes.candidates[0].source,
                  });
                  return;
                }
              }
              residualForDetails.push(book);
            } catch (error) {
              if ((error as Error)?.name !== 'AbortError') {
                console.error(
                  `CoverImageMetadataProvider failed for "${book.title}":`,
                  error,
                );
              }
            }
          }),
        );

        if (residualForDetails.length > 0 && !options?.signal?.aborted) {
          const catalogMap = await hydrateCatalogForResidualBooks(
            residualForDetails,
            {
              signal: options?.signal,
              verifyCovers: true,
              preferField: 'coverUrl',
            },
          );

          for (const book of residualForDetails) {
            const hit = catalogMap.get(book.id);
            if (hit?.details?.coverUrl) {
              outcomes.set(book.id, {
                status: 'resolved',
                value: hit.details.coverUrl,
                winningProvider: hit.bonusCatalog?.winningProvider,
                ...(hit.bonusCatalog ? {bonusCatalog: hit.bonusCatalog} : {}),
              });
            }
          }
        }

        return outcomes;
      },
    },
  ];

  getKey(): MetadataKey {
    return MetadataKey.COVER_IMAGE;
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<string | null> {
    const batchRes = await this.bulkFetch([book], options);
    return batchRes[book.id] ?? null;
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, string | null>> {
    return runPluginStagesToRecord(this.stages, books, options, {
      hasDefaultUnresolvedValue: true,
      defaultUnresolvedValue: null,
    });
  }

  toPersistencePatch({
    book,
    value,
    existingStatus,
  }: MetadataPersistenceContext<string | null>): MetadataPersistencePatch {
    return {
      bookUpdate: {
        coverUrl: value,
        enrichmentStatus: {
          ...existingStatus,
          coverImage: 'completed',
        },
      },
      resultPreview: {
        id: book.id,
        coverUrl: value,
      },
    };
  }

  shouldFetchOnCreate(): boolean {
    return true;
  }

  isAvailable(): boolean {
    return true;
  }
}
