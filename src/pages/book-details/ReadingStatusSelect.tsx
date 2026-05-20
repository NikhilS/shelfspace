import React, {memo} from 'react';
import {toast} from 'sonner';
import {useAuth} from '../../contexts/AuthContext';
import {Book, BookDetailsPayload} from './useBook';

interface ReadingStatusSelectProps {
  libraryId: string;
  bookId: string;
  book: Book;
  bookBase: Book | null;
  bookDetails: BookDetailsPayload | null;
  canEdit: boolean;
  updateBookOptimistically: (
    partialBook: Partial<Book & BookDetailsPayload>,
  ) => void;
  updateReadingStatus: (
    status: 'unset' | 'reading' | 'finished' | 'abandoned',
  ) => Promise<void>;
}

export const ReadingStatusSelect = memo(
  ({
    libraryId,
    bookId,
    book,
    bookBase,
    bookDetails,
    canEdit,
    updateBookOptimistically,
    updateReadingStatus,
  }: ReadingStatusSelectProps) => {
    const {user} = useAuth();

    const currentStatus = book.userStatuses?.[user?.uid || ''] || 'unset';

    return (
      <section className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-surface-container p-4 rounded-lg border border-outline-variant/30 w-fit">
        <label
          htmlFor="readingStatus"
          className="font-label-caps text-label-caps text-on-surface-variant"
        >
          Reading Status
        </label>
        <select
          id="readingStatus"
          value={currentStatus}
          onChange={async e => {
            if (!libraryId || !bookId || !user) return;
            const newStatus = e.target.value as
              | 'unset'
              | 'reading'
              | 'finished'
              | 'abandoned';
            const originalBookBase = bookBase ? {...bookBase} : null;
            const originalBookDetails = bookDetails ? {...bookDetails} : null;

            // Optimistic update
            updateBookOptimistically({
              userStatuses: {
                ...(book.userStatuses || {}),
                [user.uid]: newStatus,
              },
            });

            try {
              await updateReadingStatus(newStatus);
              toast.success('Reading status updated');
            } catch {
              updateBookOptimistically({
                ...originalBookBase,
                ...originalBookDetails,
              });
              toast.error('Failed to update status');
            }
          }}
          disabled={!canEdit}
          className="px-4 py-2 bg-surface text-on-surface border border-outline-variant/60 rounded focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer disabled:opacity-50 appearance-none min-w-[180px] text-sm font-medium"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")",
            backgroundPosition: 'right 0.75rem center',
            backgroundRepeat: 'no-repeat',
            backgroundSize: '1em',
          }}
        >
          <option value="unset">Not Started</option>
          <option value="reading">Currently Reading</option>
          <option value="finished">Finished</option>
          <option value="abandoned">Abandoned</option>
        </select>
      </section>
    );
  },
);
