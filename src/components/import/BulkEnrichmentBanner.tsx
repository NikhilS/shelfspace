import React from 'react';
import {Sparkles, Square} from 'lucide-react';
import {motion} from 'motion/react';

interface BulkEnrichmentBannerProps {
  isBackfilling: boolean;
  completed: number;
  total: number;
  title: string;
  description: string;
  colorTheme?: 'teal' | 'indigo';
  className?: string;
  id?: string;
  inFlightCount?: number;
  failed?: number;
  onCancel?: () => void;
  cancelLabel?: string;
}

export function BulkEnrichmentBanner({
  isBackfilling,
  completed,
  total,
  title,
  description,
  colorTheme = 'teal',
  className = '',
  id = 'sync-progress-banner',
  inFlightCount,
  failed = 0,
  onCancel,
  cancelLabel = 'Stop',
}: BulkEnrichmentBannerProps) {
  if (!isBackfilling && completed === 0 && failed === 0) {
    return null;
  }
  if (!isBackfilling && completed + failed >= total) {
    return null;
  }

  const percentage =
    total > 0 ? (Math.min(completed + failed, total) / total) * 100 : 0;

  const progressBarClass = colorTheme === 'teal' ? 'bg-tertiary' : 'bg-primary';

  return (
    <motion.div
      initial={{opacity: 0, y: -6}}
      animate={{opacity: 1, y: 0}}
      exit={{opacity: 0, y: -6}}
      transition={{duration: 0.22, ease: 'easeOut'}}
      className={`bento-card bg-surface-container-low px-4 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 ${className}`}
      id={id}
    >
      <div className="flex items-center gap-3 min-w-0 w-full sm:w-auto">
        <div className="w-8 h-8 rounded-lg bg-tertiary/12 border border-tertiary/25 flex items-center justify-center shrink-0">
          <Sparkles className="animate-pulse w-4 h-4 text-tertiary" />
        </div>
        <div className="min-w-0">
          <p className="font-serif text-sm font-semibold leading-snug text-on-surface">
            {title}
          </p>
          <p className="text-xs font-mono tabular-nums mt-0.5 text-on-surface-variant">
            {description} {completed} of {total} completed
            {failed > 0 && (
              <span className="ml-2 font-semibold text-error">
                ({failed} failed)
              </span>
            )}
            {inFlightCount !== undefined && inFlightCount > 0 && isBackfilling
              ? ` (${inFlightCount} active)`
              : ''}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-3 w-full sm:w-auto shrink-0 justify-between sm:justify-end">
        <div className="w-full sm:w-36 rounded-full h-1.5 overflow-hidden shrink-0 bg-surface-container-highest">
          <div
            className={`h-1.5 rounded-full transition-all duration-300 ${progressBarClass}`}
            style={{width: `${percentage}%`}}
          />
        </div>
        {onCancel && isBackfilling && (
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1 text-xs font-sans font-semibold px-2.5 py-1 rounded-md border border-error/30 bg-error/10 hover:bg-error/15 text-error transition-colors cursor-pointer select-none"
            title="Stop ongoing enrichment"
          >
            <Square className="w-2.5 h-2.5 fill-current" />
            <span>{cancelLabel}</span>
          </button>
        )}
      </div>
    </motion.div>
  );
}
