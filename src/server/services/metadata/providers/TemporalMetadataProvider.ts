import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
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

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<unknown> {
    const batchResult = await this.bulkFetch([book], options);
    return batchResult[book.id] || null;
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, unknown>> {
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
    const results: Record<string, unknown> = {};
    const chunks: Array<typeof batchedBooks> = [];

    for (let i = 0; i < batchedBooks.length; i += CHUNK_SIZE) {
      chunks.push(batchedBooks.slice(i, i + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map(async chunk => {
        if (options?.signal?.aborted) {
          return;
        }
        const temporalResult = await extractBookTemporalMetadataBatch(chunk, {
          priority: 'BATCH',
          signal: options?.signal,
        });

        if (temporalResult && temporalResult.enrichment) {
          for (const item of temporalResult.enrichment as Array<
            TemporalBookResult & {eraLabel?: string}
          >) {
            if (item.id) {
              const era = item.eraName || item.eraLabel;
              results[item.id] = {
                isNonHistorical: item.isNonHistorical,
                ...(item.startYear !== undefined
                  ? {startYear: item.startYear}
                  : {}),
                ...(item.endYear !== undefined ? {endYear: item.endYear} : {}),
                ...(era ? {eraLabel: era, eraName: era} : {}),
                ...(item.rationale ? {rationale: item.rationale} : {}),
                lastSyncedAt: new Date().toISOString(),
              };
            }
          }
        }
      }),
    );

    return results;
  }

  shouldFetchOnCreate(): boolean {
    return false;
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
