import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {generateBookInsights} from '../../gemini';
import {throttledMapWithRetry} from '../../../../lib/utils';

export class SynopsisMetadataProvider implements IMetadataProvider<string> {
  getKey(): MetadataKey {
    return MetadataKey.SYNOPSIS;
  }

  async fetch(book: CoreBookData): Promise<string> {
    const synopsis = await generateBookInsights(
      book.title,
      book.author,
      'synopsis',
    );
    return synopsis || '';
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, string>> {
    // There is no bulk batch API for insights natively, so we map in parallel
    const results: Record<string, string> = {};
    await throttledMapWithRetry(books, 5, async book => {
      try {
        const res = await this.fetch(book);
        if (res) {
          results[book.id] = res;
        }
      } catch (error) {
        console.error(`Synopsis batch error for ${book.id}:`, error);
      }
    });
    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true; // Tier 1 dependency
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
