import React, {memo, useState} from 'react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {Edit2, Trash2, X, Loader2} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {Book} from './useBook';

interface BookHeaderProps {
  book: Book;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => Promise<void>;
}

export const BookHeader = memo(
  ({book, canEdit, onEdit, onDelete}: BookHeaderProps) => {
    const [isDeleting, setIsDeleting] = useState(false);
    const [isDeletingInProgress, setIsDeletingInProgress] = useState(false);

    const handleDeleteBook = async () => {
      setIsDeletingInProgress(true);
      await onDelete();
      // Assuming onDelete handles throwing or succeeding, we clean up state
      // But since onDelete navigates away, the component might unmount.
      setIsDeletingInProgress(false);
      setIsDeleting(false);
    };

    return (
      <>
        <div>
          <div className="flex flex-wrap gap-2 mb-4">
            {book.genres && book.genres.length > 0 && book.genres[0] && (
              <span className="bg-tertiary-container/10 text-tertiary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                {book.genres[0].toUpperCase()}
              </span>
            )}
            {book.series && book.series !== 'Standalone' && (
              <span className="bg-secondary-container/10 text-secondary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                {String(book.series).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="font-headline-xl text-headline-xl text-primary mb-2">
                {toTitleCase(book.title)}
              </h1>
              <h2 className="font-headline-md text-headline-md text-secondary mb-6">
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
                  <Edit2 size={16} /> Edit
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => setIsDeleting(true)}
                  className="flex items-center justify-center gap-2 w-full sm:w-auto"
                >
                  <Trash2 size={16} /> Delete
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

        <Dialog
          open={isDeleting}
          onOpenChange={open => !open && setIsDeleting(false)}
        >
          <DialogContent
            showCloseButton={false}
            className="bg-surface rounded-[32px] p-8 max-w-md w-full shadow-[0px_10px_40px_rgba(0,0,0,0.1)] border border-surface-variant gap-0"
          >
            <div className="flex items-center justify-between mb-8">
              <DialogTitle className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface tracking-tight">
                <div className="w-10 h-10 bg-error-container rounded-full flex items-center justify-center text-error border border-error-container/50">
                  <Trash2 size={20} />
                </div>
                Delete Book
              </DialogTitle>
              <button
                onClick={() => setIsDeleting(false)}
                className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="mb-8">
              <p className="text-on-surface-variant text-sm leading-relaxed text-left">
                Are you sure you want to delete this book? This action cannot be
                undone.
              </p>
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <Button
                variant="outline"
                onClick={() => setIsDeleting(false)}
                disabled={isDeletingInProgress}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleDeleteBook}
                disabled={isDeletingInProgress}
              >
                {isDeletingInProgress ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  'Delete'
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  },
);
