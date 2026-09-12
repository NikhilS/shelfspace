import React, {useState, useRef, useMemo} from 'react';
import {BookDetails, searchBookByIsbn} from '../../services/bookApi';
import BarcodeScanner from '../../components/BarcodeScanner';
import {Loader2, X, BookPlus} from 'lucide-react';
import {toast} from 'sonner';
import {triggerHaptics, normalizeBookDetails} from '../../lib/utils';
import {Checkbox} from '../../components/ui/checkbox';
import {Button} from '../../components/ui/button';
import {logger} from '../../stores/debugStore';
import {
  DataTable,
  DataTableColumn,
  DataTableCheckboxHeader,
  DataTableCheckboxCell,
  BookTitleCell,
  BookAuthorCell,
} from '../../components/ui/data-table';

interface ScanISBNTabProps {
  addBooks: (books: BookDetails[]) => Promise<BookDetails[] | void | undefined>;
  isAddingAll: boolean;
}

function ScanISBNTab({addBooks, isAddingAll}: ScanISBNTabProps) {
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

  const allScannedSelected =
    scannedBooks.length > 0 &&
    scannedBooks.every(b => selectedScanned.has(b.isbn || b.title));
  const someScannedSelected =
    scannedBooks.length > 0 &&
    scannedBooks.some(b => selectedScanned.has(b.isbn || b.title)) &&
    !allScannedSelected;
  const scannedSelectAllState = allScannedSelected
    ? true
    : someScannedSelected
      ? 'indeterminate'
      : false;

  const toggleSelectAllScanned = () => {
    if (allScannedSelected) {
      setSelectedScanned(new Set());
    } else {
      setSelectedScanned(new Set(scannedBooks.map(b => b.isbn || b.title)));
    }
  };

  const columns: DataTableColumn<BookDetails>[] = useMemo(
    () => [
      {
        id: 'select',
        width: 48,
        headerClassName: 'px-4 py-3 w-12 text-center',
        cellClassName: 'px-4 py-3 text-center',
        align: 'center',
        header: () => (
          <DataTableCheckboxHeader
            checked={scannedSelectAllState}
            onCheckedChange={toggleSelectAllScanned}
            ariaLabel="Select all scanned books"
          />
        ),
        cell: book => (
          <DataTableCheckboxCell
            checked={selectedScanned.has(book.isbn || book.title)}
            onCheckedChange={() => toggleSelectScanned(book)}
            ariaLabel={`Select ${book.title}`}
          />
        ),
      },
      {
        id: 'title',
        header: 'Title',
        headerClassName:
          'px-4 py-3 font-semibold text-xs uppercase text-on-surface-variant w-[240px] sm:w-[280px]',
        cellClassName: 'px-4 py-3 font-medium text-on-surface',
        wrap: true,
        maxWidth: 300,
        cell: book => (
          <BookTitleCell
            title={book.title}
            coverUrl={book.coverUrl}
            size="sm"
            maxWidth={260}
          />
        ),
      },
      {
        id: 'author',
        header: 'Author',
        headerClassName:
          'px-4 py-3 font-semibold text-xs uppercase text-on-surface-variant',
        cellClassName: 'px-4 py-3 text-on-surface-variant',
        truncate: true,
        maxWidth: 180,
        cell: book => <BookAuthorCell author={book.author} />,
      },
      {
        id: 'isbn',
        header: 'ISBN',
        headerClassName:
          'px-4 py-3 font-semibold text-xs uppercase text-on-surface-variant',
        cellClassName: 'px-4 py-3 font-mono text-xs text-outline',
        cell: book => book.isbn || '—',
      },
    ],
    [scannedSelectAllState, selectedScanned, scannedBooks],
  );

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
      const formattedBooks = booksToAdd.map(b =>
        normalizeBookDetails({...b, format: 'physical'}),
      );

      await addBooks(formattedBooks);

      triggerHaptics([30, 50, 30]);
    } catch {
      booksToAdd.forEach(b => {
        if (b.isbn) scannedRefs.current.add(b.isbn);
      });
      setScannedBooks(originalScanned);
      setSelectedScanned(originalSelected);
      triggerHaptics([50, 100, 50]);
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
          <div className="flex items-center justify-between sticky top-16 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
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

          <div className="w-full rounded-xl border border-outline-variant/40 bg-surface shadow-sm overflow-hidden">
            <DataTable<BookDetails>
              data={scannedBooks}
              columns={columns}
              keyExtractor={(book, idx) =>
                book.isbn || book.title || String(idx)
              }
              onRowClick={book => toggleSelectScanned(book)}
              rowClassName={item =>
                `hover:bg-primary/5 transition-colors cursor-pointer ${selectedScanned.has(item.isbn || item.title) ? 'bg-primary/5' : ''}`
              }
              emptyPlaceholder="No scanned books in queue."
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default ScanISBNTab;
