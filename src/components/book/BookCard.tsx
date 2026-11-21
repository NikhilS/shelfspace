import React, {memo, useCallback} from 'react';
import {toTitleCase} from '../../lib/utils';
import {Book, FirestoreDate} from '../../types';
import {Button} from '@/components/ui/button';
import {ArchivalCoverImage} from './ArchivalCoverImage';
import {SharedCoverFrame} from './SharedCoverFrame';
import {preloadRouteChunk} from '../../lib/routePreload';

export interface BookCardProps {
  key?: React.Key;
  book: Book & {
    addedAt: FirestoreDate;
    synopsis?: string;
  };
  fallbackLibraryId?: string;
  onClick?: () => void;
  onNavigateBook?: (bookId: string) => void;
  canEdit: boolean;
  isSelected?: boolean;
  isSelectMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  onSelectBook?: (e: React.MouseEvent, bookId: string) => void;
}

function BookCardComponent({
  book,
  fallbackLibraryId,
  onClick,
  onNavigateBook,
  isSelected,
  isSelectMode,
  onSelect,
  onSelectBook,
}: BookCardProps) {
  const pubYear =
    book.publishedDate && book.publishedDate.length >= 4
      ? book.publishedDate.slice(0, 4)
      : null;

  const hasSelectHandler = Boolean(onSelect || onSelectBook);
  const resolvedLibraryId = book.libraryId || fallbackLibraryId;

  const handlePrewarm = useCallback(() => {
    preloadRouteChunk('bookDetails');
  }, []);

  const handleCardClick = () => {
    if (onNavigateBook) {
      onNavigateBook(book.id);
    } else if (onClick) {
      onClick();
    }
  };

  return (
    <article
      onClick={handleCardClick}
      onMouseEnter={handlePrewarm}
      onFocus={handlePrewarm}
      onTouchStart={handlePrewarm}
      className={`group cursor-pointer flex flex-col h-full bento-card-interactive p-3 sm:p-3.5 ${
        isSelected
          ? 'ring-2 ring-primary border-primary bg-surface-container-low/60'
          : ''
      }`}
    >
      {/* Unobstructed 2:3 Book Cover Showcase */}
      <SharedCoverFrame
        surface="library-grid"
        libraryId={resolvedLibraryId}
        bookId={book.id}
        className="relative aspect-[2/3] mb-3.5 bg-surface-container rounded-lg book-cover-shadow overflow-hidden border border-outline-variant/55"
      >
        {hasSelectHandler && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={isSelected ? 'Deselect book' : 'Select book'}
            className={`absolute top-1.5 left-1.5 z-20 min-w-[44px] min-h-[44px] w-11 h-11 p-0 flex items-center justify-center rounded-lg hover:bg-transparent focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-opacity ${
              isSelected || isSelectMode
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            }`}
            onClick={e => {
              e.stopPropagation();
              if (onSelectBook) {
                onSelectBook(e, book.id);
              } else if (onSelect) {
                onSelect(e);
              }
            }}
          >
            <div
              className={`w-6 h-6 rounded-md border flex items-center justify-center shadow-xs transition-all duration-150 active:scale-95 ${
                isSelected
                  ? 'bg-primary border-primary text-on-primary'
                  : 'bg-surface/95 border-outline/80 backdrop-blur-md hover:border-primary'
              }`}
            >
              {isSelected && (
                <span className="text-on-primary text-xs font-bold leading-none select-none">
                  ✓
                </span>
              )}
            </div>
          </Button>
        )}

        <ArchivalCoverImage
          src={book.coverUrl}
          alt={book.title}
          author={book.author}
          publishedYear={pubYear}
          variant="card"
          className="w-full h-full"
          imgClassName="group-hover:scale-[1.02] transition-transform duration-300"
          fallbackClassName="absolute inset-0"
        />
      </SharedCoverFrame>

      {/* Bento Literary Metadata & Synopsis Preview (Unboxed Metadata Discipline) */}
      <div className="flex flex-col flex-1 justify-between min-w-0 pt-0.5">
        <div>
          <h3 className="font-serif font-semibold text-base leading-snug text-on-surface group-hover:text-primary transition-colors line-clamp-1 tracking-tight">
            {toTitleCase(book.title)}
          </h3>
          <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mt-0.5 min-w-0">
            <span className="font-sans font-medium truncate">
              {toTitleCase(book.author)}
            </span>
            {pubYear && (
              <>
                <span aria-hidden="true" className="text-outline/50 shrink-0">
                  ·
                </span>
                <span className="font-mono tabular-nums text-[11px] text-on-surface-variant/85 shrink-0">
                  {pubYear}
                </span>
              </>
            )}
            {book.primaryGenre && (
              <>
                <span aria-hidden="true" className="text-outline/50 shrink-0">
                  ·
                </span>
                <span className="font-sans text-[11px] text-on-surface-variant/85 truncate">
                  {book.primaryGenre}
                </span>
              </>
            )}
          </div>

          {book.synopsis && (
            <p className="font-sans text-xs text-on-surface-variant/85 line-clamp-2 mt-2 leading-relaxed">
              {book.synopsis}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}

function areBookCardPropsEqual(
  prev: BookCardProps,
  next: BookCardProps,
): boolean {
  return (
    prev.book === next.book &&
    prev.fallbackLibraryId === next.fallbackLibraryId &&
    prev.canEdit === next.canEdit &&
    prev.isSelected === next.isSelected &&
    prev.isSelectMode === next.isSelectMode &&
    prev.onSelectBook === next.onSelectBook &&
    prev.onNavigateBook === next.onNavigateBook
  );
}

export const BookCard = memo(BookCardComponent, areBookCardPropsEqual);
