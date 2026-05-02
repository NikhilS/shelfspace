import {
  BookDetails,
  searchBookByIsbn,
  searchBookByTitleAndAuthor,
} from '../services/bookApi';
import {searchWikipediaForBook} from '../services/wikipediaApi';
import {generateBookInsights} from '../services/gemini';

export async function getTieredMetadata(
  book: Partial<{
    isbn: string;
    title: string;
    author: string;
    synopsis: string;
  }>,
) {
  let enriched: Partial<BookDetails> | null = null;

  if (book.isbn && book.isbn !== 'null') {
    const res = await searchBookByIsbn(book.isbn);
    if (res) enriched = res;
  }

  if (!enriched && book.title && book.author) {
    const results = await searchBookByTitleAndAuthor(book.title, book.author);
    if (results && results.length > 0) {
      enriched = results[0];
    }
  }

  const resultData: Partial<BookDetails> = enriched ? {...enriched} : {};

  // Tier 1: Wikipedia
  if (!resultData.synopsis && !book.synopsis && book.title) {
    const wpDesc = await searchWikipediaForBook(book.title, book.author);
    if (wpDesc) {
      resultData.synopsis = wpDesc;
    }
  }

  // Tier 2: Gemini
  if (!resultData.synopsis && !book.synopsis && book.title) {
    try {
      const geminiDesc = await generateBookInsights(
        book.title,
        book.author || 'Unknown',
        'synopsis',
      );
      if (geminiDesc) {
        resultData.synopsis = geminiDesc;
      }
    } catch (e) {
      console.warn('Gemini fallback failed', e);
    }
  }

  return resultData;
}
