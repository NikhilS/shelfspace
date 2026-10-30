import React, {useState, useRef, useMemo} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  CheckCircle2,
  Plus,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {NightstandBookIllustration} from '@/components/ui/empty-state-illustrations';
import {ArchivalCoverImage} from './ArchivalCoverImage';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {preloadRouteChunk} from '../../lib/routePreload';
import {BookSwipeDeck, type BookSwipeDeckHandle} from './BookSwipeDeck';
import type {Book} from '../../types';
import type {
  TrackedBookItem,
  TrackedShelfStatus,
} from '../../server/services/readingTracker';

export interface DefaultLibraryContext {
  id: string;
  name?: string;
}

/**
 * Shared adapter that normalizes either a raw library `Book` or a `TrackedBookItem`
 * into the canonical `TrackedBookItem` contract used across the Reading Room and Library Overview.
 */
export function normalizeToTrackedBookItem(
  item: Book | TrackedBookItem,
  defaultLibrary?: DefaultLibraryContext,
): TrackedBookItem | null {
  const rawStatus = item.readingStatus;
  let readingStatus: TrackedShelfStatus | 'unset' = 'unset';
  if (rawStatus === 'completed' || rawStatus === 'finished') {
    readingStatus = 'finished';
  } else if (
    rawStatus === 'reading' ||
    rawStatus === 'want_to_read' ||
    rawStatus === 'abandoned'
  ) {
    readingStatus = rawStatus;
  }

  if (readingStatus === 'unset') {
    return null;
  }

  const resolvedLibId = item.libraryId || defaultLibrary?.id || 'unknown';
  const isVirtual =
    ('isVirtual' in item && Boolean(item.isVirtual)) ||
    resolvedLibId.startsWith('virtual_');

  return {
    ...item,
    libraryId: resolvedLibId,
    libraryName:
      ('libraryName' in item && item.libraryName) ||
      defaultLibrary?.name ||
      (isVirtual ? 'Personal Reading Shelf' : 'Library'),
    isVirtual,
    ownershipStatus:
      item.ownershipStatus === 'unowned' || isVirtual ? 'unowned' : 'owned',
    readingStatus,
    ...(typeof item.userRating === 'number'
      ? {userRating: item.userRating}
      : {}),
  };
}

export interface CurrentlyReadingCardProps {
  readingBooks: Array<Book | TrackedBookItem>;
  defaultLibrary?: DefaultLibraryContext;
  /**
   * Controls whether the library provenance label ("In <Library Name>" / "Un-owned Volume")
   * is displayed above the book title. Defaults to `true` in the consolidated Reading Room
   * and `false` when rendered inside a specific Library Overview where the library context is already known.
   */
  showLibraryProvenance?: boolean;
  onStatusChange?: (
    libraryId: string,
    bookId: string,
    status: TrackedShelfStatus | 'unset',
  ) => Promise<void>;
  onTrackBook?: () => void;
  onOpenReadingLists?: (initialTab: TrackedShelfStatus) => void;
  fromPath?: string;
}

