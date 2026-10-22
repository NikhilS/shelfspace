import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
  MetadataKey,
  CoreBookData,
  BookGenreData,
} from '../../../../types/metadata';
import {classifyBooks} from '../../gemini';
import {resolveBookSynopses} from '../utils';

export class GenreMetadataProvider implements IMetadataProvider<BookGenreData> {
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
    if (options?.signal?.aborted || options?.allowAiFallback === false) {
      return {};
    }
    const synopsisMap = await resolveBookSynopses(books, options);
    if (options?.signal?.aborted) {
      return {};
    }

    const batchedBooks = books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      synopsis: synopsisMap.get(b.id),
    }));

    const CHUNK_SIZE = 10;
    const results: Record<string, BookGenreData> = {};
    const chunks: Array<typeof batchedBooks> = [];

    for (let i = 0; i < batchedBooks.length; i += CHUNK_SIZE) {
      chunks.push(batchedBooks.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map(async chunk => {
        if (options?.signal?.aborted) {
          return;
        }
        const genreResult = await classifyBooks(chunk, {
          priority: 'BATCH',
          signal: options?.signal,
          customGenres: options?.customGenres,
        });

        if (Array.isArray(genreResult)) {
          for (const item of genreResult) {
            if (item.id && item.primaryGenre) {
              results[item.id] = {
                primaryGenre: item.primaryGenre,
                subgenres: item.subgenres || [],
                isCustomPrimary: Boolean(item.isCustomPrimary),
              };
            }
          }
        }
      }),
    );

    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true;
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
