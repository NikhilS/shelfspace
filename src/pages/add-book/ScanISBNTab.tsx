import React, {useState, useRef} from 'react';
import {BookDetails, searchBookByIsbn} from '../../services/bookApi';
import BarcodeScanner from '../../components/BarcodeScanner';
import {Loader2, X, BookPlus} from 'lucide-react';
import {toast} from 'sonner';
import {toTitleCase, triggerHaptics} from '../../lib/utils';
import {Checkbox} from '../../components/ui/checkbox';
import {Button} from '../../components/ui/button';
import {logger} from '../../contexts/DebugContext';

interface ScanISBNTabProps {
  addBooks: (books: BookDetails[]) => Promise<BookDetails[] | void | undefined>;
  isAddingAll: boolean;
}

export function ScanISBNTab({addBooks, isAddingAll}: ScanISBNTabProps) {
  const [processingIsbns, setProcessingIsbns] = useState<Set<string>>(
    new Set(),
  );
  const processingRefs = useRef<Set<string>>(new Set());
  const scannedRefs = useRef<Set<string>>(new Set());

  const [scannedBooks, setScannedBooks] = useState<BookDetails[]>([]);
  const [selectedScanned, setSelectedScanned] = useState<Set<string>>(
    new Set(),
  );

  const handleScanIsbn = async (isbn: string) => {
    if (processingRefs.current.has(isbn) || scannedRefs.current.has(isbn))
      return;

    logger.info(`Detected ISBN: ${isbn}. Searching library database...`);
    processingRefs.current.add(isbn);
    setProcessingIsbns(prev => new Set(prev).add(isbn));

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      const book = await searchBookByIsbn(isbn, controller.signal);
      clearTimeout(timeoutId);

      if (book) {
        logger.info(`Found book: ${book.title} by ${book.author}`);
        triggerHaptics(50);
        scannedRefs.current.add(isbn);
        setScannedBooks(prev => {
          if (prev.some(b => b.isbn === isbn)) return prev;
          return [book, ...prev];
        });
        setSelectedScanned(prev => new Set(prev).add(isbn));
      } else {
        logger.warn(`No metadata found for ISBN ${isbn}`);
        triggerHaptics([50, 100, 50]);
        toast.error(`Could not find book for ISBN ${isbn}`);
      }
    } catch (err: unknown) {
      logger.error(
        `Error searching ISBN ${isbn}: ${err instanceof Error ? err.message : String(err)}`,
      );
      triggerHaptics([50, 100, 50]);
      toast.error(`Failed to fetch book for ISBN ${isbn}`);
    } finally {
      processingRefs.current.delete(isbn);
      setProcessingIsbns(prev => {
        const next = new Set(prev);
        next.delete(isbn);
        return next;
      });
    }
  };

  const toggleSelectScanned = (book: BookDetails) => {
    const next = new Set(selectedScanned);
    const key = book.isbn || book.title;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedScanned(next);
  };

  const handleAddSelectedScanned = async () => {
    const booksToAdd = scannedBooks.filter(b =>
      selectedScanned.has(b.isbn || b.title),
    );

    if (booksToAdd.length === 0) {
      return;
    }

    const originalScanned = [...scannedBooks];
    const originalSelected = new Set(selectedScanned);

    // Optimistic UI
    booksToAdd.forEach(b => {
      if (b.isbn) scannedRefs.current.delete(b.isbn);
    });
    setScannedBooks(prev =>
      prev.filter(b => !selectedScanned.has(b.isbn || b.title)),
    );
    setSelectedScanned(new Set());

    try {
      const formattedBooks = booksToAdd.map(
        b =>
          ({
            ...b,
            isbn: b.isbn || '',
            coverUrl: b.coverUrl || '',
            publishedDate: b.publishedDate || '',
            format: 'physical',
          }) as BookDetails,
      );

      await addBooks(formattedBooks);

      triggerHaptics([30, 50, 30]);
      toast.success(`Successfully added ${formattedBooks.length} books`);
    } catch {
      booksToAdd.forEach(b => {
        if (b.isbn) scannedRefs.current.add(b.isbn);
      });
      setScannedBooks(originalScanned);
      setSelectedScanned(originalSelected);
      triggerHaptics([50, 100, 50]);
      toast.error('Failed to add some books');
    }
  };

  return (
    <div className="space-y-6 flex flex-col items-center">
      <div className="w-full max-w-md">
        <BarcodeScanner onScan={handleScanIsbn} paused={isAddingAll} />
      </div>

      {processingIsbns.size > 0 && (
        <div className="flex items-center gap-2 text-primary bg-primary/10 px-4 py-2 rounded-full">
          <Loader2 className="animate-spin" size={16} />
          <span className="font-medium text-sm">
            Searching for {processingIsbns.size} ISBN
            {processingIsbns.size > 1 ? 's' : ''}...
          </span>
        </div>
      )}

      {scannedBooks.length > 0 && (
        <div className="w-full space-y-4">
          <div className="flex items-center justify-between sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
            <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
              Scanned {scannedBooks.length} Books
            </h3>
            <div className="flex gap-2 sm:gap-4 items-center">
              <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-on-surface cursor-pointer mr-2 hover:bg-surface-container-low/80 px-3 py-1.5 rounded-full transition-colors">
                <Checkbox
                  checked={
                    selectedScanned.size === scannedBooks.length &&
                    scannedBooks.length > 0
                  }
                  onCheckedChange={checked => {
                    if (checked) {
                      setSelectedScanned(
                        new Set(scannedBooks.map(b => b.isbn || b.title)),
                      );
                    } else {
                      setSelectedScanned(new Set());
                    }
                  }}
                  aria-label="Select all"
                />
                Select All
              </label>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  scannedRefs.current.clear();
                  setScannedBooks([]);
                  setSelectedScanned(new Set());
                }}
                className="rounded-full text-on-surface-variant"
                title="Clear & Scan Again"
              >
                <span className="hidden sm:inline">Clear</span>
                <X className="sm:hidden" />
              </Button>
              <Button
                onClick={handleAddSelectedScanned}
                disabled={isAddingAll || selectedScanned.size === 0}
                className="rounded-full shadow-sm hover:shadow-md transition-all gap-2"
              >
                {isAddingAll ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <BookPlus size={16} strokeWidth={2.5} />
                )}
                <span className="hidden sm:inline">Add Selected </span>(
                {selectedScanned.size})
              </Button>
            </div>
          </div>

          <div className="w-full overflow-x-auto rounded-xl border border-outline-variant/40 bg-surface shadow-sm">
            <table className="w-full text-left text-sm text-on-surface">
              <thead className="bg-surface-container-low text-xs uppercase text-on-surface-variant">
                <tr>
                  <th className="px-4 py-3 w-12 text-center">#</th>
                  <th className="px-4 py-3">Title</th>
                  <th className="px-4 py-3">Author</th>
                  <th className="px-4 py-3">ISBN</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/30">
                {scannedBooks.map((book, idx) => (
                  <tr
                    key={idx}
                    className={`hover:bg-primary/5 transition-colors cursor-pointer ${selectedScanned.has(book.isbn || book.title) ? 'bg-primary/5' : ''}`}
                    onClick={() => toggleSelectScanned(book)}
                  >
                    <td className="px-4 py-3 text-center">
                      <Checkbox
                        checked={selectedScanned.has(book.isbn || book.title)}
                        onCheckedChange={() => toggleSelectScanned(book)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Select ${book.title}`}
                      />
                    </td>
                    <td className="px-4 py-3 font-medium text-on-surface flex items-center gap-2">
                      {toTitleCase(book.title)}
                    </td>
                    <td className="px-4 py-3">{toTitleCase(book.author)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{book.isbn}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
