import React, {memo} from 'react';
import {useNavigate} from 'react-router-dom';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {Edit2} from 'lucide-react';
import {Book} from './useBook';

interface BookHeaderProps {
  book: Book;
  canEdit: boolean;
  onEdit: () => void;
  libraryId?: string;
}

export const BookHeader = memo(
  ({book, canEdit, onEdit, libraryId}: BookHeaderProps) => {
    const navigate = useNavigate();

    const isVirtualShelf = Boolean(libraryId?.startsWith('virtual_'));

    const handleGenreClick = (genre: string, subgenre?: string) => {
      if (!libraryId) return;
      if (isVirtualShelf) {
        void navigate('/');
        return;
      }
      const params = new URLSearchParams();
      if (genre) params.set('genre', genre);
      if (subgenre) params.set('subgenre', subgenre);
      params.set('filters', 'true');
      void navigate(`/library/${libraryId}/collection?${params.toString()}`);
    };

    return (
      <header className="border-b border-outline-variant/60 pb-6">
        {/* Curatorial Taxonomy Kicker */}
        <div className="flex flex-wrap items-center gap-2 mb-3.5 swiper-no-swiping">
          {book.primaryGenre && (
            <Badge
              variant="genre"
              onClick={() => handleGenreClick(book.primaryGenre!)}
              className="cursor-pointer swiper-no-swiping uppercase"
              title={
                isVirtualShelf
                  ? 'Return to Reading Room'
                  : `Filter library by ${book.primaryGenre}`
              }
            >
              {book.primaryGenre}
            </Badge>
          )}
          {book.subgenres?.map((sg, idx) => (
            <Badge
              key={idx}
              variant="subgenre"
              onClick={() => handleGenreClick(book.primaryGenre || '', sg)}
              className="cursor-pointer swiper-no-swiping"
              title={
                isVirtualShelf
                  ? 'Return to Reading Room'
                  : `Filter library by ${sg}`
              }
            >
              {sg}
            </Badge>
          ))}
          {book.series && book.series !== 'Standalone' && (
            <Badge
              variant="secondary"
              className="font-label-caps text-label-caps uppercase"
            >
              {String(book.series)}
            </Badge>
          )}
        </div>

        {/* Magazine Display Title & Author Byline */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="min-w-0 w-full break-words">
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-[42px] font-semibold tracking-tight text-primary leading-[1.15] mb-2">
              {toTitleCase(book.title)}
            </h1>
            <h2 className="font-sans text-lg sm:text-xl font-medium text-on-surface-variant line-clamp-2">
              by{' '}
              <span className="text-on-surface font-semibold">
                {toTitleCase(book.author)}
              </span>
            </h2>
          </div>
          {canEdit && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
              <Button
                variant="outline"
                size="sm"
                onClick={onEdit}
                className="flex items-center justify-center gap-2 w-full sm:w-auto h-9 px-3.5"
              >
                <Edit2 size={14} /> Edit Details
              </Button>
            </div>
          )}
        </div>

        {/* Compact Archival Metadata Strip (Mobile & Quick-Glance) */}
        <div className="flex flex-wrap items-center gap-4 sm:gap-6 text-on-surface-variant text-xs font-sans mt-5 pt-4 border-t border-outline-variant/40">
          <div className="flex items-center gap-1.5">
            <span className="metadata-eyebrow">Published:</span>
            <span className="font-mono tabular-nums font-medium text-on-surface">
              {book.publishedDate || 'Unknown'}
            </span>
          </div>
          <span aria-hidden="true" className="text-outline/50 hidden sm:inline">
            ·
          </span>
          <div className="flex items-center gap-1.5">
            <span className="metadata-eyebrow">Format:</span>
            <span className="capitalize font-medium text-on-surface">
              {book.format || 'Physical'}
            </span>
          </div>
          <span aria-hidden="true" className="text-outline/50 hidden sm:inline">
            ·
          </span>
          <div className="flex items-center gap-1.5">
            <span className="metadata-eyebrow">ISBN:</span>
            <span className="font-mono tabular-nums font-medium text-on-surface">
              {book.isbn || 'Unknown'}
            </span>
          </div>
        </div>
      </header>
    );
  },
);
