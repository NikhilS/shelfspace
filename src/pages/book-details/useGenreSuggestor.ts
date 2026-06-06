import {useState, useEffect} from 'react';
import {Book} from '../../types';
import {normalizeIsbn, toSentenceCase, parseGenres} from '../../lib/utils';
import {
  searchBookByIsbn,
  searchBookByTitleAndAuthor,
} from '../../services/bookApi';

export const BASE_GENRES = [
  'Fiction',
  'Non-fiction',
  'Fantasy',
  'Science Fiction',
  'Mystery',
  'Thriller',
  'Biography',
  'History',
  'Romance',
  'Classic',
];

export function useGenreSuggestor(book: Book) {
  const [suggestedGenres, setSuggestedGenres] = useState<string[]>(BASE_GENRES);
  const [isSearchingGenres, setIsSearchingGenres] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchGenres = async () => {
      setIsSearchingGenres(true);
      const harvested = new Set<string>();

      const isbnClean = normalizeIsbn(book.isbn);
      try {
        if (isbnClean) {
          const details = await searchBookByIsbn(isbnClean);
          if (details?.genres) {
            details.genres.forEach(g => {
              const parsed = parseGenres(g);
              parsed.forEach(pg => {
                if (pg) harvested.add(toSentenceCase(pg));
              });
            });
          }
        }

        if (book.title) {
          const list = await searchBookByTitleAndAuthor(
            book.title,
            book.author,
          );
          list.forEach(item => {
            if (item.genres) {
              item.genres.forEach(g => {
                const parsed = parseGenres(g);
                parsed.forEach(pg => {
                  if (pg) harvested.add(toSentenceCase(pg));
                });
              });
            }
          });
        }
      } catch (err) {
        console.warn('Genre harvest handled gracefully:', err);
      }

      if (active) {
        const uniqueGenres = new Set<string>();

        // 1. Add existing book genres to ensure they always appear first as choices
        if (book?.genres) {
          book.genres.forEach(g => {
            if (g) uniqueGenres.add(toSentenceCase(g.trim()));
          });
        }

        // 2. Add harvested genres
        harvested.forEach(g => {
          if (g) uniqueGenres.add(g);
        });

        // 3. Add base genres
        BASE_GENRES.forEach(g => {
          uniqueGenres.add(g);
        });

        setSuggestedGenres(Array.from(uniqueGenres).slice(0, 24));
        setIsSearchingGenres(false);
      }
    };

    void fetchGenres();
    return () => {
      active = false;
    };
  }, [book.isbn, book.title, book.author, book?.genres]);

  return {suggestedGenres, isSearchingGenres};
}
