import React, {useState, useEffect, Suspense, lazy} from 'react';
import {
  Camera,
  FileText,
  Plus,
  ScanBarcode,
  Search,
  WifiOff,
  BookOpen,
  Library as LibraryIcon,
} from 'lucide-react';
import {BookDetails} from '../types';
import {toast} from 'sonner';
import {useParams, useSearchParams} from 'react-router-dom';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {useAddBooks} from './add-book/useAddBooks';
import {useExistingBooks} from './add-book/useExistingBooks';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {useAppPermissions} from '../hooks/useAppPermissions';
import {Checkbox} from '../components/ui/checkbox';
import {isDuplicateBook, normalizeBookDetails, toTitleCase} from '../lib/utils';
import {BookLoader} from '../components/book/BookLoader';
import {trpc, trpcVanilla} from '../lib/trpc';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import type {TrackedShelfStatus} from '../server/services/readingTracker';

import {BookSearch} from '../components/import/BookSearch';
import {CsvImportTab} from '../components/import/CsvImportTab';
import {ManualEntryTab} from './add-book/ManualEntryTab';

const ScanIsbnTab = lazy(() =>
  import('./add-book/ScanIsbnTab').then(m => ({default: m.ScanIsbnTab})),
);
const CaptureShelfTab = lazy(() =>
  import('./add-book/CaptureShelfTab').then(m => ({
    default: m.CaptureShelfTab,
  })),
);

type TabId = 'scan' | 'search' | 'camera' | 'csv' | 'manual';

const READING_STATUS_OPTIONS: Array<{
  id: TrackedShelfStatus;
  label: string;
}> = [
  {id: 'want_to_read', label: 'Want to Read'},
  {id: 'reading', label: 'Currently Reading'},
  {id: 'finished', label: 'Read'},
  {id: 'abandoned', label: 'Abandoned'},
];

function parseInitialStatus(
  rawStatus: string | null,
  isReadingMode: boolean,
): TrackedShelfStatus | 'unset' {
  if (
    rawStatus === 'want_to_read' ||
    rawStatus === 'reading' ||
    rawStatus === 'finished' ||
    rawStatus === 'abandoned'
  ) {
    return rawStatus;
  }
  return isReadingMode ? 'want_to_read' : 'unset';
}

