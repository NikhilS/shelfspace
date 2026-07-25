import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {classifyBooks} from '../../gemini';
import {MetadataRegistry} from '../registry';

export class GenreMetadataProvider implements IMetadataProvider<string[]> {
  getKey(): MetadataKey {
    return MetadataKey.GENRE;
  }

  private async getSynopsis(book: CoreBookData): Promise<string | undefined> {
    if ('synopsis' in book)
      return (book as Record<string, unknown>).synopsis as string | undefined;
    const synopsisProvider = MetadataRegistry.getInstance().getProvider(
      MetadataKey.SYNOPSIS,
    );
    return synopsisProvider
      ? ((await synopsisProvider.fetch(book)) as string | undefined)
      : undefined;
  }

  async fetch(book: CoreBookData): Promise<string[]> {
    const batchResult = await this.bulkFetch([book]);
    return batchResult[book.id] || [];
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, string[]>> {
    const batchedBooks = await Promise.all(
      books.map(async b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        synopsis: await this.getSynopsis(b),
      })),
    );

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
