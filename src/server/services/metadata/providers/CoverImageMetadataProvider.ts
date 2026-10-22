import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {catalogOrchestrator} from '../../catalog';

export class CoverImageMetadataProvider implements IMetadataProvider<
  string | null
> {
  getKey(): MetadataKey {
    return MetadataKey.COVER_IMAGE;
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<string | null> {
    if (options?.signal?.aborted) {
      return null;
    }
    try {
      // Query federated cover candidates across both ISBN and Title+Author providers
      // (including Apple Books 1000x1000 Ultra-Res covers, PRH ISBN CDN, Hardcover, Longitood, etc.)
      if (book.isbn || book.title) {
        const candidateRes = await catalogOrchestrator.fetchCoverCandidates(
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
          return candidateRes.candidates[0].url;
        }
      }

      if (options?.signal?.aborted) {
        return null;
      }

      if (book.isbn) {
        const details = await catalogOrchestrator.searchByIsbn(book.isbn, {
          priority: 'BATCH',
          verifyCovers: true,
          signal: options?.signal,
        });
        if (details?.coverUrl) {
          return details.coverUrl;
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
            verifyCovers: true,
            signal: options?.signal,
          },
        );
        const match = searchRes.books.find(b => Boolean(b.coverUrl));
        if (match?.coverUrl) {
          return match.coverUrl;
        }
      }

      return null;
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        console.error(
          `CoverImageMetadataProvider failed for "${book.title}":`,
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

    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true;
  }

  isAvailable(): boolean {
    return true;
  }
}
