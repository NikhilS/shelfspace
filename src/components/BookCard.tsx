import React from 'react';
import {BookDetails} from '../services/bookApi';
import {Book as BookIcon} from 'lucide-react';
import {toTitleCase} from '../lib/utils';
import {FirestoreDate} from '../types';

interface BookCardProps {
  key?: React.Key;
  book: BookDetails & {
    id: string;
    addedBy: string | null;
    addedAt: FirestoreDate;
  };
  onClick?: () => void;
  canEdit: boolean;
  isSelected?: boolean;
  isSelectMode?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
}

export default function BookCard({
  book,
  onClick,
  isSelected,
  isSelectMode,
  onSelect,
}: BookCardProps) {
  return (
    <div
      onClick={onClick}
      className={'group cursor-pointer flex flex-col h-full'}
    >
      {/* Book Cover */}
      <div
        className={`relative aspect-[2/3] mb-4 bg-surface-container rounded-lg shadow-elevation-2 overflow-hidden transform transition-transform duration-300 group-hover:-translate-y-1 ${isSelected ? 'ring-2 ring-primary ring-offset-2 ring-offset-background' : ''}`}
      >
        {onSelect && (
          <div
            className={`absolute top-2 left-2 z-20 flex items-center justify-center transition-opacity ${isSelected || isSelectMode ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            onClick={e => {
              e.stopPropagation();
              onSelect(e);
            }}
          >
            <div
              className={`w-5 h-5 rounded-sm border ${isSelected ? 'bg-primary border-primary' : 'bg-surface/80 border-outline backdrop-blur-sm'} flex items-center justify-center shadow-sm`}
            >
              {isSelected && (
                <span className="text-on-primary text-xs leading-none">✓</span>
              )}
            </div>
          </div>
        )}
        {book.coverUrl ? (
          <img
            src={book.coverUrl}
            alt={book.title}
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 p-4 pl-6 flex flex-col justify-between text-on-surface bg-surface-variant border-l-4 border-primary/20">
            <div className="space-y-2 max-h-[80%] overflow-hidden">
              <div className="w-8 h-[2px] bg-primary/30 mb-2" />
              <h3 className="font-serif font-bold text-sm sm:text-base leading-snug tracking-tight text-primary">
                {toTitleCase(book.title)}
              </h3>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant font-medium tracking-wide uppercase mt-1">
                {toTitleCase(book.author)}
              </p>
            </div>
            <div className="flex justify-between items-end">
              <BookIcon
                size={16}
                className="text-primary/40"
                strokeWidth={1.5}
              />
            </div>
          </div>
        )}
      </div>

      {/* Book Metadata */}
      <div className="mt-auto pl-1 pr-1">
        <h3 className="font-headline-md text-base leading-tight text-on-surface line-clamp-1 tracking-tight">
          {toTitleCase(book.title)}
        </h3>
        <p className="font-body-md text-sm text-on-surface-variant line-clamp-1 mt-1">
          {toTitleCase(book.author)}
        </p>
      </div>
    </div>
  );
}
