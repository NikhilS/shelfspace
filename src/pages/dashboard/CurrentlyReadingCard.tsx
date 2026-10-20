import React, {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  BookOpen,
  CheckCircle2,
  Plus,
  Book as BookIcon,
  ArrowRight,
} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import type {
  TrackedBookItem,
  TrackedShelfStatus,
} from '../../server/services/readingTracker';

interface CurrentlyReadingCardProps {
  readingBooks: TrackedBookItem[];
  onStatusChange: (
    libraryId: string,
    bookId: string,
    status: TrackedShelfStatus | 'unset',
  ) => Promise<void>;
  onTrackBook: () => void;
  onOpenReadingLists: (initialTab: TrackedShelfStatus) => void;
}

export const CurrentlyReadingCard: React.FC<CurrentlyReadingCardProps> = ({
  readingBooks,
  onStatusChange,
  onTrackBook,
  onOpenReadingLists,
}) => {
  const navigate = useNavigate();
  const [selectedIndex, setSelectedIndex] = useState(0);

  const safeIndex = selectedIndex < readingBooks.length ? selectedIndex : 0;
  const activeBook = readingBooks[safeIndex] || null;

  const openBookDetails = (book: TrackedBookItem) => {
    void navigate(
      `/library/${encodeURIComponent(book.libraryId)}/book/${encodeURIComponent(book.id)}`,
      {
        state: {from: '/'},
      },
    );
  };

  return (
    <div className="bento-card p-5 sm:p-6 flex flex-col justify-between h-full min-w-0">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="metadata-eyebrow">Currently Reading</span>
          {readingBooks.length > 0 && (
            <Badge variant="status-reading" size="sm">
              {readingBooks.length} Active
            </Badge>
          )}
        </div>
        {readingBooks.length > 1 && (
          <button
            type="button"
            onClick={() => onOpenReadingLists('reading')}
            className="text-xs font-sans font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
          >
            <span>View All ({readingBooks.length})</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {!activeBook ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4">
          <div className="w-12 h-12 rounded-full bg-surface-container flex items-center justify-center text-primary/80 mb-3.5 border border-outline-variant/50">
            <BookOpen className="w-5 h-5" />
          </div>
          <h3 className="font-serif text-lg font-semibold text-on-surface mb-1">
            Nothing Open on the Nightstand
          </h3>
          <p className="font-sans text-xs sm:text-sm text-on-surface-variant max-w-md mb-5 leading-relaxed">
            Pick a book you&apos;re currently reading from your libraries or
            search external catalogs to spotlight it here.
          </p>
          <Button
            type="button"
            onClick={onTrackBook}
            className="gap-2 rounded-lg font-sans font-semibold h-9 px-4 text-xs"
          >
            <Plus className="w-4 h-4" />
            <span>Start Reading a Book</span>
          </Button>
        </div>
      ) : (
        <div className="flex flex-col justify-between flex-1 gap-5">
          <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start my-auto">
            {/* Framed 2:3 Cover */}
            <div
              onClick={() => openBookDetails(activeBook)}
              className="w-28 sm:w-32 aspect-[2/3] shrink-0 rounded-lg bg-surface-container book-cover-shadow border border-outline-variant/60 overflow-hidden relative cursor-pointer group"
            >
              <div
                className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 via-white/20 to-transparent z-10 pointer-events-none"
                aria-hidden="true"
              />
              {activeBook.coverUrl ? (
                <img
                  src={activeBook.coverUrl}
                  alt={activeBook.title}
                  className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full p-3 flex flex-col justify-between bg-gradient-to-b from-surface-container-low via-surface-container to-surface-container-high text-left">
                  <BookIcon className="w-4 h-4 text-on-surface-variant/60" />
                  <span className="font-serif text-xs font-semibold text-primary line-clamp-3 leading-snug">
                    {toTitleCase(activeBook.title)}
                  </span>
                  <span className="font-mono text-[9px] text-on-surface-variant uppercase truncate">
                    {toTitleCase(activeBook.author)}
                  </span>
                </div>
              )}
            </div>

            {/* Book Editorial Callout */}
            <div className="flex-1 min-w-0 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-on-surface-variant mb-1.5">
                <span className="font-sans font-medium">
                  {activeBook.ownershipStatus === 'unowned' ||
                  activeBook.isVirtual
                    ? 'Un-owned Volume'
                    : `In ${toTitleCase(activeBook.libraryName)}`}
                </span>
                {activeBook.primaryGenre && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{activeBook.primaryGenre}</span>
                  </>
                )}
              </div>

              <h3
                onClick={() => openBookDetails(activeBook)}
                className="font-serif text-xl sm:text-2xl font-semibold tracking-tight text-primary hover:underline cursor-pointer line-clamp-2 leading-snug"
              >
                {toTitleCase(activeBook.title)}
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-1">
                {toTitleCase(activeBook.author || 'Unknown Author')}
              </p>

              {activeBook.synopsis && (
                <p className="font-sans text-xs text-on-surface-variant/90 line-clamp-2 mt-3 leading-relaxed max-w-xl">
                  {activeBook.synopsis}
                </p>
              )}

              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 mt-4">
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openBookDetails(activeBook)}
                  className="h-9 px-4 rounded-lg font-sans text-xs font-semibold"
                >
                  Book Details & Notes
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void onStatusChange(
                      activeBook.libraryId,
                      activeBook.id,
                      'finished',
                    )
                  }
                  className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5"
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                  <span>Mark Finished</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Switcher if multiple books are currently being read */}
          {readingBooks.length > 1 && (
            <div className="pt-3 border-t border-outline-variant/50 flex items-center gap-2 overflow-x-auto">
              <span className="metadata-eyebrow shrink-0 mr-1">
                Also Reading:
              </span>
              {readingBooks.map((book, idx) => {
                const isSelected = idx === safeIndex;
                return (
                  <button
                    key={`${book.libraryId}-${book.id}`}
                    type="button"
                    onClick={() => setSelectedIndex(idx)}
                    className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium truncate max-w-[180px] transition-colors cursor-pointer shrink-0 ${
                      isSelected
                        ? 'bg-primary text-on-primary font-semibold'
                        : 'bg-surface-container text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    {toTitleCase(book.title)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
