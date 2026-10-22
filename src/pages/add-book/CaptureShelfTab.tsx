import React, {useState} from 'react';
import {Sparkles} from 'lucide-react';
import {BookDetails} from '../../types';
import {CameraScanner} from '../../components/import/CameraScanner';
import {ExtractedBooksTable} from '../../components/import/ExtractedBooksTable';
import {ShelfViewfinderIllustration} from '@/components/ui/empty-state-illustrations';
import {logger} from '../../stores/debugStore';
import {triggerHaptics} from '../../lib/utils';

interface CaptureShelfTabProps {
  addBooks: (books: BookDetails[]) => Promise<BookDetails[] | void | undefined>;
  existingBooks: BookDetails[];
  allowDuplicates: boolean;
  hasAiPlan?: boolean;
}

export function CaptureShelfTab({
  addBooks,
  existingBooks,
  allowDuplicates,
  hasAiPlan = true,
}: CaptureShelfTabProps) {
  const [extractedBooks, setExtractedBooks] = useState<
    Array<{
      title: string;
      author: string;
      isbn?: string;
      primaryGenre?: string;
      subgenres?: string[];
      isCustomPrimary?: boolean;
      format?: 'physical' | 'digital';
      coverUrl?: string;
      publishedDate?: string;
    }>
  >([]);
  const [selectedExtracted, setSelectedExtracted] = useState<Set<string>>(
    new Set(),
  );
  const [isExtracting, setIsExtracting] = useState(false);

  if (!hasAiPlan) {
    return (
      <div
        className="w-full max-w-lg mx-auto py-14 px-6 text-center rounded-2xl border border-outline-variant/40 bg-surface-container-low/50 flex flex-col items-center gap-3"
        data-testid="capture-shelf-ai-plan-notice"
      >
        <ShelfViewfinderIllustration className="w-20 h-16 mb-1" />
        <h3 className="font-serif text-lg font-semibold text-primary">
          Photo Shelf Scan
        </h3>
        <p className="font-sans text-xs sm:text-sm text-on-surface-variant max-w-md leading-relaxed">
          Optical bookshelf spine extraction uses Gemini Vision. You can still
          add books at any time using Search Database, Scan ISBN, Import CSV, or
          Manual Entry.
        </p>
        <span
          className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-sans font-medium bg-surface-container text-on-surface-variant border border-outline-variant/50"
          title="Requires AI Plan (Admin-enabled)"
        >
          <Sparkles className="w-3.5 h-3.5 text-on-surface-variant/70" />
          Requires AI Plan (Admin-enabled)
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-6 flex flex-col items-center">
      {extractedBooks.length === 0 && (
        <CameraScanner
          onBooksExtracted={books => {
            triggerHaptics([50]);
            logger.info(
              `Extraction complete. Identified ${books.length} potential books.`,
            );
            setExtractedBooks(books);
            setSelectedExtracted(
              new Set(books.map(b => `${b.title}::${b.author}`)),
            );
          }}
          isExtracting={isExtracting}
          setIsExtracting={setIsExtracting}
        />
      )}

      {extractedBooks.length > 0 && (
        <ExtractedBooksTable
          extractedBooks={extractedBooks}
          setExtractedBooks={setExtractedBooks}
          selectedExtracted={selectedExtracted}
          setSelectedExtracted={setSelectedExtracted}
          allowDuplicates={allowDuplicates}
          existingBooks={existingBooks}
          csvFormat="physical"
          addBooks={addBooks}
        />
      )}
    </div>
  );
}
