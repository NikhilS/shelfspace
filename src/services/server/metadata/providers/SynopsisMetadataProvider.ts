import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {generateBookInsights} from '../../gemini';
import {googleBooksLimiter} from '../../limiters';
import {searchBookByIsbn, searchBookByTitleAndAuthor} from '../../../bookApi';

export class SynopsisMetadataProvider implements IMetadataProvider<string> {
  getKey(): MetadataKey {
    return MetadataKey.SYNOPSIS;
  }

  async fetch(book: CoreBookData): Promise<string> {
    if ('synopsis' in book && (book as Record<string, unknown>).synopsis) {
      return (book as Record<string, unknown>).synopsis as string;
    }

    if (book.isbn) {
      const bookData = await searchBookByIsbn(book.isbn);
      if (bookData?.synopsis) return bookData.synopsis;
    }

    const booksData = await searchBookByTitleAndAuthor(book.title, book.author);
    if (booksData && booksData.length > 0 && booksData[0].synopsis) {
      return booksData[0].synopsis;
    }

    const synopsis = await generateBookInsights(
      book.title,
      book.author,
      'synopsis',
    );
    return synopsis || '';
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    await Promise.all(
      books.map(book =>
        googleBooksLimiter.schedule(async () => {
          try {
            const res = await this.fetch(book);
            if (res) {
              results[book.id] = res;
            }
          } catch (error) {
            console.error(`Synopsis batch error for ${book.id}:`, error);
          }
        }),
      ),
    );
    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true;
  }

  isAvailable(): boolean {
    return true; // We can use search APIs even if Gemini is missing
  }
}
