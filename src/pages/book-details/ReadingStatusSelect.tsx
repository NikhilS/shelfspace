import React, {memo} from 'react';
import {toast} from 'sonner';
import {useAuth} from '../../stores/authStore';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {Book, BookDetailsPayload} from './useBook';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
    status: 'unset' | 'want_to_read' | 'reading' | 'finished' | 'abandoned',
  ) => Promise<void>;
}

export const ReadingStatusSelect = memo(
  ({
    libraryId,
    bookId,
    book,
    bookBase,
    bookDetails,
    updateBookOptimistically,
    updateReadingStatus,
  }: ReadingStatusSelectProps) => {
    const {user} = useAuth();
    const isOnline = useOnlineStatus();

    const rawStatus = book.userStatuses?.[user?.uid || ''] || 'unset';
    const currentStatus = rawStatus === 'completed' ? 'finished' : rawStatus;

    return (
      <section className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bento-card p-3.5 sm:p-4 w-full sm:w-fit swiper-no-swiping">
        <label
          htmlFor="readingStatus"
          className="metadata-eyebrow shrink-0 pr-2"
        >
          Reading Status
        </label>
        <Select
          value={currentStatus}
          onValueChange={async (val: string) => {
            if (!libraryId || !bookId || !user || !isOnline) {
              return;
            }
            const newStatus = val as
              'unset' | 'want_to_read' | 'reading' | 'finished' | 'abandoned';
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
          disabled={!user || !isOnline}
        >
          <SelectTrigger
            id="readingStatus"
            title={!isOnline ? 'Unavailable while offline' : undefined}
            className="swiper-no-swiping min-w-[190px] h-9 bg-surface-container-low text-on-surface border-outline-variant/70 font-medium"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="swiper-no-swiping">
            <SelectItem value="unset">Not Started</SelectItem>
            <SelectItem value="want_to_read">Want to Read</SelectItem>
            <SelectItem value="reading">Currently Reading</SelectItem>
            <SelectItem value="finished">Finished</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>
      </section>
    );
  },
);
