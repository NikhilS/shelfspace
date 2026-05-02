import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {Loader2} from 'lucide-react';
import {handleFirestoreError, OperationType} from '../../firebase';

interface CreateLibraryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  isSubmitting: boolean;
  onCreate: (name: string) => Promise<void>;
}

export function CreateLibraryDialog({
  isOpen,
  onClose,
  isSubmitting,
  onCreate,
}: CreateLibraryDialogProps) {
  const [name, setName] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isSubmitting) return;

    const trimmedName = name.trim();
    try {
      await onCreate(trimmedName);
      setName('');
      onClose();
    } catch (error) {
      setName(trimmedName);
      handleFirestoreError(error, OperationType.CREATE, 'libraries');
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.form
          initial={{opacity: 0, height: 0, overflow: 'hidden'}}
          animate={{opacity: 1, height: 'auto', overflow: 'visible'}}
          exit={{opacity: 0, height: 0, overflow: 'hidden'}}
          transition={{duration: 0.3, ease: 'easeInOut'}}
          onSubmit={handleSubmit}
          className="bg-surface-container p-6 sm:p-8 rounded-lg shadow-sm border border-outline-variant/30 mb-12 relative overflow-hidden"
        >
          <div className="flex flex-col sm:flex-row gap-4 items-stretch sm:items-center relative z-10 w-full">
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Library Name (e.g. Private Study)"
              className="flex-1 bg-surface border border-outline-variant/70 rounded-md px-6 py-4 focus:outline-none focus:ring-0 focus:border-primary transition-all text-base sm:text-lg placeholder:text-on-surface-variant/70"
              autoFocus
              disabled={isSubmitting}
            />
            <div className="flex gap-3 sm:gap-4 flex-shrink-0">
              <button
                type="button"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 sm:flex-none justify-center text-primary px-6 py-4 rounded-md font-body-md hover:bg-surface-variant border border-outline-variant/50 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 sm:flex-none justify-center bg-primary text-on-primary px-8 py-4 rounded-md font-body-md hover:bg-primary/90 transition-all flex items-center gap-2 disabled:opacity-50 min-w-[140px] architectural-shadow"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Abstracting
                  </>
                ) : (
                  'Create Collection'
                )}
              </button>
            </div>
          </div>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
