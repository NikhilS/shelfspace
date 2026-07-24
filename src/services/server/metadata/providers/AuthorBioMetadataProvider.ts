import {
  IMetadataProvider,
  MetadataKey,
  CoreBookData,
} from '../../../../types/metadata';
import {generateBookInsights} from '../../gemini';
import {fetchAuthorBioFromWikipedia} from '../../../wikipediaApi';
import {googleBooksLimiter} from '../../limiters';

export class AuthorBioMetadataProvider implements IMetadataProvider<string> {
  getKey(): MetadataKey {
    return MetadataKey.AUTHOR_BIO;
  }

  async fetch(book: CoreBookData): Promise<string> {
    if ('authorBio' in book && (book as Record<string, unknown>).authorBio) {
      return (book as Record<string, unknown>).authorBio as string;
    }

    let bio: string | null = null;

    try {
      bio = await fetchAuthorBioFromWikipedia(book.author);
    } catch (err) {
      console.error('Failed to fetch from Wikipedia', err);
    }

    if (!bio || bio.includes('may refer to:')) {
      bio = await generateBookInsights(book.title, book.author, 'author_bio');
    }

    return bio || '';
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
            console.error(`Author bio batch error for ${book.id}:`, error);
          }
        }),
      ),
    );
    return results;
  }

  shouldFetchOnCreate(): boolean {
    return true; // Simple single call
  }

  isAvailable(): boolean {
    return true; // Use Wikipedia API, fallback to Gemini
  }
}
