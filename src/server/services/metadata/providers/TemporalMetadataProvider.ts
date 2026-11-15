import {z} from 'zod';
import {TEMPORAL_CONFIDENCE_THRESHOLD} from '../../../../constants/enrichment';
import {
  bookTemporalMetadataSchema,
  type BookTemporalMetadata,
} from '../../../../schemas/book';
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
import {
  extractBookTemporalMetadataBatch,
  type TemporalBookResult,
} from '../../gemini';
import {hydrateCatalogForResidualBooks} from '../bonusCatalogPatcher';
import {runPluginStagesToRecord} from '../stageRunner';

const temporalPluginOutputSchema: z.ZodType<BookTemporalMetadata | null> =
  bookTemporalMetadataSchema.nullable();

function extractExistingSynopsis(book?: CoreBookData): string | undefined {
  if (!book) {
    return undefined;
  }
  const raw = book.synopsis || book.description;
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : undefined;
}

const EFFECTIVE_TEMPORAL_CONFIDENCE_THRESHOLD = TEMPORAL_CONFIDENCE_THRESHOLD;

function toTemporalMetadataRecord(
  item: TemporalBookResult & {eraLabel?: string},
): BookTemporalMetadata {
  const era = item.eraName || item.eraLabel;
  return {
    isNonHistorical: item.isNonHistorical,
    ...(item.startYear !== undefined ? {startYear: item.startYear} : {}),
    ...(item.endYear !== undefined ? {endYear: item.endYear} : {}),
    ...(era ? {eraLabel: era, eraName: era} : {}),
    ...(item.rationale ? {rationale: item.rationale} : {}),
    lastSyncedAt: new Date().toISOString(),
  };
}

export class TemporalMetadataProvider implements MetadataPlugin<BookTemporalMetadata | null> {
  readonly statusKey = 'temporal' as const;
  readonly needsSynopsis = true;
  readonly supportsHybridAiFallback = false;
  readonly outputSchema = temporalPluginOutputSchema;

