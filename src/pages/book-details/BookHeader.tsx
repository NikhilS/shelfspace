import React, {memo} from 'react';
import {useNavigate} from 'react-router-dom';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
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

    const handleGenreClick = (genre: string, subgenre?: string) => {
      if (!libraryId) return;
      const params = new URLSearchParams();
      if (genre) params.set('genre', genre);
      if (subgenre) params.set('subgenre', subgenre);
      params.set('filters', 'true');
      void navigate(`/library/${libraryId}/collection?${params.toString()}`);
    };

    return (
      <>
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {book.primaryGenre && (
              <button
                type="button"
                onClick={() => handleGenreClick(book.primaryGenre!)}
                disabled={!libraryId}
                className="bg-tertiary-container/10 text-tertiary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem] hover:bg-tertiary-container/20 transition-colors cursor-pointer disabled:cursor-default"
                title={`Filter library by ${book.primaryGenre}`}
              >
                {book.primaryGenre.toUpperCase()}
              </button>
            )}
            {book.subgenres?.map((sg, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleGenreClick(book.primaryGenre || '', sg)}
                disabled={!libraryId}
                className="bg-secondary-container/10 text-secondary-container font-label-caps text-label-caps px-2.5 py-1 rounded-[0.125rem] hover:bg-secondary-container/20 transition-colors cursor-pointer disabled:cursor-default"
                title={`Filter library by ${sg}`}
              >
                {sg}
              </button>
            ))}
            {book.series && book.series !== 'Standalone' && (
              <span className="bg-secondary-container/10 text-secondary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                {String(book.series).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div className="min-w-0 w-full break-words">
              <h1 className="font-headline-xl text-headline-xl text-primary mb-2">
                {toTitleCase(book.title)}
              </h1>
              <h2 className="font-headline-md text-headline-md text-secondary mb-6 line-clamp-3">
                by {toTitleCase(book.author)}
              </h2>
            </div>
            {canEdit && (
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
                <Button
                  variant="outline"
                  onClick={onEdit}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                  <Edit2 size={16} /> Edit Details
                </Button>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-6 text-on-surface-variant text-sm font-body-md border-b border-surface-dim pb-6">
            <div className="flex flex-col">
              <span className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                Published
              </span>
              <span>{book.publishedDate || 'Unknown'}</span>
            </div>
            <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
            <div className="flex flex-col">
              <span className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                Format
              </span>
              <span className="capitalize">{book.format || 'Physical'}</span>
            </div>
            <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
            <div className="flex flex-col">
              <span className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                ISBN
              </span>
              <span>{book.isbn || 'Unknown'}</span>
            </div>
          </div>
        </div>
      </>
    );
  },
);
