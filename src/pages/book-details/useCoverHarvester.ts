import {useState, useEffect} from 'react';
import {Book} from '../../types';
import {normalizeIsbn} from '../../lib/utils';
import {
  searchBookByIsbn,
  searchBookByTitleAndAuthor,
} from '../../services/bookApi';

export interface CoverSource {
  id: string;
  url: string;
  label: string;
  description: string;
}

export function useCoverHarvester(book: Book) {
  const [coverSources, setCoverSources] = useState<CoverSource[]>([]);
  const [isSearchingCovers, setIsSearchingCovers] = useState(false);

  useEffect(() => {
    let active = true;
    const fetchCovers = async () => {
      setIsSearchingCovers(true);
      const sources: CoverSource[] = [];

      // Always retain existing cover as option 1
      if (book?.coverUrl) {
        sources.push({
          id: 'existing',
          url: book.coverUrl,
          label: 'Current Cover',
          description: 'Present library cover',
        });
      }

      // If there's a stored camera raw backup
      if (book?.coverUrlRaw) {
        sources.push({
          id: 'raw-stored',
          url: book.coverUrlRaw,
          label: 'Raw Backup',
          description: 'Stored camera snap',
        });
      }

      const isbnClean = normalizeIsbn(book.isbn);

      try {
        if (isbnClean) {
          // Direct OpenLibrary link construction
          const olUrl = `https://covers.openlibrary.org/b/isbn/${isbnClean}-L.jpg`;
          sources.push({
            id: 'openlibrary-direct',
            url: olUrl,
            label: 'OpenLibrary (ISBN)',
            description: 'Direct schema lookup',
          });

          // API details search
          const details = await searchBookByIsbn(isbnClean);
          if (details && details.coverUrl && details.coverUrl !== olUrl) {
            sources.push({
              id: 'googlebooks',
              url: details.coverUrl,
              label: 'Google Books',
              description: 'Primary partner database',
            });
          }
        }

        // Secondary query by author/title if results are scarce
        if (sources.length < 3 && book.title) {
          const list = await searchBookByTitleAndAuthor(
            book.title,
            book.author,
          );
          const firstWithCover = list.find(b => b.coverUrl);
          if (firstWithCover && firstWithCover.coverUrl) {
            const alreadyIn = sources.some(
              s => s.url === firstWithCover.coverUrl,
            );
            if (!alreadyIn) {
              sources.push({
                id: 'googlebooks-search',
                url: firstWithCover.coverUrl,
                label: 'Google (Search)',
                description: 'Search match visual',
              });
            }
          }
        }
      } catch (err) {
        console.warn('Cover lookup handled gracefully:', err);
      }

      if (active) {
        // Discard duplicates or empty URLs
        const uniqueSources = sources.filter(
          (src, idx, self) =>
            src.url && self.findIndex(s => s.url === src.url) === idx,
        );
        setCoverSources(uniqueSources);
        setIsSearchingCovers(false);
      }
    };

    void fetchCovers();
    return () => {
      active = false;
    };
  }, [book.isbn, book.title, book.author, book?.coverUrl, book?.coverUrlRaw]);

  return {coverSources, isSearchingCovers, setCoverSources};
}
