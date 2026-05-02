import React, {useState} from 'react';
import {BookDetails} from '../../services/bookApi';
import CameraScanner from '../../components/CameraScanner';
import ExtractedBooksTable from '../../components/ExtractedBooksTable';
import {Loader2, X, BookPlus} from 'lucide-react';
import {toast} from 'sonner';

interface CaptureShelfTabProps {
  addBooks: (books: BookDetails[]) => Promise<void>;
  isAddingAll: boolean;
}

export function CaptureShelfTab({addBooks, isAddingAll}: CaptureShelfTabProps) {
  const [extractedBooks, setExtractedBooks] = useState<
    {
      title: string;
      author: string;
      isbn?: string;
      genres?: string[];
      format?: 'physical' | 'digital';
      coverUrl?: string;
      publishedDate?: string;
    }[]
  >([]);
  const [selectedExtracted, setSelectedExtracted] = useState<Set<string>>(
    new Set(),
  );
  const [isExtracting, setIsExtracting] = useState(false);

  const toggleSelectExtracted = (book: BookDetails) => {
    const next = new Set(selectedExtracted);
    const key = book.isbn || book.title;
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelectedExtracted(next);
  };

  const toggleSelectAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.checked)
      setSelectedExtracted(new Set(extractedBooks.map(b => b.isbn || b.title)));
    else setSelectedExtracted(new Set());
  };

  const handleAddSelectedExtracted = async () => {
    const booksToAdd = extractedBooks.filter(b =>
      selectedExtracted.has(b.isbn || b.title),
    );

    if (booksToAdd.length === 0) {
      return;
    }

    const originalExtracted = [...extractedBooks];
    const originalSelected = new Set(selectedExtracted);

    // Optimistic UI
    setExtractedBooks(prev =>
      prev.filter(b => !selectedExtracted.has(b.isbn || b.title)),
    );
    setSelectedExtracted(new Set());

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
      setExtractedBooks(originalExtracted);
      setSelectedExtracted(originalSelected);
      toast.error('Failed to add some books');
    }
  };

  return (
    <div className="space-y-6 flex flex-col items-center">
      {extractedBooks.length === 0 && (
        <CameraScanner
          onBooksExtracted={books => {
            setExtractedBooks(books);
            setSelectedExtracted(new Set(books.map(b => b.isbn || b.title)));
          }}
          isExtracting={isExtracting}
          setIsExtracting={setIsExtracting}
        />
      )}

      {extractedBooks.length > 0 && (
        <div className="w-full space-y-4">
          <div className="flex items-center justify-between sticky top-0 bg-surface/80 backdrop-blur-xl py-3 px-2 z-10 border-b border-outline-variant/40 mb-2 rounded-t-xl -mx-2">
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
                title="Clear & Scan Again"
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
          <ExtractedBooksTable
            extractedBooks={extractedBooks}
            selectedExtracted={selectedExtracted}
            toggleSelectExtracted={toggleSelectExtracted}
            toggleSelectAll={toggleSelectAll}
          />
        </div>
      )}
    </div>
  );
}
