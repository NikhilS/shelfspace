import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {generateBookEmbeddings} from '../../gemini';

function formatEmbeddingInput(book: CoreBookData): string {
  const genrePart = book.primaryGenre
    ? `. Genre: ${book.primaryGenre}${book.subgenres?.length ? ` (${book.subgenres.join(', ')})` : ''}`
    : '';
  const synopsisPart = book.synopsis ? `. ${book.synopsis}` : '';
  return `${book.title} by ${book.author}${genrePart}${synopsisPart}`;
}

export class EmbeddingMetadataProvider implements IMetadataProvider<number[]> {
  getKey(): MetadataKey {
    return MetadataKey.EMBEDDING;
  }

  async fetch(book: CoreBookData): Promise<number[]> {
    const text = formatEmbeddingInput(book);
    const result = await generateBookEmbeddings([text]);
    return result[0] || [];
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, number[]>> {
    // Generate embeddings for all books
    const texts = books.map(formatEmbeddingInput);
    const embeddings = await generateBookEmbeddings(texts);

    const results: Record<string, number[]> = {};
    if (embeddings && embeddings.length === books.length) {
      books.forEach((book, index) => {
        if (embeddings[index]) {
          results[book.id] = embeddings[index];
        }
      });
    }
    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true; // Important for immediate search availability
  }

  isAvailable(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }
}
