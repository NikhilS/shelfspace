import React from 'react';
import {motion} from 'motion/react';

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
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <motion.div
        initial={{opacity: 0, scale: 0.95}}
        animate={{opacity: 1, scale: 1}}
        className="bg-surface-container shadow-xl rounded-2xl w-full max-w-md overflow-hidden border border-border"
      >
        <div className="p-6">
          <h3 className="text-xl font-bold text-on-surface mb-2">
            Force Resync All Metadata?
          </h3>
          <p className="text-muted mb-8 text-sm leading-relaxed">
            This will ignore any existing metadata and try to refetch +
            repopulate everything from Google Books and OpenLibrary for all{' '}
            <strong>{bookCount}</strong> books. This includes downloading new
            covers and genres, which might overwrite manual edits.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={onClose}
              className="px-5 py-3 text-ink font-medium hover:bg-paper border border-border rounded-xl transition-colors text-sm"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className="px-5 py-3 bg-error text-on-error hover:bg-error/90 font-bold rounded-xl transition-colors text-sm shadow-sm"
            >
              Yes, Force Resync
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
