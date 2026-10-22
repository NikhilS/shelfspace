import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {catalogOrchestrator} from '../../catalog';
import {generateBookSynopsesBatch} from '../../gemini';

export class SynopsisMetadataProvider implements IMetadataProvider<
  string | null
> {
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
    try {
      if (book.isbn) {
        const details = await catalogOrchestrator.searchByIsbn(book.isbn, {
          priority: 'BATCH',
          verifyCovers: false,
          signal: options?.signal,
        });
        if (details?.synopsis) {
          return details.synopsis;
        }
      }

      if (options?.signal?.aborted) {
        return null;
      }

      if (book.title) {
        const searchRes = await catalogOrchestrator.searchByQuery(
          {
            title: book.title,
            author: book.author || '',
            isbn: book.isbn,
            limit: 3,
          },
          {
            priority: 'BATCH',
            verifyCovers: false,
            signal: options?.signal,
          },
        );
        const match = searchRes.books.find(b => Boolean(b.synopsis));
        if (match?.synopsis) {
          return match.synopsis;
        }
      }

      return null;
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error(
          `SynopsisMetadataProvider failed for "${book.title}":`,
          error,
        );
      }
      return null;
    }
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};

    await Promise.all(
      books.map(async book => {
        if (options?.signal?.aborted) {
          results[book.id] = null;
          return;
        }
        results[book.id] = await this.fetch(book, options);
      }),
    );

    if (options?.signal?.aborted) {
      return results;
    }

    const remaining = books.filter(b => !results[b.id] && b.title);
    if (
      remaining.length > 0 &&
      options?.allowAiFallback !== false &&
      Boolean(process.env.GEMINI_API_KEY) &&
      typeof generateBookSynopsesBatch === 'function'
    ) {
      const CHUNK_SIZE = 10;
      const chunks: Array<Array<{id: string; title: string; author: string}>> =
        [];
      for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
        chunks.push(
          remaining.slice(i, i + CHUNK_SIZE).map(b => ({
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
            const aiSynopses = await generateBookSynopsesBatch(chunk, {
              priority: 'BATCH',
              signal: options?.signal,
            });
            if (aiSynopses && typeof aiSynopses === 'object') {
              for (const [id, syn] of Object.entries(aiSynopses)) {
                if (syn && syn.trim()) {
                  results[id] = syn.trim();
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
    }

    return results;
  }

  shouldFetchOnCreate(): boolean {
    return false;
  }

  isAvailable(): boolean {
    return true;
  }
}
