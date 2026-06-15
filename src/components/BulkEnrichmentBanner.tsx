import React from 'react';
import {Sparkles} from 'lucide-react';
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
}: BulkEnrichmentBannerProps) {
  if (!isBackfilling || total === 0) return null;

  const percentage = total > 0 ? (completed / total) * 100 : 0;

  const themeClasses = {
    teal: {
      container:
        'bg-teal-50 dark:bg-teal-950/20 border-teal-500 dark:border-teal-900/50',
      icon: 'text-teal-600 dark:text-teal-400',
      title: 'text-teal-900 dark:text-teal-200',
      subtitle: 'text-teal-700 dark:text-teal-300',
      progressBg: 'bg-teal-200/50 dark:bg-teal-900/40',
      progressBar: 'bg-teal-600 dark:bg-teal-400',
    },
    indigo: {
      container:
        'bg-indigo-50 dark:bg-indigo-950/20 border-indigo-500 dark:border-indigo-900/50',
      icon: 'text-indigo-600 dark:text-indigo-400',
      title: 'text-indigo-900 dark:text-indigo-200',
      subtitle: 'text-indigo-700 dark:text-indigo-300',
      progressBg: 'bg-indigo-200/50 dark:bg-indigo-900/40',
      progressBar: 'bg-indigo-600 dark:bg-indigo-400',
    },
  };

  const selectedTheme = themeClasses[colorTheme];

  return (
    <motion.div
      initial={{opacity: 0, y: -8}}
      animate={{opacity: 1, y: 0}}
      exit={{opacity: 0, y: -8}}
      transition={{duration: 0.25, ease: 'easeOut'}}
      className={`border-l-4 rounded-lg p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 shadow-sm transition-colors ${selectedTheme.container} ${className}`}
      id={id}
    >
      <div className="flex items-center gap-2.5 min-w-0 w-full sm:w-auto">
        <Sparkles
          className={`animate-pulse w-5 h-5 flex-shrink-0 ${selectedTheme.icon}`}
        />
        <div className="min-w-0">
          <p
            className={`text-sm font-medium leading-none ${selectedTheme.title}`}
          >
            {title}
          </p>
          <p className={`text-xs font-mono mt-1 ${selectedTheme.subtitle}`}>
            {description} {completed} of {total} completed
            {inFlightCount !== undefined && inFlightCount > 0
              ? ` (${inFlightCount} active)`
              : ''}
          </p>
        </div>
      </div>
      <div
        className={`w-full sm:w-36 rounded-full h-1.5 overflow-hidden shrink-0 sm:ml-4 ${selectedTheme.progressBg}`}
      >
        <div
          className={`h-1.5 rounded-full transition-all duration-300 ${selectedTheme.progressBar}`}
          style={{width: `${percentage}%`}}
        />
      </div>
    </motion.div>
  );
}
