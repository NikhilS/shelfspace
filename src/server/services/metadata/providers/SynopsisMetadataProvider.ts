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
import * as geminiService from '../../gemini';
import {hydrateCatalogForResidualBooks} from '../bonusCatalogPatcher';
import {
  getOptionalModuleFunction,
  runPluginStagesToRecord,
} from '../stageRunner';

const synopsisPluginOutputSchema: z.ZodType<string | null> = z
  .string()
  .nullable();

export class SynopsisMetadataProvider implements MetadataPlugin<string | null> {
  readonly statusKey = 'synopsis' as const;
  readonly needsSynopsis = false;
  readonly supportsHybridAiFallback = true;
  readonly outputSchema = synopsisPluginOutputSchema;

  readonly stages: ReadonlyArray<EnrichmentPipelineStage<string | null>> = [
    {
      id: 'synopsis-catalog',
      tier: 'catalog',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        if (books.length === 0 || options?.signal?.aborted) {
          return outcomes;
        }

        const catalogMap = await hydrateCatalogForResidualBooks(books, {
          signal: options?.signal,
          verifyCovers: false,
          preferField: 'synopsis',
        });

        const generateSynopsesFn = getOptionalModuleFunction<
          typeof geminiService.generateBookSynopsesBatch
        >(geminiService, 'generateBookSynopsesBatch');
        const canEscalateToGenerative =
          options?.allowAiFallback !== false &&
          Boolean(process.env.GEMINI_API_KEY) &&
          Boolean(generateSynopsesFn);

        for (const book of books) {
          const hit = catalogMap.get(book.id);
          const catalogSynopsis = hit?.details?.synopsis;
          if (catalogSynopsis && catalogSynopsis.trim()) {
            outcomes.set(book.id, {
              status: 'resolved',
              value: catalogSynopsis,
              winningProvider: hit?.bonusCatalog?.winningProvider,
              ...(hit?.bonusCatalog ? {bonusCatalog: hit.bonusCatalog} : {}),
            });
          } else if (canEscalateToGenerative && book.title) {
            outcomes.set(book.id, {
              status: 'escalate',
              ...(hit?.bonusCatalog ? {bonusCatalog: hit.bonusCatalog} : {}),
            });
          }
        }

        return outcomes;
      },
    },
    {
      id: 'synopsis-generative-fallback',
      tier: 'generative',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        const generateSynopsesFn = getOptionalModuleFunction<
          typeof geminiService.generateBookSynopsesBatch
        >(geminiService, 'generateBookSynopsesBatch');
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false ||
          !process.env.GEMINI_API_KEY ||
          !generateSynopsesFn
        ) {
          return outcomes;
        }

        const CHUNK_SIZE = 10;
        const chunks: Array<
          Array<{id: string; title: string; author: string}>
        > = [];
        for (let i = 0; i < books.length; i += CHUNK_SIZE) {
          chunks.push(
            books.slice(i, i + CHUNK_SIZE).map(b => ({
              id: b.id,
              title: b.title,
              author: b.author || 'Unknown Author',
            })),
          );
        }

        await Promise.all(
          chunks.map(async chunk => {
            if (options?.signal?.aborted) {
              return;
            }
            try {
              const aiSynopses = await generateSynopsesFn(chunk, {
                priority: 'BATCH',
                signal: options?.signal,
              });
              if (aiSynopses && typeof aiSynopses === 'object') {
                for (const [id, syn] of Object.entries(aiSynopses)) {
                  if (syn && syn.trim()) {
                    outcomes.set(id, {
                      status: 'resolved',
                      value: syn.trim(),
                      winningProvider: 'gemini_generative',
                    });
                  }
                }
              }
            } catch (err) {
              if ((err as Error)?.name !== 'AbortError') {
                console.warn(
                  'SynopsisMetadataProvider Gemini fallback failed:',
                  err,
                );
              }
            }
          }),
        );

        return outcomes;
      },
    },
  ];

  getKey(): MetadataKey {
    return MetadataKey.SYNOPSIS;
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<string | null> {
    if (options?.signal?.aborted) {
      return null;
    }
    const stageMap = await this.stages[0].execute({
      books: [book],
      options: {...options, allowAiFallback: false},
    });
    const outcome = stageMap.get(book.id);
    return outcome?.status === 'resolved' ? outcome.value : null;
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
    existingDetailsMeta,
    nowIso,
  }: MetadataPersistenceContext<string | null>): MetadataPersistencePatch {
    const nextDetailsMeta = {
      ...existingDetailsMeta,
      hasSynopsis: true,
    };
    return {
      bookUpdate: {
        bookDetailsMetadata: nextDetailsMeta,
        enrichmentStatus: {
          ...existingStatus,
          synopsis: 'completed',
        },
      },
      detailsUpdate: {
        synopsis: value,
        updatedAt: nowIso,
      },
      resultPreview: {
        id: book.id,
        bookDetailsMetadata: nextDetailsMeta,
      },
    };
  }

  shouldFetchOnCreate(): boolean {
    return false;
  }

  isAvailable(): boolean {
    return true;
  }
}
