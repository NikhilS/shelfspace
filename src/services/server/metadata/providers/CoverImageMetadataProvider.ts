import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {searchBookByIsbn, searchBookByTitleAndAuthor} from '../../../bookApi';
import {googleBooksLimiter} from '../../limiters';
import {normalizeIsbn} from '../../../../lib/utils';

export class CoverImageMetadataProvider implements IMetadataProvider<string> {
  getKey(): MetadataKey {
    // using the exact field mapped in the db/UI schema
    return MetadataKey.COVER_IMAGE;
  }

  isAvailable(): boolean {
    return true; // Uses free APIs (OpenLibrary, Google Books) and fetch is globally available
  }

  shouldFetchOnCreate(): boolean {
    return true; // We want covers immediately upon creation
  }

  async fetch(book: CoreBookData): Promise<string> {
    if (
      'coverUrl' in book &&
      typeof (book as Record<string, unknown>).coverUrl === 'string' &&
      (book as Record<string, unknown>).coverUrl
    ) {
      return (book as Record<string, unknown>).coverUrl as string;
    }

    const isbnClean = normalizeIsbn(book.isbn);

    if (isbnClean) {
      // 1. Give API schema a shot.
      const details = await searchBookByIsbn(isbnClean);
      if (details?.coverUrl) {
        return details.coverUrl;
      }

      // 2. Fallback to OpenLibrary generic schema
      // OpenLibrary doesn't confirm existence immediately, but it's a valid source URL pattern
      // Because we want strong covers, we'll return this if we at least have an ISBN.
      // However, we'll try title/author first to see if we can get a verified one.
    }

    if (book.title) {
      const list = await searchBookByTitleAndAuthor(book.title, book.author);
      const firstWithCover = list.find(b => b.coverUrl);
      if (firstWithCover?.coverUrl) {
        return firstWithCover.coverUrl;
      }
    }

    // Only return the fallback OpenLibrary URL if we really found nothing else
    if (isbnClean) {
      return `https://covers.openlibrary.org/b/isbn/${isbnClean}-L.jpg`;
    }

    return '';
  }

  async bulkFetch(books: CoreBookData[]): Promise<Record<string, string>> {
    const results: Record<string, string> = {};
    // Map the array through the global limiter to guarantee API safety
    await Promise.all(
      books.map(book =>
        googleBooksLimiter.schedule(async () => {
          try {
            const res = await this.fetch(book);
            if (res) {
              results[book.id] = res;
            }
          } catch (error) {
            console.error(`Cover Image batch error for ${book.id}:`, error);
          }
        }),
      ),
    );

    return results;
  }
}
