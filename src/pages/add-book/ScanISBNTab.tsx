import React, {useState} from 'react';
import {BookDetails, searchBookByIsbn} from '../../services/bookApi';
import BarcodeScanner from '../../components/BarcodeScanner';
import {Loader2, X, BookPlus} from 'lucide-react';
import {toast} from 'sonner';
import {toTitleCase} from '../../lib/utils';

interface ScanISBNTabProps {
  addBooks: (books: BookDetails[]) => Promise<void>;
  isAddingAll: boolean;
}

export function ScanISBNTab({addBooks, isAddingAll}: ScanISBNTabProps) {
  const [processingIsbns, setProcessingIsbns] = useState<Set<string>>(
    new Set(),
  );
  const [scannedBooks, setScannedBooks] = useState<BookDetails[]>([]);
  const [selectedScanned, setSelectedScanned] = useState<Set<string>>(
    new Set(),
  );

  const handleScanIsbn = async (isbn: string) => {
    if (processingIsbns.has(isbn) || scannedBooks.some(b => b.isbn === isbn))
      return;

    setProcessingIsbns(prev => new Set(prev).add(isbn));

    try {
      const book = await searchBookByIsbn(isbn);
      if (book) {
        setScannedBooks(prev => {
          if (prev.some(b => b.isbn === isbn)) return prev;
          return [book, ...prev];
        });
        setSelectedScanned(prev => new Set(prev).add(isbn));
      } else {
        toast.error(`Could not find book for ISBN ${isbn}`);
      }
    } catch {
      toast.error(`Failed to fetch book for ISBN ${isbn}`);
    } finally {
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

      toast.success(`Successfully added ${formattedBooks.length} books`);
    } catch {
      setScannedBooks(originalScanned);
      setSelectedScanned(originalSelected);
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
            <div className="flex gap-2 sm:gap-3 items-center">
              <label className="hidden sm:flex items-center gap-2 text-sm font-bold text-on-surface cursor-pointer mr-2 hover:bg-surface-container-low/80 px-3 py-1.5 rounded-full transition-colors">
                <input
                  type="checkbox"
                  checked={
                    selectedScanned.size === scannedBooks.length &&
                    scannedBooks.length > 0
                  }
                  onChange={e => {
                    if (e.target.checked)
                      setSelectedScanned(
                        new Set(scannedBooks.map(b => b.isbn || b.title)),
                      );
                    else setSelectedScanned(new Set());
                  }}
                  className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
                />
                Select All
              </label>
              <button
                onClick={() => {
                  setScannedBooks([]);
                  setSelectedScanned(new Set());
                }}
                className="p-2 sm:px-4 sm:py-2 text-sm font-bold text-on-surface-variant hover:text-on-surface hover:bg-surface-container-low border border-transparent hover:border-outline-variant/60 rounded-full transition-colors"
                title="Clear & Scan Again"
              >
                <span className="hidden sm:inline">Clear</span>
                <X size={18} strokeWidth={2} className="sm:hidden" />
              </button>
              <button
                onClick={handleAddSelectedScanned}
                disabled={isAddingAll || selectedScanned.size === 0}
                className="bg-primary text-on-primary px-4 py-2 sm:px-5 sm:py-2.5 rounded-full text-sm font-bold hover:bg-primary/90 transition-all disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                {isAddingAll ? (
                  <Loader2 className="animate-spin" size={16} />
                ) : (
                  <BookPlus size={16} strokeWidth={2.5} />
                )}
                <span className="hidden sm:inline">Add Selected </span>(
                {selectedScanned.size})
              </button>
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
                      <input
                        type="checkbox"
                        checked={selectedScanned.has(book.isbn || book.title)}
                        onChange={() => toggleSelectScanned(book)}
                        onClick={e => e.stopPropagation()}
                        className="rounded border-outline-variant/60 text-primary focus:ring-primary/20 w-4 h-4 cursor-pointer"
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
