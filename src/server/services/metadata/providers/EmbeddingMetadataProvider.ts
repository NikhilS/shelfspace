import {
  IMetadataProvider,
  MetadataBulkFetchOptions,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {generateBookEmbeddings} from '../../gemini';

export class EmbeddingMetadataProvider implements IMetadataProvider<number[]> {
  getKey(): MetadataKey {
    return MetadataKey.EMBEDDING;
  }

  private buildEmbeddingText(book: CoreBookData): string {
    const parts = [book.title];
    if (book.author) parts.push(`by ${book.author}`);
    if (book.primaryGenre) {
      const genreStr =
        book.subgenres && book.subgenres.length > 0
          ? `${book.primaryGenre}: ${book.subgenres.join(', ')}`
          : book.primaryGenre;
      parts.push(`[${genreStr}]`);
    }
    const syn = book.synopsis || book.description;
    if (syn && typeof syn === 'string') parts.push(syn);
    return parts.join(' - ');
  }

  async fetch(
    book: CoreBookData,
    options?: MetadataBulkFetchOptions,
  ): Promise<number[]> {
    const batchResult = await this.bulkFetch([book], options);
    return batchResult[book.id] || [];
  }

  async bulkFetch(
    books: CoreBookData[],
    options?: MetadataBulkFetchOptions,
  ): Promise<Record<string, number[]>> {
    const results: Record<string, number[]> = {};
    if (
      books.length === 0 ||
      options?.signal?.aborted ||
      options?.allowAiFallback === false
    ) {
      return results;
    }

    const texts = books.map(b => this.buildEmbeddingText(b));
    const embeddings = await generateBookEmbeddings(texts, undefined, {
      priority: 'BATCH',
      signal: options?.signal,
    });

    if (embeddings && Array.isArray(embeddings)) {
      books.forEach((b, idx) => {
        if (embeddings[idx] && embeddings[idx].length > 0) {
          results[b.id] = embeddings[idx];
        }
      });
    }

    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true;
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
