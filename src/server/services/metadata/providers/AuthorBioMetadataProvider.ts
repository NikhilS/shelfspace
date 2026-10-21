import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {wikipediaProvider} from '../../catalog';
import {generateAuthorBiosBatch} from '../../gemini';

export class AuthorBioMetadataProvider implements IMetadataProvider<
  string | null
> {
  getKey(): MetadataKey {
    return MetadataKey.AUTHOR_BIO;
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<string | null> {
    if (options?.signal?.aborted) return null;
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

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, string | null>> {
    const results: Record<string, string | null> = {};
    const inFlightByAuthor = new Map<string, Promise<string | null>>();

    await Promise.all(
      books.map(async book => {
        if (options?.signal?.aborted) {
          results[book.id] = null;
          return;
        }
        const cleanAuthor = (book.author || '').trim().toLowerCase();
        if (!cleanAuthor || cleanAuthor === 'unknown author') {
          results[book.id] = null;
          return;
        }
        let promise = inFlightByAuthor.get(cleanAuthor);
        if (!promise) {
          promise = this.fetch(book, options);
          inFlightByAuthor.set(cleanAuthor, promise);
        }
        results[book.id] = await promise;
      }),
    );

    if (options?.signal?.aborted) {
      return results;
    }

    const remaining = books.filter(
      b =>
        !results[b.id] &&
        b.author &&
        b.author.trim().toLowerCase() !== 'unknown author',
    );
    if (
      remaining.length > 0 &&
      options?.allowAiFallback !== false &&
      Boolean(process.env.GEMINI_API_KEY) &&
      typeof generateAuthorBiosBatch === 'function'
    ) {
      const CHUNK_SIZE = 10;
      const chunks: Array<Array<{id: string; title: string; author: string}>> =
        [];
      for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
        chunks.push(
          remaining.slice(i, i + CHUNK_SIZE).map(b => ({
            id: b.id,
            title: b.title,
            author: b.author,
          })),
        );
      }
      await Promise.all(
        chunks.map(async chunk => {
          if (options?.signal?.aborted) return;
          try {
            const aiBios = await generateAuthorBiosBatch(chunk, {
              priority: 'BATCH',
              signal: options?.signal,
            });
            if (aiBios && typeof aiBios === 'object') {
              for (const [id, bio] of Object.entries(aiBios)) {
                if (bio && bio.trim()) {
                  results[id] = bio.trim();
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
