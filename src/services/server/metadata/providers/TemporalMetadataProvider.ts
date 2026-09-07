import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {
  extractBookTemporalMetadataBatch,
  TemporalBookResult,
} from '../../gemini';
import {resolveBookSynopses} from '../utils';

export class TemporalMetadataProvider implements IMetadataProvider<unknown> {
  getKey(): MetadataKey {
    return MetadataKey.TEMPORAL;
  }

  async fetch(book: CoreBookData): Promise<unknown> {
    const batchResult = await this.bulkFetch([book]);
    return batchResult[book.id] || null;
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, unknown>> {
    const synopsisMap = await resolveBookSynopses(books);
    const batchedBooks = books.map(b => ({
      id: b.id,
      title: b.title,
      author: b.author,
      synopsis: synopsisMap.get(b.id),
    }));

    const CHUNK_SIZE = 10;
    const results: Record<string, unknown> = {};

    for (let i = 0; i < batchedBooks.length; i += CHUNK_SIZE) {
      const chunk = batchedBooks.slice(i, i + CHUNK_SIZE);
      const temporalResult = await extractBookTemporalMetadataBatch(chunk);

      if (temporalResult && temporalResult.enrichment) {
        temporalResult.enrichment.forEach((item: TemporalBookResult) => {
          if (item.id) {
            // Keep the raw item minus the id
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const {id, ...data} = item;
            results[item.id] = data;
          }
        });
      }
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
