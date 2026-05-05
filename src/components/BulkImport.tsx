import React, {useRef, useState} from 'react';
import {UploadCloud, Loader2, FileText} from 'lucide-react';
import {extractBooksFromCsv} from '../services/gemini';
import {toast} from 'sonner';
import {logger} from '../contexts/DebugContext';
import {Button} from '@/components/ui/button';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';

interface BulkImportProps {
  onBooksExtracted: (
    books: {
      title: string;
      author: string;
      isbn?: string;
      genres?: string[];
      format?: 'physical' | 'digital';
    }[],
  ) => void;
  isExtracting: boolean;
  setIsExtracting: (extracting: boolean) => void;
  csvFormat: 'physical' | 'digital';
  setCsvFormat: (format: 'physical' | 'digital') => void;
}

export default function BulkImport({
  onBooksExtracted,
  isExtracting,
  setIsExtracting,
  csvFormat,
  setCsvFormat,
}: BulkImportProps) {
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    logger.info(
      `Starting CSV file upload: ${file.name} (${Math.round(file.size / 1024)} KB)`,
    );

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      logger.warn(`Invalid file type rejected: ${file.name} (${file.type})`);
      toast.error('Please upload a valid CSV file.');
      return;
    }
    setIsExtracting(true);
    setExtractionStatus('Reading CSV file...');
    try {
      const text = await file.text();
      logger.info(
        `CSV text extracted, total length: ${text.length} characters`,
      );

      setExtractionStatus('Extracting books using AI...');
      logger.info('Sending CSV text to Gemini for standard book extraction...');

      const books = await extractBooksFromCsv(text);
      onBooksExtracted(books);

      if (books.length === 0) {
        logger.warn('Gemini extraction returned 0 books from the CSV');
        toast.error('No books could be extracted from this file.');
      } else {
        logger.info(`Successfully extracted ${books.length} books from CSV.`);
        toast.success(`Found ${books.length} books in CSV.`);
      }
    } catch (error) {
      logger.error(
        `CSV Processing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof Error) toast.error(error.message);
      else toast.error('Failed to process CSV file.');
    } finally {
      setIsExtracting(false);
      setExtractionStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="bg-surface-container-lowest p-6 sm:p-12 rounded-3xl border-2 border-dashed border-outline-variant/60 flex flex-col items-center justify-center text-center">
      <div className="w-16 h-16 sm:w-20 sm:h-20 bg-surface-container-low rounded-full flex items-center justify-center text-primary mb-6 shadow-[0_2px_10px_rgb(26,47,75,0.04)] border border-outline-variant/40">
        <UploadCloud className="w-8 h-8 sm:w-10 sm:h-10" strokeWidth={2} />
      </div>
      <h3 className="font-headline-lg text-headline-lg sm:text-headline-xl text-on-surface mb-3 tracking-tight">
        Upload Library CSV
      </h3>
      <p className="text-on-surface-variant font-body-md text-body-md sm:text-body-lg mb-6 max-w-md leading-relaxed">
        Upload a CSV export from Goodreads, Amazon, or your own spreadsheet. Our
        AI will automatically extract the titles, authors, and ISBNs.
      </p>

      <div className="mb-8 w-full max-w-xs text-left">
        <label className="block text-sm font-bold text-on-surface mb-1.5 ml-1 text-center">
          Default Format
        </label>
        <Select
          value={csvFormat}
          onValueChange={(val: 'physical' | 'digital') => setCsvFormat(val)}
        >
          <SelectTrigger className="w-full bg-surface-container border border-outline-variant/80 rounded-2xl px-5 py-6 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/60 transition-all text-on-surface font-medium">
            <SelectValue placeholder="Select format" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="physical">Physical Books</SelectItem>
            <SelectItem value="digital">Digital / E-Books</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <input
        type="file"
        accept=".csv"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      <Button
        onClick={() => fileInputRef.current?.click()}
        disabled={isExtracting}
        className="rounded-full shadow-[0_4px_16px_rgb(26,47,75,0.15)] hover:shadow-lg hover:-translate-y-0.5 flex items-center justify-center gap-3 px-8 py-6"
      >
        {isExtracting ? (
          <>
            <Loader2 className="animate-spin" size={20} strokeWidth={2.5} />{' '}
            {extractionStatus || 'Processing CSV...'}
          </>
        ) : (
          <>
            <FileText size={20} strokeWidth={2.5} /> Select CSV File
          </>
        )}
      </Button>
    </div>
  );
}
