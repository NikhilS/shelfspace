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
import {wikipediaProvider} from '../../catalog';
import * as geminiService from '../../gemini';
import {
  getOptionalModuleFunction,
  runPluginStagesToRecord,
} from '../stageRunner';

const authorBioPluginOutputSchema: z.ZodType<string | null> = z
  .string()
  .nullable();

export class AuthorBioMetadataProvider implements MetadataPlugin<
  string | null
> {
  readonly statusKey = 'authorBio' as const;
  readonly needsSynopsis = false;
  readonly supportsHybridAiFallback = true;
  readonly outputSchema = authorBioPluginOutputSchema;

  readonly stages: ReadonlyArray<EnrichmentPipelineStage<string | null>> = [
    {
      id: 'author-bio-catalog',
      tier: 'catalog',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        if (books.length === 0 || options?.signal?.aborted) {
          return outcomes;
        }

        const inFlightByAuthor = new Map<string, Promise<string | null>>();
        const generateBiosFn = getOptionalModuleFunction<
          typeof geminiService.generateAuthorBiosBatch
        >(geminiService, 'generateAuthorBiosBatch');
        const canEscalateToGenerative =
          options?.allowAiFallback !== false &&
          Boolean(process.env.GEMINI_API_KEY) &&
          Boolean(generateBiosFn);

        await Promise.all(
          books.map(async book => {
            if (options?.signal?.aborted) {
              return;
            }
            const cleanAuthor = (book.author || '').trim().toLowerCase();
            if (!cleanAuthor || cleanAuthor === 'unknown author') {
              return;
            }
            let promise = inFlightByAuthor.get(cleanAuthor);
            if (!promise) {
              promise = this.fetchFromWikipedia(book, options);
              inFlightByAuthor.set(cleanAuthor, promise);
            }
            const bio = await promise;
            if (bio && bio.trim()) {
              outcomes.set(book.id, {
                status: 'resolved',
                value: bio,
                winningProvider: 'Wikipedia',
              });
            } else if (canEscalateToGenerative) {
              outcomes.set(book.id, {status: 'escalate'});
            }
          }),
        );

        return outcomes;
      },
    },
    {
      id: 'author-bio-generative-fallback',
      tier: 'generative',
      execute: async ({books, options}) => {
        const outcomes = new Map<string, StageBookOutcome<string | null>>();
        const generateBiosFn = getOptionalModuleFunction<
          typeof geminiService.generateAuthorBiosBatch
        >(geminiService, 'generateAuthorBiosBatch');
        if (
          books.length === 0 ||
          options?.signal?.aborted ||
          options?.allowAiFallback === false ||
          !process.env.GEMINI_API_KEY ||
          !generateBiosFn
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
              author: b.author,
            })),
          );
        }

        await Promise.all(
          chunks.map(async chunk => {
            if (options?.signal?.aborted) {
              return;
            }
            try {
              const aiBios = await generateBiosFn(chunk, {
                priority: 'BATCH',
                signal: options?.signal,
              });
              if (aiBios && typeof aiBios === 'object') {
                for (const [id, bio] of Object.entries(aiBios)) {
                  if (bio && bio.trim()) {
                    outcomes.set(id, {
                      status: 'resolved',
                      value: bio.trim(),
                      winningProvider: 'gemini_generative',
                    });
                  }
                }
              }
            } catch (err) {
              if ((err as Error)?.name !== 'AbortError') {
                console.warn(
                  'AuthorBioMetadataProvider Gemini fallback failed:',
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
    return MetadataKey.AUTHOR_BIO;
  }

  private async fetchFromWikipedia(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<string | null> {
    if (options?.signal?.aborted) {
      return null;
    }
    try {
      if (!book.author || book.author === 'Unknown Author') {
        return null;
      }

      return await wikipediaProvider.fetchAuthorBio(book.author, {
        priority: 'BATCH',
        signal: options?.signal,
      });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error(
          `AuthorBioMetadataProvider failed for "${book.author}":`,
          error,
        );
      }
      return null;
    }
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<string | null> {
    return this.fetchFromWikipedia(book, options);
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
      hasAuthorBio: true,
    };
    return {
      bookUpdate: {
        bookDetailsMetadata: nextDetailsMeta,
        enrichmentStatus: {
          ...existingStatus,
          authorBio: 'completed',
        },
      },
      detailsUpdate: {
        authorBio: value,
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
