import {z} from 'zod';
import {computeBookSearchTokens} from '../../../../lib/duplicateDetection';
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

const seriesPluginOutputSchema: z.ZodType<string | null> = z
  .string()
  .nullable();

function extractExistingSynopsis(book?: CoreBookData): string | undefined {
  if (!book) {
    return undefined;
  }
  const raw = book.synopsis || book.description;
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : undefined;
}

export class SeriesMetadataProvider implements MetadataPlugin<string | null> {
  readonly statusKey = 'series' as const;
  readonly needsSynopsis = true;
  readonly supportsHybridAiFallback = true;
  readonly outputSchema = seriesPluginOutputSchema;

  readonly stages: ReadonlyArray<EnrichmentPipelineStage<string | null>> = [
    {
      id: 'series-decision-gate',
      tier: 'decision',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        if (books.length === 0 || options?.signal?.aborted) {
          return outcomes;
        }

        const gateSeriesFn = getOptionalModuleFunction<
          typeof geminiService.gateSeriesCandidatesWithDecisions
        >(geminiService, 'gateSeriesCandidatesWithDecisions');
        const canUseDecisionGate =
          options?.allowAiFallback !== false &&
          Boolean(process.env.GEMINI_API_KEY) &&
          Boolean(gateSeriesFn);

        if (!canUseDecisionGate || !gateSeriesFn) {
          for (const book of books) {
            outcomes.set(book.id, {status: 'escalate'});
          }
          return outcomes;
        }

        const CHUNK_SIZE = 15;
        const chunks: CoreBookData[][] = [];
        for (let i = 0; i < books.length; i += CHUNK_SIZE) {
          chunks.push(books.slice(i, i + CHUNK_SIZE));
        }

        await Promise.all(
          chunks.map(async chunk => {
            if (options?.signal?.aborted) {
              return;
            }
            const passedIds = await gateSeriesFn(
              chunk.map(b => ({
                id: b.id,
                title: b.title,
                author: b.author || 'Unknown Author',
                synopsis: extractExistingSynopsis(b),
              })),
              {
                priority: 'BATCH',
                signal: options?.signal,
              },
            );

            for (const book of chunk) {
              if (passedIds.has(book.id)) {
                outcomes.set(book.id, {status: 'escalate'});
              } else {
                outcomes.set(book.id, {
                  status: 'pruned',
                  reason: 'standalone_decision_gate',
                });
              }
            }
          }),
        );

        return outcomes;
      },
    },
    {
      id: 'series-catalog',
      tier: 'catalog',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        if (books.length === 0 || options?.signal?.aborted) {
          return outcomes;
        }

        const catalogMap = await hydrateCatalogForResidualBooks(books, {
          signal: options?.signal,
          verifyCovers: false,
          preferField: 'series',
        });

        const extractSeriesFn = getOptionalModuleFunction<
          typeof geminiService.extractBookSeriesBatch
        >(geminiService, 'extractBookSeriesBatch');
        const canEscalateToGenerative =
          options?.allowAiFallback !== false &&
          Boolean(process.env.GEMINI_API_KEY) &&
          Boolean(extractSeriesFn);

        for (const book of books) {
          const catalogHit = catalogMap.get(book.id);
          const catalogSeries = catalogHit?.details?.series?.trim();

          if (catalogSeries) {
            outcomes.set(book.id, {
              status: 'resolved',
              value: catalogSeries,
              winningProvider: catalogHit?.bonusCatalog?.winningProvider,
              ...(catalogHit?.bonusCatalog
                ? {bonusCatalog: catalogHit.bonusCatalog}
                : {}),
            });
          } else if (canEscalateToGenerative && book.title) {
            const hydratedSynopsis = catalogHit?.details?.synopsis?.trim();
            outcomes.set(book.id, {
              status: 'escalate',
              ...(hydratedSynopsis && !extractExistingSynopsis(book)
                ? {enrichedBook: {synopsis: hydratedSynopsis}}
                : {}),
              ...(catalogHit?.bonusCatalog
                ? {bonusCatalog: catalogHit.bonusCatalog}
                : {}),
            });
          }
        }

        return outcomes;
      },
    },
    {
      id: 'series-generative-fallback',
      tier: 'generative',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        const extractSeriesFn = getOptionalModuleFunction<
          typeof geminiService.extractBookSeriesBatch
        >(geminiService, 'extractBookSeriesBatch');
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false ||
          !process.env.GEMINI_API_KEY ||
          !extractSeriesFn
        ) {
          return outcomes;
        }

        const CHUNK_SIZE = 10;
        const chunks: CoreBookData[][] = [];
        for (let i = 0; i < books.length; i += CHUNK_SIZE) {
          chunks.push(books.slice(i, i + CHUNK_SIZE));
        }

        await Promise.all(
          chunks.map(async chunk => {
            if (options?.signal?.aborted) {
              return;
            }
            try {
              const aiSeriesMap = await extractSeriesFn(
                chunk.map(b => ({
                  id: b.id,
                  title: b.title,
                  author: b.author || 'Unknown Author',
                  synopsis: extractExistingSynopsis(b),
                })),
                {
                  priority: 'BATCH',
                  signal: options?.signal,
                  skipStandaloneGate: true,
                },
              );

              if (aiSeriesMap && typeof aiSeriesMap === 'object') {
                for (const book of chunk) {
                  const seriesVal = aiSeriesMap[book.id];
                  if (typeof seriesVal === 'string' && seriesVal.trim()) {
                    outcomes.set(book.id, {
                      status: 'resolved',
                      value: seriesVal.trim(),
                      winningProvider: 'gemini_generative',
                    });
                  } else if (seriesVal === null) {
                    outcomes.set(book.id, {
                      status: 'pruned',
                      reason: 'standalone_generative',
                    });
                  }
                }
              }
            } catch (err) {
              if ((err as Error)?.name !== 'AbortError') {
                console.warn(
                  'SeriesMetadataProvider Gemini fallback failed for chunk:',
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
    return MetadataKey.SERIES;
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
    const updatedSearchTokens = computeBookSearchTokens({
      title: book.title,
      author: book.author,
      isbn: book.isbn,
      series: typeof value === 'string' ? value : undefined,
    });
    return {
      bookUpdate: {
        series: value,
        ...(updatedSearchTokens.length > 0
          ? {searchTokens: updatedSearchTokens}
          : {}),
        enrichmentStatus: {
          ...existingStatus,
          series: 'completed',
        },
      },
      resultPreview: {
        id: book.id,
        series: value,
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