  readonly stages: ReadonlyArray<
    EnrichmentPipelineStage<BookTemporalMetadata | null>
  > = [
    {
      id: 'temporal-decision',
      tier: 'decision',
      execute: async ({books, options}) => {
        const outcomes = new Map<
          string,
          StageBookOutcome<BookTemporalMetadata | null>
        >();
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false
        ) {
          return outcomes;
        }

        const bookById = new Map(books.map(b => [b.id, b]));
        const batchedBooks = books.map(b => ({
          id: b.id,
          title: b.title,
          author: b.author,
          synopsis: extractExistingSynopsis(b),
        }));

        const CHUNK_SIZE = 10;
        const chunks: Array<typeof batchedBooks> = [];
        for (let i = 0; i < batchedBooks.length; i += CHUNK_SIZE) {
          chunks.push(batchedBooks.slice(i, i + CHUNK_SIZE));
        }

        const confidenceThreshold = EFFECTIVE_TEMPORAL_CONFIDENCE_THRESHOLD;

        await Promise.all(
          chunks.map(async chunk => {
            if (options?.signal?.aborted) {
              return;
            }
            const temporalResult = await extractBookTemporalMetadataBatch(
              chunk,
              {
                priority: 'BATCH',
                signal: options?.signal,
                includeConfidence: true,
              },
            );

            if (temporalResult && temporalResult.enrichment) {
              for (const item of temporalResult.enrichment as Array<
                TemporalBookResult & {eraLabel?: string}
              >) {
                if (!item.id) {
                  continue;
                }
                const metadata = toTemporalMetadataRecord(item);
                const sourceBook = bookById.get(item.id);
                const hasSavedSynopsis = Boolean(
                  extractExistingSynopsis(sourceBook),
                );
                const isLowConfidence =
                  typeof item.confidence === 'number' &&
                  item.confidence < confidenceThreshold;

                if (!hasSavedSynopsis && isLowConfidence) {
                  outcomes.set(item.id, {
                    status: 'escalate',
                    fallbackValue: metadata,
                  });
                } else {
                  outcomes.set(item.id, {
                    status: 'resolved',
                    value: metadata,
                    winningProvider: 'gemini_decisions',
                  });
                }
              }
            }
          }),
        );

        return outcomes;
      },
    },
    {
      id: 'temporal-catalog-repass',
      tier: 'catalog',
      execute: async ({books, options, priorEscalations}) => {
        const outcomes = new Map<
          string,
          StageBookOutcome<BookTemporalMetadata | null>
        >();
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false
        ) {
          return outcomes;
        }

        const catalogMap = await hydrateCatalogForResidualBooks(books, {
          signal: options?.signal,
          verifyCovers: false,
          preferField: 'synopsis',
        });

        if (options?.signal?.aborted) {
          return outcomes;
        }

        const booksForRepass: Array<{
          id: string;
          title: string;
          author: string;
          synopsis: string;
        }> = [];

        for (const book of books) {
          const catalogHit = catalogMap.get(book.id);
          const hydratedSynopsis = catalogHit?.details?.synopsis?.trim();
          const priorFallback = priorEscalations?.get(book.id)?.fallbackValue;

          if (hydratedSynopsis && hydratedSynopsis.length > 0) {
            booksForRepass.push({
              id: book.id,
              title: book.title,
              author: book.author,
              synopsis: hydratedSynopsis,
            });
          } else if (priorFallback !== undefined) {
            outcomes.set(book.id, {
              status: 'resolved',
              value: priorFallback,
              winningProvider: 'gemini_decisions',
              ...(catalogHit?.bonusCatalog
                ? {bonusCatalog: catalogHit.bonusCatalog}
                : {}),
            });
          }
        }

        if (booksForRepass.length > 0 && !options?.signal?.aborted) {
          const CHUNK_SIZE = 10;
          const chunks: Array<typeof booksForRepass> = [];
          for (let i = 0; i < booksForRepass.length; i += CHUNK_SIZE) {
            chunks.push(booksForRepass.slice(i, i + CHUNK_SIZE));
          }

          await Promise.all(
            chunks.map(async chunk => {
              if (options?.signal?.aborted) {
                return;
              }
              const repassResult = await extractBookTemporalMetadataBatch(
                chunk,
                {
                  priority: 'BATCH',
                  signal: options?.signal,
                  includeConfidence: true,
                },
              );

              const repassById = new Map(
                (repassResult?.enrichment ?? []).map(item => [
                  item.id,
                  item as TemporalBookResult & {eraLabel?: string},
                ]),
              );

              for (const b of chunk) {
                const refreshed = repassById.get(b.id);
                const catalogHit = catalogMap.get(b.id);
                const priorFallback = priorEscalations?.get(
                  b.id,
                )?.fallbackValue;
                if (refreshed) {
                  outcomes.set(b.id, {
                    status: 'resolved',
                    value: toTemporalMetadataRecord(refreshed),
                    winningProvider: 'gemini_decisions',
                    ...(catalogHit?.bonusCatalog
                      ? {bonusCatalog: catalogHit.bonusCatalog}
                      : {}),
                  });
                } else if (priorFallback !== undefined) {
                  outcomes.set(b.id, {
                    status: 'resolved',
                    value: priorFallback,
                    winningProvider: 'gemini_decisions',
                    ...(catalogHit?.bonusCatalog
                      ? {bonusCatalog: catalogHit.bonusCatalog}
                      : {}),
                  });
                }
              }
            }),
          );
        }

        return outcomes;
      },
    },
  ];

  getKey(): MetadataKey {
    return MetadataKey.TEMPORAL;
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<BookTemporalMetadata | null> {
    const batchResult = await this.bulkFetch([book], options);
    return batchResult[book.id] || null;
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, BookTemporalMetadata | null>> {
    return runPluginStagesToRecord(this.stages, books, options);
  }

  toPersistencePatch({
    book,
    value,
    existingStatus,
  }: MetadataPersistenceContext<BookTemporalMetadata | null>): MetadataPersistencePatch {
    const resolvedStatus = value?.isNonHistorical ? 'unsupported' : 'completed';
    return {
      bookUpdate: {
        temporalMetadata: value,
        enrichmentStatus: {
          ...existingStatus,
          temporal: resolvedStatus,
        },
      },
      resultPreview: {
        id: book.id,
        temporalMetadata: value,
      },
    };
  }

  shouldFetchOnCreate(): boolean {
    return false;
  }

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }
}
