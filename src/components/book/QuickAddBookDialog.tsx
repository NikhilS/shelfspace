import React, {useState, useEffect} from 'react';
import {useNavigate} from 'react-router-dom';
import {BookOpen, Library as LibraryIcon, ArrowRight} from 'lucide-react';
import {toast} from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import BookSearch from '../import/BookSearch';
import {useAddBooks} from '../../pages/add-book/useAddBooks';
import {useExistingBooks} from '../../pages/add-book/useExistingBooks';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {
  isDuplicateBook,
  normalizeBookDetails,
  toTitleCase,
} from '../../lib/utils';
import type {BookDetails} from '../../types';
import type {TrackedShelfStatus} from '../../server/services/readingTracker';

const READING_STATUS_OPTIONS: Array<{
  id: TrackedShelfStatus;
  label: string;
}> = [
  {id: 'want_to_read', label: 'Want to Read'},
  {id: 'reading', label: 'Currently Reading'},
  {id: 'finished', label: 'Read'},
  {id: 'abandoned', label: 'Abandoned'},
];

export interface QuickAddBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'reading' | 'library';
  libraryId?: string;
  libraryName?: string;
  initialStatus?: TrackedShelfStatus;
}

export function QuickAddBookDialog({
  isOpen,
  onClose,
  mode,
  libraryId,
  libraryName,
  initialStatus = 'want_to_read',
}: QuickAddBookDialogProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const utils = trpc.useUtils();

  const isReadingMode =
    mode === 'reading' || !libraryId || libraryId.startsWith('virtual_');
  const resolvedMode: 'reading' | 'library' = isReadingMode
    ? 'reading'
    : 'library';

  const [targetStatus, setTargetStatus] = useState<
    TrackedShelfStatus | 'unset'
  >(() => (isReadingMode ? initialStatus : 'unset'));

  // Sync status when dialog re-opens with a different shelf context
  useEffect(() => {
    if (isOpen) {
      setTargetStatus(isReadingMode ? initialStatus : 'unset');
    }
  }, [isOpen, isReadingMode, initialStatus]);

  const {existingBooks} = useExistingBooks(libraryId, resolvedMode);
  const {addBooks} = useAddBooks(libraryId, {
    mode: resolvedMode,
    initialStatus: targetStatus,
  });

  const handleAdd = async (book: BookDetails) => {
    if (!isOnline) {
      toast.error('Network required: Connect to the internet to add books.');
      return;
    }

    const bookToAdd = normalizeBookDetails(book);

    if (isDuplicateBook(bookToAdd, existingBooks)) {
      toast.info(`"${bookToAdd.title}" is already in your collection.`);
    }

    await addBooks([bookToAdd]);
    onClose();
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
      onClose();
    } catch (err) {
      console.error('Failed to track existing library book:', err);
      toast.error('Failed to update reading status.');
      throw err;
    }
  };

  const handleOpenAdvanced = () => {
    onClose();
    if (isReadingMode) {
      const statusParam =
        targetStatus === 'unset' ? 'want_to_read' : targetStatus;
      void navigate(`/reading/add?status=${encodeURIComponent(statusParam)}`);
    } else if (libraryId) {
      void navigate(`/library/${encodeURIComponent(libraryId)}/add`);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden"
        data-testid="quick-add-book-dialog"
      >
        <DialogHeader className="space-y-2 pb-2 border-b border-outline-variant/40">
          <div className="flex flex-wrap items-center gap-2.5 pr-10 min-h-8">
            <DialogTitle className="font-serif text-2xl text-on-surface leading-8">
              {isReadingMode
                ? 'Track a Book'
                : libraryName
                  ? `Add Book to ${toTitleCase(libraryName)}`
                  : 'Add Books to Library'}
            </DialogTitle>
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-sans font-semibold bg-surface-container text-on-surface-variant border border-outline-variant/50"
              data-testid="quick-add-context-badge"
            >
              {isReadingMode ? (
                <>
                  <BookOpen className="w-3.5 h-3.5 text-primary" />
                  <span>Personal Reading Shelf</span>
                </>
              ) : (
                <>
                  <LibraryIcon className="w-3.5 h-3.5 text-primary" />
                  <span>Owned · Library Collection</span>
                </>
              )}
            </span>
          </div>

          <DialogDescription className="font-sans text-xs sm:text-sm text-on-surface-variant">
            {isReadingMode
              ? 'Search across your libraries and global catalogs to add a book in one click, or open Advanced for ISBN barcode scanning, CSV import, and manual entry.'
              : 'Search by title, author, or ISBN to add a book in one click, or open Advanced for ISBN barcode scanning, shelf camera capture, CSV import, and manual entry.'}
          </DialogDescription>

          {isReadingMode && (
            <div className="pt-1.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-sans font-semibold text-on-surface-variant">
                Target Reading List:
              </span>
              <div
                className="flex items-center gap-1 p-1 bg-surface-container rounded-lg overflow-x-auto hide-scrollbar"
                role="radiogroup"
                aria-label="Target reading status for added book"
              >
                {READING_STATUS_OPTIONS.map(opt => {
                  const isSelected = targetStatus === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setTargetStatus(opt.id)}
                      className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium whitespace-nowrap transition-all cursor-pointer ${
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
          )}
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pt-2 pr-1 custom-scrollbar min-h-[280px]">
          {isOpen && (
            <BookSearch
              key={`${resolvedMode}-${libraryId || 'reading'}`}
              existingBooks={existingBooks}
              allowDuplicates={true}
              onAdd={handleAdd}
              mode={resolvedMode}
              targetStatus={targetStatus}
              onTrackExisting={handleTrackExisting}
              autoFocus
            />
          )}
        </div>

        <div className="pt-3 border-t border-outline-variant/40 flex items-center justify-between gap-3 text-xs text-on-surface-variant font-sans">
          <span>
            {isReadingMode
              ? 'Need ISBN barcode scanning, CSV upload, or manual entry?'
              : 'Need ISBN barcode scanning, shelf camera capture, CSV upload, or manual entry?'}
          </span>
          <button
            type="button"
            onClick={handleOpenAdvanced}
            data-testid="quick-add-advanced-link"
            className="font-semibold text-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <span>Open Advanced Tools</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
