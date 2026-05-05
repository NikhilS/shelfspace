import React from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {X} from 'lucide-react';
import {Button} from '@/components/ui/button';

interface BulkActionsBarProps {
  selectedCount: number;
  onClear: () => void;
  onStatusChange: (status: string) => void;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  onClear,
  onStatusChange,
}) => {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{y: 100, opacity: 0}}
          animate={{y: 0, opacity: 1}}
          exit={{y: 100, opacity: 0}}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-surface border border-outline-variant/30 px-6 py-4 rounded-full shadow-[0_10px_30px_rgba(0,0,0,0.1)] flex items-center gap-6 z-[60] architectural-shadow"
        >
          <span className="font-headline-md text-sm text-on-surface whitespace-nowrap">
            {selectedCount} selected
          </span>
          <div className="flex items-center gap-3 border-l border-outline-variant/30 pl-6">
            <span className="text-sm font-label-caps text-on-surface-variant uppercase tracking-wider hidden sm:inline">
              Set Status
            </span>
            <select
              className="bg-surface-container-low border border-outline-variant/50 rounded-lg px-4 py-2 text-sm font-body-md text-on-surface outline-none cursor-pointer hover:bg-surface-container transition-colors shadow-sm min-w-[140px]"
              onChange={e => onStatusChange(e.target.value)}
              value=""
            >
              <option value="" disabled>
                Choose...
              </option>
              <option value="reading">Currently Reading</option>
              <option value="finished">Finished</option>
              <option value="abandoned">Abandoned</option>
              <option value="unset">Remove Status</option>
            </select>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClear}
            className="ml-2 rounded-full"
            title="Clear selection"
          >
            <X size={18} strokeWidth={2} />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
