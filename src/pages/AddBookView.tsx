import React, {useState} from 'react';
import {Camera, FileText, Plus, ScanBarcode, Search} from 'lucide-react';
import {BookDetails} from '../services/bookApi';
import {toast} from 'sonner';
import {useParams} from 'react-router-dom';
import {useAddBooks} from './add-book/useAddBooks';
import {useExistingBooks} from './add-book/useExistingBooks';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import {Checkbox} from '../components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';

import BookSearch from '../components/BookSearch';
import CSVImportTab from '../components/CSVImportTab';
import {ScanISBNTab} from './add-book/ScanISBNTab';
import {CaptureShelfTab} from './add-book/CaptureShelfTab';
import {ManualEntryTab} from './add-book/ManualEntryTab';

type TabId = 'scan' | 'search' | 'camera' | 'csv' | 'manual';

export default function AddBookView() {
  const {id: libraryId} = useParams<{id: string}>();

  const [activeTab, setActiveTab] = useState<TabId>('scan');
  const [allowDuplicates, setAllowDuplicates] = useState(true);

  const {existingBooks} = useExistingBooks(libraryId);
  const {addBooks, isAddingAll} = useAddBooks(libraryId);

  const handleAdd = async (book: BookDetails) => {
    const cleanNewIsbn = (book.isbn || '').trim().replace(/[^0-9X]/gi, '');
    const cleanNewTitle = (book.title || '').trim().toLowerCase();
    const cleanNewAuthor = (book.author || '').trim().toLowerCase();

    if (
      !allowDuplicates &&
      existingBooks.some(b => {
        const cleanExistingIsbn = (b.isbn || '')
          .trim()
          .replace(/[^0-9X]/gi, '');
        const hasSameIsbn =
          cleanExistingIsbn.length >= 10 &&
          cleanNewIsbn.length >= 10 &&
          cleanExistingIsbn === cleanNewIsbn;
        const hasSameTitleAndAuthor =
          (b.title || '').trim().toLowerCase() === cleanNewTitle &&
          (b.author || '').trim().toLowerCase() === cleanNewAuthor;
        return hasSameIsbn || (cleanNewTitle && hasSameTitleAndAuthor);
      })
    ) {
      toast.info(`Skipped duplicate: ${book.title}`);
      return;
    }

    try {
      const bookToAdd = {
        ...book,
        format: book.format || 'physical',
      } as BookDetails;
      await addBooks([bookToAdd]);
      toast.success(`Added ${bookToAdd.title}`);
    } catch {
      toast.error('Failed to add book');
    }
  };

  return (
    <>
      <LibrarySidebarNav libraryId={libraryId} />
      <div className="layout-page-content">
        <div className="layout-header">
          <div>
            <h2 className="layout-header-title">Expand Your Shelves</h2>
            <p className="layout-header-subtitle">
              Grow your library! Dust off your books and add them via
              barcode-scan, snapshot, CSV upload, or lookup.
            </p>
          </div>
        </div>

        <div className="bg-surface rounded-2xl sm:rounded-[32px] w-full flex flex-col overflow-hidden shadow-sm border border-outline-variant/30 relative">
          <div className="px-4 sm:px-6 py-4 sm:py-5 bg-surface-container-lowest border-b border-outline-variant/30 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 w-full">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-sm text-on-surface mb-1 sm:mb-0">
                Selected Method:
              </span>
              <div className="w-full sm:w-64">
                <Select
                  value={activeTab}
                  onValueChange={(val: TabId) => setActiveTab(val)}
                >
                  <SelectTrigger
                    className="w-full bg-surface border-outline-variant/40 hover:border-primary/50 focus:ring-primary/20"
                    data-testid="method-selector-trigger"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="scan">
                      <div className="flex items-center gap-2">
                        <ScanBarcode size={18} className="text-primary" /> Scan
                        ISBN
                      </div>
                    </SelectItem>
                    <SelectItem
                      value="camera"
                      data-testid="method-option-camera"
                    >
                      <div className="flex items-center gap-2">
                        <Camera size={18} className="text-primary" /> Capture
                        Shelf
                      </div>
                    </SelectItem>
                    <SelectItem value="csv">
                      <div className="flex items-center gap-2">
                        <FileText size={18} className="text-primary" /> Import
                        CSV
                      </div>
                    </SelectItem>
                    <SelectItem value="search">
                      <div className="flex items-center gap-2">
                        <Search size={18} className="text-primary" /> Search
                        Database
                      </div>
                    </SelectItem>
                    <SelectItem value="manual">
                      <div className="flex items-center gap-2">
                        <Plus size={18} className="text-primary" /> Manual Entry
                      </div>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer ml-auto text-sm text-on-surface-variant mt-2 sm:mt-0">
              <Checkbox
                className="w-4 h-4"
                checked={allowDuplicates}
                onCheckedChange={checked =>
                  setAllowDuplicates(checked === true)
                }
              />
              Allow duplicate copies
            </label>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-surface-container-lowest custom-scrollbar min-h-[500px]">
            {activeTab === 'search' && (
              <BookSearch
                existingBooks={existingBooks}
                allowDuplicates={allowDuplicates}
                onAdd={handleAdd}
              />
            )}

            {activeTab === 'scan' && (
              <ScanISBNTab addBooks={addBooks} isAddingAll={isAddingAll} />
            )}

            {activeTab === 'camera' && (
              <CaptureShelfTab
                addBooks={addBooks}
                existingBooks={existingBooks}
                allowDuplicates={allowDuplicates}
              />
            )}

            {activeTab === 'csv' && (
              <CSVImportTab
                allowDuplicates={allowDuplicates}
                existingBooks={existingBooks}
                addBooks={addBooks}
              />
            )}

            {activeTab === 'manual' && (
              <ManualEntryTab
                existingBooks={existingBooks}
                allowDuplicates={allowDuplicates}
                addBooks={addBooks}
              />
            )}
          </div>
        </div>
      </div>
    </>
  );
}
