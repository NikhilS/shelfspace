import React, {useState} from 'react';
import {BookDetails} from '../../services/bookApi';
import CameraScanner from '../../components/CameraScanner';
import ExtractedBooksTable from '../../components/ExtractedBooksTable';
import {logger} from '../../stores/debugStore';
import {triggerHaptics} from '../../lib/utils';

interface CaptureShelfTabProps {
  addBooks: (books: BookDetails[]) => Promise<BookDetails[] | void | undefined>;
  existingBooks: BookDetails[];
  allowDuplicates: boolean;
}

export function CaptureShelfTab({
  addBooks,
  existingBooks,
  allowDuplicates,
}: CaptureShelfTabProps) {
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
