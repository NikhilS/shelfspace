import React from 'react';
import {RefreshCw, X} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';

interface ForceResyncModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  bookCount: number;
}

export function ForceResyncModal({
  isOpen,
  onClose,
  onConfirm,
  bookCount,
}: ForceResyncModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="w-full max-w-md bg-surface p-8 rounded-[32px] shadow-xl border border-outline-variant/30 gap-0"
      >
        <div className="flex items-center justify-between mb-8">
          <DialogTitle className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface tracking-tight">
            <div className="w-10 h-10 bg-error-container rounded-full flex items-center justify-center text-error border border-error-container/50">
              <RefreshCw size={20} />
            </div>
            Force Resync
          </DialogTitle>
          <button
            onClick={onClose}
            className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-8">
          <p className="text-on-surface-variant text-sm leading-relaxed text-left">
            This will ignore any existing metadata and try to refetch +
            repopulate everything from Google Books and OpenLibrary for all{' '}
            <strong className="text-on-surface">{bookCount}</strong> books. This
            includes downloading new covers and genres, which might overwrite
            manual edits.
          </p>
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            Yes, Force Resync
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
