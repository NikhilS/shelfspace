import React, {useState} from 'react';
import {BookDetails} from '../services/bookApi';
import BulkImport from './BulkImport';
import ExtractedBooksTable from './ExtractedBooksTable';

interface CSVImportTabProps {
  allowDuplicates: boolean;
  existingBooks: BookDetails[];
  addBooks: (books: BookDetails[]) => Promise<BookDetails[] | void | undefined>;
}

export default function CSVImportTab({
  allowDuplicates,
  existingBooks,
  addBooks,
}: CSVImportTabProps) {
  const [extractedBooks, setExtractedBooks] = useState<
    {
      title: string;
      author: string;
      isbn?: string;
      genres?: string[];
      format?: 'physical' | 'digital';
    }[]
  >([]);
  const [selectedExtracted, setSelectedExtracted] = useState<Set<string>>(
    new Set(),
  );
  const [csvFormat, setCsvFormat] = useState<'physical' | 'digital'>(
    'physical',
  );
  const [isExtracting, setIsExtracting] = useState(false);

  return (
    <div className="space-y-6 flex flex-col items-center w-full">
      {extractedBooks.length === 0 ? (
        <BulkImport
          onBooksExtracted={books => {
            setExtractedBooks(books);
            setSelectedExtracted(
              new Set(books.map(b => `${b.title}::${b.author}`)),
            );
          }}
          isExtracting={isExtracting}
          setIsExtracting={setIsExtracting}
          csvFormat={csvFormat}
          setCsvFormat={setCsvFormat}
        />
      ) : (
        <ExtractedBooksTable
          extractedBooks={extractedBooks}
          setExtractedBooks={setExtractedBooks}
          selectedExtracted={selectedExtracted}
          setSelectedExtracted={setSelectedExtracted}
          allowDuplicates={allowDuplicates}
          existingBooks={existingBooks}
          csvFormat={csvFormat}
          addBooks={addBooks}
        />
      )}
    </div>
  );
}
