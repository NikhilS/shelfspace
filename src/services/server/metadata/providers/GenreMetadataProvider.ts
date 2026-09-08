import {
  IMetadataProvider,
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

  async fetch(book: CoreBookData): Promise<BookGenreData> {
    const batchResult = await this.bulkFetch([book]);
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
  ): Promise<Record<string, BookGenreData>> {
    const synopsisMap = await resolveBookSynopses(books);
    const batchedBooks = books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      synopsis: synopsisMap.get(b.id),
    }));

    const CHUNK_SIZE = 10;
    const results: Record<string, BookGenreData> = {};

    for (let i = 0; i < batchedBooks.length; i += CHUNK_SIZE) {
      const chunk = batchedBooks.slice(i, i + CHUNK_SIZE);
      const classificationResult = await classifyBooks(chunk);

      if (classificationResult && Array.isArray(classificationResult)) {
        classificationResult.forEach(item => {
          if (item.id && item.primaryGenre) {
            results[item.id] = {
              primaryGenre: item.primaryGenre,
              subgenres: item.subgenres || [],
              isCustomPrimary: item.isCustomPrimary,
            };
          }
        });
      }
    }

    return results;
  }

  shouldFetchOnCreate(): boolean {
    return false; // Can be batch
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
