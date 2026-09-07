import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {classifyBooks} from '../../gemini';
import {resolveBookSynopses} from '../utils';

export class GenreMetadataProvider implements IMetadataProvider<string[]> {
  getKey(): MetadataKey {
    return MetadataKey.GENRE;
  }

  async fetch(book: CoreBookData): Promise<string[]> {
    const batchResult = await this.bulkFetch([book]);
    return batchResult[book.id] || [];
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, string[]>> {
    const synopsisMap = await resolveBookSynopses(books);
    const batchedBooks = books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      synopsis: synopsisMap.get(b.id),
    }));

    const CHUNK_SIZE = 10;
    const results: Record<string, string[]> = {};

    for (let i = 0; i < batchedBooks.length; i += CHUNK_SIZE) {
      const chunk = batchedBooks.slice(i, i + CHUNK_SIZE);
      const classificationResult = await classifyBooks(chunk);

      if (classificationResult && Array.isArray(classificationResult)) {
        classificationResult.forEach((item: {id: string; genres: string[]}) => {
          if (item.id && item.genres) {
            results[item.id] = item.genres;
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
