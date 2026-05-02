import React, {useState, useRef, useEffect} from 'react';
import {BookPlus, Loader2, X} from 'lucide-react';
import {toTitleCase} from '../lib/utils';
import pLimit from 'p-limit';
import {toast} from 'sonner';
import {
  searchBookByIsbn,
  searchBookByTitleAndAuthor,
  searchBookByTitle,
  BookDetails,
} from '../services/bookApi';

type ExtractedBook = {
  title: string;
  author: string;
  isbn?: string;
  genres?: string[];
  format?: 'physical' | 'digital';
};

interface ExtractedBooksTableProps {
  extractedBooks: ExtractedBook[];
  setExtractedBooks: (
    books: ExtractedBook[] | ((prev: ExtractedBook[]) => ExtractedBook[]),
  ) => void;
  selectedExtracted: Set<string>;
  setSelectedExtracted: (
    set: Set<string> | ((prev: Set<string>) => Set<string>),
  ) => void;
  allowDuplicates: boolean;
  existingBooks: BookDetails[];
  csvFormat: 'physical' | 'digital';
  addBooks: (books: BookDetails[]) => Promise<void>;
}

export default function ExtractedBooksTable({
  extractedBooks,
  setExtractedBooks,
  selectedExtracted,
  setSelectedExtracted,
  allowDuplicates,
  existingBooks,
  csvFormat,
  addBooks,
}: ExtractedBooksTableProps) {
  const [isAddingAll, setIsAddingAll] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [addProgress, setAddProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);

  const isMounted = useRef(true);

  useEffect(() => {
    return () => {
      isMounted.current = false;
    };
  }, []);

  const toggleSelectAll = () => {
    if (
      selectedExtracted.size === extractedBooks.length &&
      extractedBooks.length > 0
    ) {
      setSelectedExtracted(new Set());
    } else {
      setSelectedExtracted(
        new Set(extractedBooks.map(b => `${b.title}::${b.author}`)),
      );
    }
  };

  const toggleSelect = (book: {title: string; author: string}) => {
    const id = `${book.title}::${book.author}`;
    setSelectedExtracted(prev => {
      const newSelected = new Set(prev);
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
      return newSelected;
    });
  };

  const handleAddSelectedExtracted = async () => {
    setIsAddingAll(true);
    let addedCount = 0;
    let duplicateCount = 0;
    const booksToAdd = extractedBooks.filter(book =>
      selectedExtracted.has(`${book.title}::${book.author}`),
    );
    setAddProgress({current: 0, total: booksToAdd.length});

    const newlyAdded: {title: string; author: string; isbn: string}[] = [];
    const limit = pLimit(5);

    const promises = booksToAdd.map(book => {
      return limit(async () => {
        if (!isMounted.current) return {success: false};
        let retries = 3;
        let delayMs = 1000;
        let bookToAdd: BookDetails | null = null;
        let success = false;
        let isDuplicate = false;
        const cleanNewIsbn = (book.isbn || '').trim().replace(/[^0-9X]/gi, '');
        const cleanNewTitle = (book.title || '').trim().toLowerCase();
        const cleanNewAuthor = (book.author || '').trim().toLowerCase();

        while (retries > 0 && !success) {
          if (!isMounted.current) return {success: false};
          try {
            setIsAdding(book.title);

            isDuplicate =
              !allowDuplicates &&
              (existingBooks.some(b => {
                const cleanExistingIsbn = (b.isbn || '')
                  .trim()
                  .replace(/[^0-9X]/gi, '');
                const hasSameIsbn =
                  cleanExistingIsbn.length >= 10 &&
                  cleanNewIsbn.length >= 10 &&
                  cleanExistingIsbn === cleanNewIsbn;
                const hasSameTitleAndAuthor =
                  (b.title || '').trim().toLowerCase() === cleanNewTitle &&
                  (b.author || '').trim().toLowerCase() === cleanNewAuthor;
                return hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor);
              }) ||
                newlyAdded.some(b => {
                  const hasSameIsbn =
                    b.isbn.length >= 10 &&
                    cleanNewIsbn.length >= 10 &&
                    b.isbn === cleanNewIsbn;
                  const hasSameTitleAndAuthor =
                    b.title === cleanNewTitle && b.author === cleanNewAuthor;
                  return (
                    hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor)
                  );
                }));

            if (isDuplicate) {
              setExtractedBooks(prev =>
                prev.filter(
                  b => !(b.title === book.title && b.author === book.author),
                ),
              );
              return {success: false, duplicate: true};
            }

            if (book.isbn && book.isbn !== 'null') {
              bookToAdd = await searchBookByIsbn(book.isbn);
            }
            if (!bookToAdd && book.author) {
              const results = await searchBookByTitleAndAuthor(
                book.title,
                book.author,
              );
              bookToAdd = results[0] || null;
            }
            if (!bookToAdd) {
              const results = await searchBookByTitle(book.title);
              bookToAdd = book.author
                ? results.find(r =>
                    (r.author || '')
                      .toLowerCase()
                      .includes(book.author.toLowerCase()),
                  ) ||
                  results[0] ||
                  null
                : results[0] || null;
            }
            success = true;
          } catch (error) {
            retries--;
            const e = error as Error & {response?: {status?: number}};
            if (
              retries > 0 &&
              (e?.message?.includes('429') || e?.response?.status === 429)
            ) {
              await new Promise(r => setTimeout(r, delayMs));
              delayMs *= 2;
            } else {
              console.error(`Failed to add ${book.title}`, error);
              return {success: false};
            }
          }
        }

        if (isDuplicate) return {success: false, duplicate: true};
        if (!success) return {success: false};

        const finalBook: BookDetails = bookToAdd || {
          title: book.title,
          author: book.author,
          isbn: book.isbn && book.isbn !== 'null' ? book.isbn : '',
          coverUrl: '',
          publishedDate: '',
          genres: book.genres,
        };

        if (
          book.genres &&
          (!finalBook.genres || finalBook.genres.length === 0)
        ) {
          finalBook.genres = book.genres;
        }
        finalBook.format = book.format || csvFormat;

        newlyAdded.push({
          title: cleanNewTitle,
          author: cleanNewAuthor,
          isbn: cleanNewIsbn,
        });

        if (!isMounted.current) return {success: false};

        setExtractedBooks(prev =>
          prev.filter(
            b => !(b.title === book.title && b.author === book.author),
          ),
        );
        setSelectedExtracted(prev => {
          const next = new Set(prev);
          next.delete(`${book.title}::${book.author}`);
          return next;
        });

        return {success: true, book: finalBook};
      }).finally(() => {
        if (isMounted.current) {
          setAddProgress(prev =>
            prev ? {...prev, current: prev.current + 1} : null,
          );
        }
      });
    });

    const results = await Promise.all(promises);
    if (!isMounted.current) return;

    const readyBooks = results
      .filter(r => r && r.success)
      .map(r => r.book as BookDetails);

    if (readyBooks.length > 0) {
      await addBooks(readyBooks);
    }

    if (!isMounted.current) return;

    addedCount = readyBooks.length;
    duplicateCount = results.filter(
      r => r && 'duplicate' in r && r.duplicate,
    ).length;

    setIsAdding(null);
    setIsAddingAll(false);
    setAddProgress(null);

    if (addedCount > 0) toast.success(`Successfully added ${addedCount} books`);
    if (duplicateCount > 0) {
      toast.info(
        `Skipped ${duplicateCount} duplicate book${duplicateCount === 1 ? '' : 's'}`,
      );
    }
    if (
      addedCount + duplicateCount !== booksToAdd.length &&
      booksToAdd.length > 0
    ) {
      toast.error(
        `Failed to add ${booksToAdd.length - addedCount - duplicateCount} books`,
      );
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col gap-2 sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
            Found {extractedBooks.length} Books
          </h3>
          <div className="flex gap-2 sm:gap-3 items-center">
            <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-on-surface cursor-pointer mr-2 hover:bg-surface-container-low/80 px-3 py-1.5 rounded-full transition-colors">
              <input
                type="checkbox"
                checked={
                  selectedExtracted.size === extractedBooks.length &&
                  extractedBooks.length > 0
                }
                onChange={toggleSelectAll}
                className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
              />
              Select All
            </label>
            <button
              onClick={() => {
                setExtractedBooks([]);
                setSelectedExtracted(new Set());
              }}
              className="p-2 sm:px-4 sm:py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent hover:border-outline-variant/60 rounded-full transition-colors"
              title="Clear & Upload Again"
            >
              <span className="hidden sm:inline">Clear</span>
              <X size={18} strokeWidth={2} className="sm:hidden" />
            </button>
            <button
              onClick={handleAddSelectedExtracted}
              disabled={isAddingAll || selectedExtracted.size === 0}
              className="bg-primary text-on-primary px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5"
            >
              {isAddingAll ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <BookPlus size={16} strokeWidth={2.5} />
              )}
              <span className="hidden sm:inline">Add Selected </span>(
              {selectedExtracted.size})
            </button>
          </div>
        </div>
        {addProgress !== null && (
          <div className="w-full mt-2">
            <div className="w-full bg-surface-container border border-outline-variant/40 rounded-full h-2 overflow-hidden">
              <div
                className="bg-primary h-full transition-all duration-300"
                style={{
                  width: `${(addProgress.current / addProgress.total) * 100}%`,
                }}
              />
            </div>
            <p className="text-xs text-on-surface-variant text-center mt-1.5 font-medium">
              Processing {addProgress.current} of {addProgress.total} books...
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {extractedBooks.map((book, idx) => (
          <label
            key={idx}
            className={`bg-surface-container-low/60 p-3 sm:p-5 rounded-2xl sm:rounded-3xl border transition-all cursor-pointer flex gap-3 sm:gap-4 ${selectedExtracted.has(`${book.title}::${book.author}`) ? 'border-primary shadow-md bg-surface ring-1 ring-primary/20' : 'border-outline-variant/40 shadow-[0_2px_8px_rgb(26,47,75,0.02)] hover:shadow-md hover:border-outline-variant/80'}`}
          >
            <div className="pt-0.5 sm:pt-1">
              <input
                type="checkbox"
                checked={selectedExtracted.has(`${book.title}::${book.author}`)}
                onChange={() => toggleSelect(book)}
                className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 sm:w-5 sm:h-5 cursor-pointer mt-0.5"
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {isAdding === book.title && (
                  <Loader2
                    className="animate-spin text-primary flex-shrink-0"
                    size={14}
                  />
                )}
                <h4
                  className="font-serif font-bold text-sm sm:text-lg text-on-surface truncate tracking-tight"
                  title={book.title}
                >
                  {toTitleCase(book.title)}
                </h4>
              </div>
              <p
                className="text-on-surface-variant text-xs sm:text-sm truncate mt-0.5 font-medium"
                title={book.author}
              >
                {toTitleCase(book.author)}
              </p>
              {book.isbn && book.isbn !== 'null' && (
                <p className="text-outline text-xs mt-1.5 font-mono font-medium">
                  ISBN: {book.isbn}
                </p>
              )}
              {book.genres && book.genres.length > 0 && (
                <p className="text-on-surface-variant text-xs mt-2 font-bold bg-surface-variant inline-block px-2.5 py-1 rounded-full border border-outline-variant/30">
                  {book.genres[0]}
                </p>
              )}
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