export function CurrentlyReadingCard({
  readingBooks,
  defaultLibrary,
  showLibraryProvenance = true,
  onStatusChange,
  onTrackBook,
  onOpenReadingLists,
  fromPath = '/',
}: CurrentlyReadingCardProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const deckRef = useRef<BookSwipeDeckHandle | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const normalizedBooks = useMemo<TrackedBookItem[]>(() => {
    const result: TrackedBookItem[] = [];
    for (const raw of readingBooks) {
      const normalized = normalizeToTrackedBookItem(raw, defaultLibrary);
      if (normalized && normalized.readingStatus === 'reading') {
        result.push(normalized);
      }
    }
    return result;
  }, [readingBooks, defaultLibrary]);

  const safeIndex = selectedIndex < normalizedBooks.length ? selectedIndex : 0;
  const displayedIndex =
    previewIndex !== null && previewIndex < normalizedBooks.length
      ? previewIndex
      : safeIndex;
  const activeBook = normalizedBooks[safeIndex] || null;

  const compositeBookIds = useMemo(
    () => normalizedBooks.map(book => `${book.libraryId}:${book.id}`),
    [normalizedBooks],
  );

  const openBookDetails = (book: TrackedBookItem) => {
    const sameLibraryBookIds = normalizedBooks
      .filter(b => b.libraryId === book.libraryId)
      .map(b => b.id);
    void navigate(
      `/library/${encodeURIComponent(book.libraryId)}/book/${encodeURIComponent(book.id)}`,
      {
        state: {
          from: fromPath,
          ...(sameLibraryBookIds.length > 0
            ? {bookList: sameLibraryBookIds}
            : {}),
        },
      },
    );
  };

  const renderBookSlide = (book: TrackedBookItem) => {
    const provenanceLabel = showLibraryProvenance
      ? book.ownershipStatus === 'unowned' || book.isVirtual
        ? 'Un-owned Volume'
        : `In ${toTitleCase(book.libraryName)}`
      : null;

    return (
      <div
        onMouseEnter={() => preloadRouteChunk('bookDetails')}
        onTouchStart={() => preloadRouteChunk('bookDetails')}
        className="flex flex-col sm:flex-row gap-5 items-center sm:items-start my-auto py-0.5"
      >
        {/* Framed 2:3 Cover */}
        <div
          onClick={() => openBookDetails(book)}
          className="w-28 sm:w-32 aspect-[2/3] shrink-0 rounded-lg book-cover-shadow border border-outline-variant/60 overflow-hidden relative cursor-pointer group"
        >
          <ArchivalCoverImage
            src={book.coverUrl}
            alt={book.title}
            author={book.author}
            variant="compact"
            draggable={false}
            showSpineHighlight={true}
            className="w-full h-full"
            imgClassName="group-hover:scale-[1.03] transition-transform duration-300 select-none"
          />
        </div>

        {/* Book Editorial Callout */}
        <div className="flex-1 min-w-0 text-center sm:text-left">
          {(provenanceLabel || book.primaryGenre) && (
            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-xs text-on-surface-variant mb-1.5">
              {provenanceLabel && (
                <span className="font-sans font-medium">{provenanceLabel}</span>
              )}
              {provenanceLabel && book.primaryGenre && (
                <span aria-hidden="true">·</span>
              )}
              {book.primaryGenre && <span>{book.primaryGenre}</span>}
            </div>
          )}

          <h3
            onClick={() => openBookDetails(book)}
            className="font-serif text-xl sm:text-2xl font-semibold tracking-tight text-primary hover:underline cursor-pointer line-clamp-2 leading-snug"
          >
            {toTitleCase(book.title)}
          </h3>
          <p className="font-sans text-sm text-on-surface-variant mt-1">
            {toTitleCase(book.author || 'Unknown Author')}
          </p>

          {book.synopsis && (
            <p className="font-sans text-xs text-on-surface-variant/90 line-clamp-2 mt-3 leading-relaxed max-w-xl">
              {book.synopsis}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2.5 mt-4">
            <Button
              type="button"
              size="sm"
              onFocus={() => preloadRouteChunk('bookDetails')}
              onClick={() => openBookDetails(book)}
              className="h-9 px-4 rounded-lg font-sans text-xs font-semibold"
            >
              Book Details & Notes
            </Button>
            {onStatusChange && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!isOnline}
                title={!isOnline ? 'Unavailable while offline' : undefined}
                onClick={() =>
                  void onStatusChange(book.libraryId, book.id, 'finished')
                }
                className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-primary" />
                <span>Mark Finished</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="currently-reading-card"
      className="bento-card p-5 sm:p-6 flex flex-col justify-between h-full min-w-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-2">
          <span className="metadata-eyebrow">Currently Reading</span>
          {normalizedBooks.length > 0 && (
            <Badge variant="status-reading" size="sm">
              {normalizedBooks.length} Active
            </Badge>
          )}
        </div>

        {normalizedBooks.length > 1 && (
          <div className="flex items-center gap-3">
            {/* Compact Prev/Next Stepper (1 / N) */}
            <div
              data-testid="currently-reading-stepper"
              className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/60 bg-surface-container-low px-1 py-0.5"
            >
              <button
                type="button"
                data-testid="currently-reading-prev"
                aria-label="Previous currently reading book"
                disabled={displayedIndex <= 0}
                onClick={() => deckRef.current?.slidePrev()}
                className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
              <span
                data-testid="currently-reading-step-indicator"
                className="font-mono text-[11px] font-semibold text-on-surface tabular-nums px-1 select-none"
              >
                {displayedIndex + 1} / {normalizedBooks.length}
              </span>
              <button
                type="button"
                data-testid="currently-reading-next"
                aria-label="Next currently reading book"
                disabled={displayedIndex >= normalizedBooks.length - 1}
                onClick={() => deckRef.current?.slideNext()}
                className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            {onOpenReadingLists && (
              <button
                type="button"
                data-testid="currently-reading-view-all"
                onClick={() => onOpenReadingLists('reading')}
                className="text-xs font-sans font-semibold text-primary hover:underline flex items-center gap-1 cursor-pointer"
              >
                <span>View All ({normalizedBooks.length})</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {!activeBook ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-8 px-4">
          <NightstandBookIllustration className="mb-3" />
          <h3 className="font-serif text-lg font-semibold text-on-surface mb-1">
            Nothing Open on the Nightstand
          </h3>
          <p className="font-sans text-xs sm:text-sm text-on-surface-variant max-w-md mb-5 leading-relaxed">
            Track what you&apos;re reading right now to keep it front and
            center.
          </p>
          {onTrackBook && (
            <Button
              type="button"
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={onTrackBook}
              className="gap-2 rounded-lg font-sans font-semibold h-9 px-4 text-xs disabled:opacity-50"
            >
              <Plus className="w-4 h-4" />
              <span>Start Reading a Book</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-col justify-between flex-1 gap-5">
          {normalizedBooks.length > 1 ? (
            <BookSwipeDeck
              ref={deckRef}
              bookIds={compositeBookIds}
              activeIndex={safeIndex}
              autoHeight
              enablePointerDrag
              onIndexPreview={nextIdx => setPreviewIndex(nextIdx)}
              onIndexCommit={committedIdx => {
                setPreviewIndex(null);
                setSelectedIndex(committedIdx);
              }}
              renderSlide={({index}) => {
                const slideBook = normalizedBooks[index] || activeBook;
                return renderBookSlide(slideBook);
              }}
            />
          ) : (
            renderBookSlide(activeBook)
          )}
        </div>
      )}
    </div>
  );
}
