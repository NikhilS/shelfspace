import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {generateBookInsights} from '../../gemini';

export class AuthorBioMetadataProvider implements IMetadataProvider<string> {
  getKey(): MetadataKey {
    return MetadataKey.AUTHOR_BIO;
  }

  async fetch(book: CoreBookData): Promise<string> {
    const bio = await generateBookInsights(
      book.title,
      book.author,
      'author_bio',
    );
    return bio || '';
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    const {throttledMapWithRetry} = await import('../../../../lib/utils');
    await throttledMapWithRetry(books, 5, async book => {
      try {
        const res = await this.fetch(book);
        if (res) {
          results[book.id] = res;
        }
      } catch (error) {
        console.error(`Author bio batch error for ${book.id}:`, error);
      }
    });
    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true; // Simple single call
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
