import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {
  extractBookTemporalMetadataBatch,
  TemporalBookResult,
} from '../../gemini';
import {MetadataRegistry} from '../registry';

export class TemporalMetadataProvider implements IMetadataProvider<unknown> {
  getKey(): MetadataKey {
    return MetadataKey.TEMPORAL;
  }

  private async getSynopsis(book: CoreBookData): Promise<string | undefined> {
    if ('synopsis' in book)
      return (book as Record<string, unknown>).synopsis as string | undefined;
    const synopsisProvider = MetadataRegistry.getInstance().getProvider(
      MetadataKey.SYNOPSIS,
    );
    return synopsisProvider ? await synopsisProvider.fetch(book) : undefined;
  }

  async fetch(book: CoreBookData): Promise<unknown> {
    const batchResult = await this.bulkFetch([book]);
    return batchResult[book.id] || null;
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, unknown>> {
    const batchedBooks = await Promise.all(
      books.map(async b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        synopsis: await this.getSynopsis(b),
      })),
    );

    const temporalResult = await extractBookTemporalMetadataBatch(batchedBooks);

    const results: Record<string, unknown> = {};
    if (temporalResult && temporalResult.enrichment) {
      temporalResult.enrichment.forEach((item: TemporalBookResult) => {
        if (item.id) {
          // Keep the raw item minus the id
          const data = {...item};
          delete data.id;
          results[item.id] = data;
        }
      });
    }
    return results;
  }

  shouldFetchOnCreate(): boolean {
    return false; // Typically a tier 2 / batch op
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
