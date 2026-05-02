import React from 'react';
import {motion, AnimatePresence} from 'motion/react';

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
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{opacity: 0}}
          animate={{opacity: 1}}
          exit={{opacity: 0}}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        >
          <motion.div
            initial={{opacity: 0, scale: 0.95}}
            animate={{opacity: 1, scale: 1}}
            exit={{opacity: 0, scale: 0.95}}
            className="bg-surface shadow-[0px_10px_40px_rgba(0,0,0,0.1)] rounded-[32px] w-full max-w-md overflow-hidden border border-outline-variant/30"
          >
            <div className="p-8">
              <h3 className="text-2xl font-serif font-medium text-on-surface mb-3 tracking-tight">
                Force Resync All Metadata?
              </h3>
              <p className="text-on-surface-variant mb-8 text-sm leading-relaxed">
                This will ignore any existing metadata and try to refetch +
                repopulate everything from Google Books and OpenLibrary for all{' '}
                <strong>{bookCount}</strong> books. This includes downloading
                new covers and genres, which might overwrite manual edits.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-5 py-3 text-on-surface font-medium hover:bg-surface-container border border-outline-variant/30 rounded-xl transition-colors text-sm"
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
        </motion.div>
      )}
    </AnimatePresence>
  );
}
