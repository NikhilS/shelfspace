import React, {memo} from 'react';
import {toast} from 'sonner';
import {useAuth} from '../../stores/authStore';
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
      <section className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-surface-container p-4 rounded-lg border border-outline-variant/30 w-fit swiper-no-swiping">
        <label
          htmlFor="readingStatus"
          className="font-label-caps text-label-caps text-on-surface-variant"
        >
          Reading Status
        </label>
        <Select
          value={currentStatus}
          onValueChange={async (val: string) => {
            if (!libraryId || !bookId || !user) return;
            const newStatus = val as 'unset' | 'reading' | 'finished';
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
        >
          <SelectTrigger
            id="readingStatus"
            className="swiper-no-swiping min-w-[180px] bg-surface text-on-surface border-outline-variant/60"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="swiper-no-swiping">
            <SelectItem value="unset">Not Started</SelectItem>
            <SelectItem value="reading">Currently Reading</SelectItem>
            <SelectItem value="finished">Finished</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
          </SelectContent>
        </Select>
      </section>
    );
  },
);
