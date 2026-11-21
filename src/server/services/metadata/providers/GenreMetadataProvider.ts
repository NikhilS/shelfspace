import {z} from 'zod';
import {GENRE_CONFIDENCE_THRESHOLD} from '../../../../constants/enrichment';
import {
  type BookGenreData,
  type CoreBookData,
  type EnrichmentPipelineStage,
  type MetadataBulkFetchOptions,
  MetadataKey,
  type MetadataPersistenceContext,
  type MetadataPersistencePatch,
  type MetadataPlugin,
  type StageBookOutcome,
} from '../../../../types/metadata';
import {classifyBooks} from '../../gemini';
import {hydrateCatalogForResidualBooks} from '../bonusCatalogPatcher';
import {runPluginStagesToRecord} from '../stageRunner';

const genrePluginOutputSchema: z.ZodType<BookGenreData> = z.object({
  primaryGenre: z.string().min(1),
  subgenres: z.array(z.string()).optional(),
  isCustomPrimary: z.boolean().optional(),
});

function extractExistingSynopsis(book?: CoreBookData): string | undefined {
  if (!book) {
    return undefined;
  }
  const raw = book.synopsis;
  return typeof raw === 'string' && raw.trim().length > 0
    ? raw.trim()
    : undefined;
}

const EFFECTIVE_GENRE_CONFIDENCE_THRESHOLD = GENRE_CONFIDENCE_THRESHOLD;

export class GenreMetadataProvider implements MetadataPlugin<BookGenreData> {
  readonly statusKey = 'genre' as const;
  readonly needsSynopsis = true;
  readonly supportsHybridAiFallback = false;
  readonly outputSchema = genrePluginOutputSchema;

  readonly stages: ReadonlyArray<EnrichmentPipelineStage<BookGenreData>> = [
    {
      id: 'genre-decision',
      tier: 'decision',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<BookGenreData>>();
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

        const confidenceThreshold = EFFECTIVE_GENRE_CONFIDENCE_THRESHOLD;

        await Promise.all(
          chunks.map(async chunk => {
            if (options?.signal?.aborted) {
              return;
            }
            const genreResult = await classifyBooks(chunk, {
              priority: 'BATCH',
              signal: options?.signal,
              customGenres: options?.customGenres,
              includeConfidence: true,
            });

            if (Array.isArray(genreResult)) {
              for (const item of genreResult) {
                if (!item.id || !item.primaryGenre) {
                  continue;
                }
                const value: BookGenreData = {
                  primaryGenre: item.primaryGenre,
                  subgenres: item.subgenres || [],
                  isCustomPrimary: Boolean(item.isCustomPrimary),
                };
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
                    fallbackValue: value,
                  });
                } else {
                  outcomes.set(item.id, {
                    status: 'resolved',
                    value,
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
      id: 'genre-catalog-repass',
      tier: 'catalog',
      execute: async ({books, options, priorEscalations}) => {
        const outcomes = new Map<string, StageBookOutcome<BookGenreData>>();
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
              const repassResult = await classifyBooks(chunk, {
                priority: 'BATCH',
                signal: options?.signal,
                customGenres: options?.customGenres,
                includeConfidence: true,
              });

              const repassById = new Map(
                (Array.isArray(repassResult) ? repassResult : []).map(item => [
                  item.id,
                  item,
                ]),
              );

              for (const b of chunk) {
                const refreshed = repassById.get(b.id);
                const catalogHit = catalogMap.get(b.id);
                const priorFallback = priorEscalations?.get(
                  b.id,
                )?.fallbackValue;
                if (refreshed && refreshed.primaryGenre) {
                  outcomes.set(b.id, {
                    status: 'resolved',
                    value: {
                      primaryGenre: refreshed.primaryGenre,
                      subgenres: refreshed.subgenres || [],
                      isCustomPrimary: Boolean(refreshed.isCustomPrimary),
                    },
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
    return MetadataKey.GENRE;
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<BookGenreData> {
    const batchResult = await this.bulkFetch([book], options);
    return (
      batchResult[book.id] || {
        primaryGenre: 'Other',
        subgenres: [],
        isCustomPrimary: true,
      }
    );
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, BookGenreData>> {
    return runPluginStagesToRecord(this.stages, books, options);
  }

  toPersistencePatch({
    book,
    value,
    existingStatus,
  }: MetadataPersistenceContext<BookGenreData>): MetadataPersistencePatch {
    const subgenres = value.subgenres || [];
    const isCustomPrimary = Boolean(value.isCustomPrimary);
    return {
      bookUpdate: {
        primaryGenre: value.primaryGenre,
        subgenres,
        isCustomPrimary,
        enrichmentStatus: {
          ...existingStatus,
          genre: 'completed',
        },
      },
      resultPreview: {
        id: book.id,
        primaryGenre: value.primaryGenre,
        subgenres,
        isCustomPrimary,
      },
    };
  }

  shouldFetchOnCreate(): boolean {
    return true;
  }

  isAvailable(): boolean {
    return Boolean(process.env.GEMINI_API_KEY);
  }
}
