import React from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {X} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
          className="fixed bottom-8 left-1/2 -translate-x-1/2 bg-surface border border-outline-variant/30 px-6 py-4 rounded-full shadow-elevation-3 flex items-center gap-6 z-[60] architectural-shadow"
        >
          <div className="flex items-center gap-2">
            <Badge variant="default" size="default" className="font-bold">
              {selectedCount}
            </Badge>
            <span className="font-headline-md text-sm text-on-surface whitespace-nowrap">
              selected
            </span>
          </div>
          <div className="flex items-center gap-3 border-l border-outline-variant/30 pl-6">
            <span className="text-sm font-label-caps text-on-surface-variant uppercase tracking-wider hidden sm:inline">
              Set Status
            </span>
            <Select onValueChange={onStatusChange} value="">
              <SelectTrigger className="bg-surface-container-low border-outline-variant/50 rounded-lg px-4 py-2 text-sm font-body-md text-on-surface hover:bg-surface-container transition-colors shadow-sm min-w-[140px] h-9">
                <SelectValue placeholder="Choose..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="reading">Currently Reading</SelectItem>
                <SelectItem value="finished">Finished</SelectItem>
                <SelectItem value="abandoned">Abandoned</SelectItem>
                <SelectItem value="unset">Remove Status</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onClear}
            className="ml-2 rounded-full min-w-[44px] min-h-[44px]"
            title="Clear selection"
            aria-label="Clear selection"
          >
            <X size={18} strokeWidth={2} />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
