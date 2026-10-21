import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {catalogOrchestrator} from '../../catalog';
import {extractBookSeriesBatch} from '../../gemini';

export class SeriesMetadataProvider implements IMetadataProvider<
  string | null
> {
  getKey(): MetadataKey {
    return MetadataKey.SERIES;
  }

  private async fetchFromCatalog(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<string | null> {
    if (options?.signal?.aborted) return null;
    try {
      if (book.isbn) {
        const details = await catalogOrchestrator.searchByIsbn(book.isbn, {
          priority: 'BATCH',
          verifyCovers: false,
          signal: options?.signal,
        });
        if (details?.series && details.series.trim()) {
          return details.series.trim();
        }
      }

      if (options?.signal?.aborted) return null;

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
        const match = searchRes?.books?.find(b =>
          Boolean(b.series && b.series.trim()),
        );
        if (match?.series) {
          return match.series.trim();
        }
      }

      return null;
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error(
          `SeriesMetadataProvider catalog lookup failed for "${book.title}":`,
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
    const batchRes = await this.bulkFetch([book], options);
    return batchRes[book.id] ?? null;
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
        results[book.id] = await this.fetchFromCatalog(book, options);
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
      typeof extractBookSeriesBatch === 'function'
    ) {
      const CHUNK_SIZE = 10;
      const chunks: Array<
        Array<{
          id: string;
          title: string;
          author: string;
          synopsis?: string;
        }>
      > = [];
      for (let i = 0; i < remaining.length; i += CHUNK_SIZE) {
        chunks.push(
          remaining.slice(i, i + CHUNK_SIZE).map(b => ({
            id: b.id,
            title: b.title,
            author: b.author || 'Unknown Author',
            synopsis:
              typeof b.synopsis === 'string'
                ? b.synopsis
                : typeof b.description === 'string'
                  ? b.description
                  : undefined,
          })),
        );
      }
      await Promise.all(
        chunks.map(async chunk => {
          if (options?.signal?.aborted) return;
          try {
            const aiSeriesMap = await extractBookSeriesBatch(chunk, {
              priority: 'BATCH',
              signal: options?.signal,
            });
            if (aiSeriesMap && typeof aiSeriesMap === 'object') {
              for (const [bookId, seriesVal] of Object.entries(aiSeriesMap)) {
                if (seriesVal && seriesVal.trim()) {
                  results[bookId] = seriesVal.trim();
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