export function AddBookView() {
  const {id: libraryId} = useParams<{id: string}>();
  const [searchParams, setSearchParams] = useSearchParams();
  const isOnline = useOnlineStatus();
  const {hasAiPlan} = useAppPermissions();
  const utils = trpc.useUtils();

  const isReadingMode = !libraryId || libraryId.startsWith('virtual_');
  const mode: 'library' | 'reading' = isReadingMode ? 'reading' : 'library';

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const requestedTab = searchParams.get('tab');
    if (
      requestedTab === 'search' ||
      requestedTab === 'scan' ||
      requestedTab === 'csv' ||
      requestedTab === 'manual' ||
      (!isReadingMode && requestedTab === 'camera')
    ) {
      return requestedTab;
    }
    return 'scan';
  });
  const [targetStatus, setTargetStatus] = useState<
    TrackedShelfStatus | 'unset'
  >(() => parseInitialStatus(searchParams.get('status'), isReadingMode));
  const [allowDuplicates, setAllowDuplicates] = useState(true);

  // Ensure Capture Shelf camera tab is never active in Reading Mode
  useEffect(() => {
    if (isReadingMode && activeTab === 'camera') {
      setActiveTab('search');
    }
  }, [isReadingMode, activeTab]);

  const {existingBooks} = useExistingBooks(libraryId, mode);
  const {addBooks, isAddingAll} = useAddBooks(libraryId, {
    mode,
    initialStatus: targetStatus,
  });

  const handleStatusSelect = (nextStatus: TrackedShelfStatus | 'unset') => {
    setTargetStatus(nextStatus);
    if (isReadingMode && nextStatus !== 'unset') {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('status', nextStatus);
      setSearchParams(nextParams, {replace: true});
    }
  };

  const handleAdd = async (book: BookDetails) => {
    if (!isOnline) {
      toast.error('Network required: Connect to the internet to add books.');
      return;
    }

    const bookToAdd = normalizeBookDetails(book);

    if (!allowDuplicates && isDuplicateBook(bookToAdd, existingBooks)) {
      toast.info(`Skipped duplicate: ${bookToAdd.title}`);
      return;
    }

    try {
      await addBooks([bookToAdd]);
    } catch {
      // Handled inside useAddBooks
    }
  };

  const handleTrackExisting = async (match: {
    libraryId: string;
    bookId: string;
    title: string;
  }) => {
    if (!isOnline) {
      toast.error('Network required: Connect to the internet to track books.');
      return;
    }

    const effectiveStatus: TrackedShelfStatus =
      targetStatus === 'unset' ? 'want_to_read' : targetStatus;

    try {
      await trpcVanilla.readingTracker.trackBook.mutate({
        source: 'library',
        libraryId: match.libraryId,
        bookId: match.bookId,
        status: effectiveStatus,
      });

      await Promise.allSettled([
        utils.readingTracker?.getShelf?.invalidate?.(),
        utils.book?.list?.invalidate?.({libraryId: match.libraryId}),
      ]);

      toast.success(
        `Tracked "${toTitleCase(match.title)}" on your reading list!`,
      );
    } catch (err) {
      console.error('Failed to track existing library book:', err);
      toast.error('Failed to update reading status.');
      throw err;
    }
  };

  return (
    <>
      <div className="layout-page-content">
        <div className="layout-header">
          <div className="space-y-1">
            <BackToLibrary libraryId={libraryId} mode={mode} className="mb-2" />
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="layout-header-title">
                {isReadingMode ? 'Find a Book' : 'Add Books'}
              </h1>
              <span
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans font-semibold bg-surface-container text-on-surface-variant border border-outline-variant/50"
                data-testid="add-book-context-badge"
              >
                {isReadingMode ? (
                  <>
                    <BookOpen className="w-3.5 h-3.5 text-primary" />
                    <span>Un-owned · Personal Reading Shelf</span>
                  </>
                ) : (
                  <>
                    <LibraryIcon className="w-3.5 h-3.5 text-primary" />
                    <span>Owned · Library Collection</span>
                  </>
                )}
              </span>
            </div>
            <p className="layout-header-subtitle">
              {isReadingMode
                ? 'Search across your libraries and global catalogs, scan an ISBN barcode, import a CSV, or add a book manually. Books added here are marked as un-owned on your reading shelf.'
                : 'Add books from your shelves by search, ISBN barcode scan, shelf photo, CSV import, or manual entry.'}
            </p>
          </div>
        </div>

        {!isOnline && (
          <div
            role="status"
            className="mb-4 bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 px-4 py-3 rounded-xl flex items-center gap-3 text-xs font-medium"
            data-testid="add-book-offline-notice"
          >
            <WifiOff className="w-4 h-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <span>
              Working offline. Adding books, barcode lookup, and shelf scanning
              require an active network connection.
            </span>
          </div>
        )}

        <div className="bg-surface rounded-2xl sm:rounded-3xl w-full flex flex-col overflow-hidden shadow-xs border border-outline-variant/40 relative">
          <div className="px-4 sm:px-6 py-4 bg-surface-container-lowest border-b border-outline-variant/30 flex flex-col gap-3.5 w-full">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 w-full">
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
                      <SelectItem
                        value="search"
                        data-testid="method-option-search"
                      >
                        <div className="flex items-center gap-2">
                          <Search size={18} className="text-primary" /> Search
                          Books
                        </div>
                      </SelectItem>
                      <SelectItem value="scan" data-testid="method-option-scan">
                        <div className="flex items-center gap-2">
                          <ScanBarcode size={18} className="text-primary" />{' '}
                          Scan ISBN
                        </div>
                      </SelectItem>
                      {!isReadingMode && (
                        <SelectItem
                          value="camera"
                          data-testid="method-option-camera"
                        >
                          <div className="flex items-center gap-2">
                            <Camera size={18} className="text-primary" />{' '}
                            <span>Capture Shelf</span>
                            {!hasAiPlan && (
                              <span className="text-[11px] text-on-surface-variant">
                                (AI Plan)
                              </span>
                            )}
                          </div>
                        </SelectItem>
                      )}
                      <SelectItem value="csv" data-testid="method-option-csv">
                        <div className="flex items-center gap-2">
                          <FileText size={18} className="text-primary" /> Import
                          CSV
                        </div>
                      </SelectItem>
                      <SelectItem
                        value="manual"
                        data-testid="method-option-manual"
                      >
                        <div className="flex items-center gap-2">
                          <Plus size={18} className="text-primary" /> Manual
                          Entry
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <label className="flex items-center gap-2 cursor-pointer sm:ml-auto text-sm text-on-surface-variant">
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

            {/* Target Reading Status Selector Bar */}
            <div className="pt-2.5 border-t border-outline-variant/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
              <span className="text-xs font-sans font-semibold text-on-surface-variant">
                {isReadingMode
                  ? 'Target Reading List:'
                  : 'Initial Reading Status (Optional):'}
              </span>
              <div
                className="flex items-center gap-1 p-1 bg-surface-container rounded-lg overflow-x-auto hide-scrollbar"
                role="radiogroup"
                aria-label="Target reading status for added books"
              >
                {!isReadingMode && (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={targetStatus === 'unset'}
                    onClick={() => handleStatusSelect('unset')}
                    className={`px-3 py-1.5 rounded-md text-xs font-sans font-medium whitespace-nowrap transition-all cursor-pointer ${
                      targetStatus === 'unset'
                        ? 'bg-surface text-primary font-semibold shadow-2xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Shelf Only
                  </button>
                )}
                {READING_STATUS_OPTIONS.map(opt => {
                  const isSelected = targetStatus === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => handleStatusSelect(opt.id)}
                      className={`px-3 py-1.5 rounded-md text-xs font-sans font-medium whitespace-nowrap transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-surface text-primary font-semibold shadow-2xs'
                          : 'text-on-surface-variant hover:text-on-surface'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-surface-container-lowest custom-scrollbar min-h-[500px]">
            <Suspense
              fallback={
                <div className="flex flex-col items-center justify-center min-h-[300px]">
                  <BookLoader size="lg" className="mb-3" />
                  <p className="text-sm font-sans text-on-surface-variant animate-pulse">
                    Loading scanning tools...
                  </p>
                </div>
              }
            >
              {activeTab === 'search' && (
                <BookSearch
                  existingBooks={existingBooks}
                  allowDuplicates={allowDuplicates}
                  onAdd={handleAdd}
                  mode={mode}
                  targetStatus={targetStatus}
                  onTrackExisting={handleTrackExisting}
                />
              )}

              {activeTab === 'scan' && (
                <ScanIsbnTab
                  addBooks={addBooks}
                  isAddingAll={isAddingAll}
                  existingBooks={existingBooks}
                  allowDuplicates={allowDuplicates}
                  mode={mode}
                />
              )}

              {!isReadingMode && activeTab === 'camera' && (
                <CaptureShelfTab
                  addBooks={addBooks}
                  existingBooks={existingBooks}
                  allowDuplicates={allowDuplicates}
                  hasAiPlan={hasAiPlan}
                />
              )}

              {activeTab === 'csv' && (
                <CsvImportTab
                  allowDuplicates={allowDuplicates}
                  existingBooks={existingBooks}
                  addBooks={addBooks}
                  mode={mode}
                />
              )}

              {activeTab === 'manual' && (
                <ManualEntryTab
                  existingBooks={existingBooks}
                  allowDuplicates={allowDuplicates}
                  addBooks={addBooks}
                  mode={mode}
                />
              )}
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}
