import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {Loader2} from 'lucide-react';
import {handleFirestoreError, OperationType} from '../../firebase';
import {Input} from '../../components/ui/input';
import {Button} from '../../components/ui/button';

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
            <Input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Give your library a name... (e.g. Cozy Corner or Dream Shelf)"
              className="flex-1 px-6 py-4 text-base sm:text-lg"
              autoFocus
              disabled={isSubmitting}
            />
            <div className="flex gap-3 sm:gap-4 flex-shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={isSubmitting}
                className="flex-1 sm:flex-none justify-center px-6 py-6 font-body-md"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="flex-1 sm:flex-none justify-center px-8 py-6 font-body-md min-w-[140px] shadow-[0_2px_12px_rgb(26,47,75,0.12)] hover:-translate-y-[1px] transition-transform gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={18} className="animate-spin" /> Creating...
                  </>
                ) : (
                  'Create Collection'
                )}
              </Button>
            </div>
          </div>
        </motion.form>
      )}
    </AnimatePresence>
  );
}
