import React from 'react';
import {BookOpen, BookmarkPlus, Check} from 'lucide-react';

interface ReadingScopeToggleProps {
  readAndReadingCount: number;
  wantToReadCount: number;
  includeWantToRead: boolean;
  onToggleWantToRead: (include: boolean) => void;
  className?: string;
}

export const ReadingScopeToggle: React.FC<ReadingScopeToggleProps> = ({
  readAndReadingCount,
  wantToReadCount,
  includeWantToRead,
  onToggleWantToRead,
  className = '',
}) => {
  return (
    <div
      className={`inline-flex flex-wrap items-center gap-1.5 p-1 rounded-xl bg-surface-container border border-outline-variant/60 text-xs font-sans ${className}`}
      role="group"
      aria-label="Reading Room Visualization Scope"
    >
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface text-on-surface font-semibold shadow-2xs border border-outline-variant/40">
        <BookOpen className="w-3.5 h-3.5 text-primary shrink-0" />
        <span>Read &amp; Reading</span>
        <span className="font-mono tabular-nums text-[11px] text-on-surface-variant">
          ({readAndReadingCount})
        </span>
      </span>

      <button
        type="button"
        onClick={() => onToggleWantToRead(!includeWantToRead)}
        aria-pressed={includeWantToRead}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium transition-all cursor-pointer ${
          includeWantToRead
            ? 'bg-primary text-on-primary font-semibold shadow-2xs'
            : 'text-on-surface-variant hover:text-on-surface hover:bg-surface/60'
        }`}
      >
        {includeWantToRead ? (
          <Check className="w-3.5 h-3.5 shrink-0" />
        ) : (
          <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
        )}
        <span>Include Want to Read</span>
        <span
          className={`font-mono tabular-nums text-[11px] ${
            includeWantToRead ? 'text-on-primary/90' : 'text-on-surface-variant'
          }`}
        >
          (+{wantToReadCount})
        </span>
      </button>
    </div>
  );
};
