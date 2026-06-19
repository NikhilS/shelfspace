import React, {useState, useRef, useEffect} from 'react';
import {BookPlus, Loader2, X} from 'lucide-react';
import {
  toTitleCase,
  cn,
  triggerHaptics,
  filterDuplicateBooks,
  normalizeBookDetails,
} from '../lib/utils';
import {toast} from 'sonner';
import {Checkbox} from './ui/checkbox';
import {Button} from './ui/button';
import {logger} from '../stores/debugStore';
import {BookDetails} from '../services/bookApi';

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
  addBooks: (books: BookDetails[]) => Promise<BookDetails[] | void | undefined>;
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
  const [addProgress, setAddProgress] = useState<{
    current: number;
    total: number;
    phase: 'metadata' | 'saving';
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
    try {
      logger.info(
        `[ExtractedBooksTable] Extracted books to add are: ${extractedBooks.length} books`,
      );
      const selectedBooks = extractedBooks.filter(book =>
        selectedExtracted.has(`${book.title}::${book.author}`),
      );

      logger.info(
        `[ExtractedBooksTable] Selected ${selectedBooks.length} books to add`,
      );

      if (selectedBooks.length === 0) {
        setIsAddingAll(false);
        return;
      }

      setAddProgress({
        current: 0,
        total: selectedBooks.length,
        phase: 'saving',
      });

      // Normalize and filter duplicate books
      const mappedBooksInput = selectedBooks.map(book => ({
        ...book,
        format: book.format || csvFormat,
      }));

      let booksToSave: BookDetails[];

      if (!allowDuplicates) {
        const {unique, duplicatesFromInput} = filterDuplicateBooks(
          mappedBooksInput,
          existingBooks,
        );
        booksToSave = unique;

        const duplicateCount = duplicatesFromInput.length;
        if (duplicateCount > 0) {
          logger.info(
            `[ExtractedBooksTable] Filtered out ${duplicateCount} duplicate books.`,
          );
          triggerHaptics([50, 100, 50]);
          toast.info(
            `Skipped ${duplicateCount} duplicate book${duplicateCount === 1 ? '' : 's'}.`,
          );
        }
      } else {
        // Just normalize all books to save
        booksToSave = mappedBooksInput.map(book => normalizeBookDetails(book));
      }

      logger.info(
        `[ExtractedBooksTable] Normalized ${booksToSave.length} books to save`,
      );

      if (booksToSave.length === 0) {
        triggerHaptics([50, 100, 50]);
        toast.info('All selected books are already in your library.');
        setIsAddingAll(false);
        setAddProgress(null);
        return;
      }

      logger.info(
        `[ExtractedBooksTable] Adding ${booksToSave.length} books directly to library`,
      );

      // Save to library via the hook
      await addBooks(booksToSave);

      triggerHaptics([30, 50, 30]);

      // Clear added books from the table - THIS TRIGGERS UNMOUNT if table becomes empty
      setExtractedBooks(prev =>
        prev.filter(
          b =>
            !selectedBooks.some(
              s => s.title === b.title && s.author === b.author,
            ),
        ),
      );
      setSelectedExtracted(prev => {
        const next = new Set(prev);
        selectedBooks.forEach(b => next.delete(`${b.title}::${b.author}`));
        return next;
      });
    } catch (e: unknown) {
      console.error('Error adding extracted books:', e);
      triggerHaptics([50, 100, 50]);
    } finally {
      logger.info(
        '[ExtractedBooksTable] handleAddSelectedExtracted finally cleaning up',
      );
      setIsAddingAll(false);
      setAddProgress(null);
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col gap-2 sticky top-16 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
        <div className="flex items-center justify-between">
          <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
            Found {extractedBooks.length} Books
          </h3>
          <div className="flex gap-2 sm:gap-4 items-center">
            <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-on-surface cursor-pointer mr-2 hover:bg-surface-container-low/80 px-3 py-1.5 rounded-full transition-colors">
              <Checkbox
                checked={
                  selectedExtracted.size === extractedBooks.length &&
                  extractedBooks.length > 0
                }
                onCheckedChange={toggleSelectAll}
                aria-label="Select all"
              />
              Select All
            </label>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setExtractedBooks([]);
                setSelectedExtracted(new Set());
              }}
              className="rounded-full text-on-surface-variant"
              title="Clear & Upload Again"
            >
              <span className="hidden sm:inline">Clear</span>
              <X className="sm:hidden" />
            </Button>
            <Button
              onClick={handleAddSelectedExtracted}
              disabled={isAddingAll || selectedExtracted.size === 0}
              className="rounded-full shadow-sm hover:shadow-md transition-all gap-2"
            >
              {isAddingAll ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <BookPlus size={16} strokeWidth={2.5} />
              )}
              <span className="hidden sm:inline">Add Selected </span>(
              {selectedExtracted.size})
            </Button>
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
              {addProgress.phase === 'metadata'
                ? `Enriching details: ${addProgress.current} of ${addProgress.total} books...`
                : `Saving ${addProgress.total} ${addProgress.total === 1 ? 'book' : 'books'} to your library...`}
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
        {extractedBooks.map((book, idx) => {
          const isSelected = selectedExtracted.has(
            `${book.title}::${book.author}`,
          );
          return (
            <label
              key={idx}
              className={cn(
                'bg-surface-container-low/60 p-3 sm:p-5 rounded-2xl sm:rounded-3xl border transition-all cursor-pointer flex gap-3 sm:gap-4',
                isSelected
                  ? 'border-primary shadow-md bg-surface ring-1 ring-primary/20'
                  : 'border-outline-variant/40 shadow-elevation-1 hover:shadow-md hover:border-outline-variant/80',
              )}
            >
              <div className="pt-0.5 sm:pt-1">
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => toggleSelect(book)}
                  aria-label={`Select ${book.title}`}
                  className="mt-0.5"
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
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
          );
        })}
      </div>
    </div>
  );
}
