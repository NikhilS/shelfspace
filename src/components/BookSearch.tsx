import React, {useState, useRef, useEffect} from 'react';
import {Loader2, BookPlus} from 'lucide-react';
import {
  searchBookByTitle,
  searchBookByIsbn,
  BookDetails,
} from '../services/bookApi';
import {toast} from 'sonner';
import {toTitleCase, isDuplicateBook, normalizeBookDetails} from '../lib/utils';
import {Button} from '@/components/ui/button';

interface BookSearchProps {
  existingBooks: BookDetails[];
  allowDuplicates: boolean;
  onAdd: (book: BookDetails) => Promise<void>;
}

export default function BookSearch({
  existingBooks,
  allowDuplicates,
  onAdd,
}: BookSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<BookDetails[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => searchAbortControllerRef.current?.abort();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;

    setIsSearching(true);
    setHasSearched(false);
    try {
      const isIsbn = /^\d{10,13}$/.test(searchQuery.replace(/[- ]/g, ''));
      let books: BookDetails[] = [];
      if (isIsbn) {
        const book = await searchBookByIsbn(
          searchQuery.replace(/[- ]/g, ''),
          abortController.signal,
        );
        if (book) books = [book];
      }
      if (books.length === 0) {
        books = await searchBookByTitle(searchQuery, abortController.signal);
      }
      if (abortController.signal.aborted) return;
      setSearchResults(books);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      toast.error('Failed to search books. Please try again.');
      setSearchResults([]);
    } finally {
      if (!abortController.signal.aborted) {
        setIsSearching(false);
        setHasSearched(true);
      }
    }
  };

  const handleAddClick = async (book: BookDetails) => {
    const bookToAdd = normalizeBookDetails(book);

    if (!allowDuplicates && isDuplicateBook(bookToAdd, existingBooks)) {
      toast.info(`Skipped duplicate: ${bookToAdd.title}`);
      return;
    }

    setIsAdding(book.isbn || book.title);
    try {
      await onAdd(bookToAdd);
    } finally {
      setIsAdding(null);
    }
  };

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search by title, author, or ISBN..."
          className="flex-1 bg-surface-container/50 border border-outline-variant/60 rounded-full px-6 py-4 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium placeholder:text-on-surface-variant/60"
        />
        <Button
          type="submit"
          disabled={isSearching}
          className="rounded-full shadow-sm hover:shadow-md transition-all flex items-center justify-center sm:w-auto w-full font-bold flex-shrink-0 px-8 py-7"
        >
          {isSearching ? (
            <Loader2 className="animate-spin" size={20} />
          ) : (
            'Search'
          )}
        </Button>
      </form>

      <div className="space-y-4">
        {isSearching ? (
          <div className="space-y-4 animate-pulse">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="bg-surface-variant/40 p-3 sm:p-4 rounded-2xl flex gap-3 sm:gap-4 items-center"
              >
                <div className="w-14 h-20 sm:w-16 sm:h-24 bg-surface-variant/50 rounded-lg flex-shrink-0" />
                <div className="flex-grow space-y-2">
                  <div className="h-5 bg-surface-variant/50 rounded w-3/4" />
                  <div className="h-4 bg-surface-variant/50 rounded w-1/2" />
                </div>
                <div className="w-20 h-10 bg-surface-variant/50 rounded-full flex-shrink-0" />
              </div>
            ))}
          </div>
        ) : hasSearched && searchResults.length === 0 ? (
          <div className="text-center py-12 bg-surface-container-low rounded-2xl shadow-sm border border-outline-variant/30">
            <p className="text-on-surface font-medium">
              No matching books found. Try a different search term or enter
              manually.
            </p>
          </div>
        ) : (
          searchResults.map((book, idx) => (
            <div
              key={idx}
              className="bg-surface-container-low/60 p-3 sm:p-5 rounded-2xl sm:rounded-3xl border border-outline-variant/40 flex flex-row gap-3 sm:gap-6 shadow-[0_2px_8px_rgb(26,47,75,0.02)] hover:shadow-md hover:border-outline-variant/80 transition-all items-start sm:items-center group"
            >
              {book.coverUrl ? (
                <img
                  src={book.coverUrl}
                  alt={book.title}
                  className="w-16 h-24 sm:w-20 sm:h-32 object-cover rounded-xl shadow-sm border border-outline-variant/20 flex-shrink-0"
                  onError={e => {
                    (e.target as HTMLImageElement).style.display = 'none';
                    (
                      e.target as HTMLImageElement
                    ).nextElementSibling?.classList.remove('hidden');
                  }}
                />
              ) : (
                <div className="w-16 h-24 sm:w-20 sm:h-32 bg-surface-variant/60 rounded-xl flex items-center justify-center flex-shrink-0 border border-outline-variant/30">
                  <span className="text-outline text-xs font-medium">
                    No cover
                  </span>
                </div>
              )}
              <div className="hidden w-16 h-24 sm:w-20 sm:h-32 bg-surface-variant/60 rounded-xl flex items-center justify-center flex-shrink-0 border border-outline-variant/30">
                <span className="text-outline text-xs font-medium">
                  No cover
                </span>
              </div>
              <div className="flex-1 min-w-0 py-1">
                <h3 className="font-serif font-bold text-lg sm:text-2xl text-on-surface mb-1 truncate tracking-tight pr-4">
                  {toTitleCase(book.title)}
                </h3>
                {book.author && (
                  <p className="text-on-surface-variant text-sm sm:text-base mb-2 font-medium truncate">
                    {toTitleCase(book.author)}
                  </p>
                )}
                {book.publishedDate && (
                  <p className="text-outline text-xs sm:text-sm font-medium">
                    Published: {book.publishedDate}
                  </p>
                )}
                <div className="mt-3 flex flex-col sm:hidden w-full">
                  <Button
                    onClick={() => handleAddClick(book)}
                    disabled={isAdding === (book.isbn || book.title)}
                    className="w-full rounded-full flex items-center justify-center gap-2 font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] hover:scale-105 transition-all h-9"
                  >
                    {isAdding === (book.isbn || book.title) ? (
                      <Loader2 size={16} className="animate-spin" />
                    ) : (
                      <>
                        <BookPlus size={16} strokeWidth={2.5} /> Add to Library
                      </>
                    )}
                  </Button>
                </div>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-3 flex-shrink-0 ml-2">
                <Button
                  onClick={() => handleAddClick(book)}
                  disabled={isAdding === (book.isbn || book.title)}
                  className="rounded-full flex items-center gap-2 font-bold shadow-[0_4px_16px_rgb(26,47,75,0.15)] hover:-translate-y-0.5 transition-all px-6 py-6"
                  title="Add to Library"
                >
                  {isAdding === (book.isbn || book.title) ? (
                    <Loader2 size={18} className="animate-spin" />
                  ) : (
                    <>
                      <BookPlus size={18} strokeWidth={2.5} /> Add
                    </>
                  )}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
