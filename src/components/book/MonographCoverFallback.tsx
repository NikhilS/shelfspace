import React from 'react';
import {Book as BookIcon} from 'lucide-react';
import {cn, toTitleCase} from '@/lib/utils';

export interface MonographCoverFallbackProps {
  title: string;
  author?: string | null;
  publishedYear?: string | number | null;
  variant?: 'card' | 'compact' | 'micro';
  eyebrow?: string;
  showTitleText?: boolean;
  className?: string;
}

/**
 * MonographCoverFallback
 *
 * Tactile Warm Archival Studio clothbound monograph cover fallback.
 * - `card`: Full 2:3 typographic cover used in BookCard and BookContent.
 * - `compact`: Medium clothbound edition cover with spine crease, inset frame,
 *   monoline ex-libris emblem, and ruled typographic lines (avoids duplicating
 *   adjacent row titles in compact lists/inspectors).
 * - `micro`: Miniature clothbound monograph for dense table/list thumbnails.
 */
export function MonographCoverFallback({
  title,
  author,
  publishedYear,
  variant = 'card',
  eyebrow = 'Archival Ed.',
  showTitleText = variant === 'card',
  className,
}: MonographCoverFallbackProps) {
  const formattedTitle = toTitleCase(title || 'Untitled');
  const formattedAuthor = author ? toTitleCase(author) : null;
  const yearLabel =
    publishedYear !== undefined &&
    publishedYear !== null &&
    String(publishedYear).trim().length > 0
      ? String(publishedYear).slice(0, 4)
      : null;

  if (variant === 'micro') {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'relative overflow-hidden select-none flex flex-col justify-between p-1.5 text-left text-on-surface bg-gradient-to-b from-surface-container-low via-surface-container to-surface-container-high border border-outline-variant/50',
          className,
        )}
      >
        {/* Subtle physical book spine crease */}
        <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-r from-black/15 via-white/20 to-transparent pointer-events-none" />
        <div className="w-full h-px bg-primary/35 shrink-0" />
        {/* Miniature monoline ex-libris motif + ruled lines */}
        <svg
          viewBox="0 0 24 28"
          fill="none"
          className="w-full h-auto my-auto pl-0.5 text-on-surface"
          aria-hidden="true"
        >
          <path
            d="M12 4L14.5 8L12 12L9.5 8L12 4Z"
            className="fill-primary/20 stroke-primary"
            strokeWidth="1.3"
            strokeLinejoin="round"
          />
          <path
            d="M5 17H19M5 20.5H15M5 24H12"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
        <div className="w-full h-px bg-outline-variant/60 shrink-0" />
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'relative overflow-hidden select-none flex flex-col justify-between p-2.5 text-left text-on-surface bg-gradient-to-b from-surface-container-low via-surface-container to-surface-container-high border border-outline-variant/50 book-cover-shadow',
          className,
        )}
      >
        {/* Subtle physical book spine crease */}
        <div className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/15 via-white/20 to-transparent pointer-events-none" />
        <div className="flex items-center justify-between border-b border-outline-variant/50 pb-1 pl-0.5">
          <span className="font-mono text-[7px] uppercase tracking-widest text-on-surface-variant truncate">
            {yearLabel || 'Edition'}
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-primary/45 shrink-0" />
        </div>
        {showTitleText ? (
          <div className="my-auto py-1 pl-0.5 space-y-0.5 overflow-hidden">
            <p className="font-serif font-semibold text-[10px] sm:text-[11px] leading-tight tracking-tight text-primary line-clamp-3 break-words">
              {formattedTitle}
            </p>
            {formattedAuthor && (
              <p className="font-sans text-[8px] text-on-surface-variant font-medium tracking-wide uppercase truncate">
                {formattedAuthor}
              </p>
            )}
          </div>
        ) : (
          <svg
            viewBox="0 0 40 44"
            fill="none"
            className="w-full h-auto my-auto pl-0.5 text-on-surface"
            aria-hidden="true"
          >
            <rect
              x="6"
              y="4"
              width="28"
              height="36"
              rx="2"
              stroke="currentColor"
              strokeOpacity="0.22"
              strokeWidth="1.2"
            />
            <path
              d="M20 10L23.5 16L20 22L16.5 16L20 10Z"
              className="fill-primary/18 stroke-primary"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path
              d="M11 28H29M13 32H27M15 35.5H25"
              stroke="currentColor"
              strokeOpacity="0.4"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
          </svg>
        )}
        <div className="border-t border-outline-variant/50 pt-1 pl-0.5 flex items-center justify-between text-[7px] font-mono text-on-surface-variant/75">
          <span className="truncate">book(ish)</span>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden select-none p-4 sm:p-5 flex flex-col justify-between text-left text-on-surface bg-gradient-to-b from-surface-container-low via-surface-container to-surface-container-high',
        className,
      )}
    >
      {/* Subtle physical book spine highlight */}
      <div
        className="absolute inset-y-0 left-0 w-2 bg-gradient-to-r from-black/15 via-white/20 to-transparent z-10 pointer-events-none"
        aria-hidden="true"
      />
      <div className="flex items-center justify-between border-b border-outline-variant/60 pb-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-on-surface-variant">
          {eyebrow}
        </span>
        <BookIcon
          size={13}
          className="text-on-surface-variant/70"
          strokeWidth={1.5}
        />
      </div>
      {showTitleText ? (
        <div className="my-auto py-2 space-y-1.5 overflow-hidden">
          <h3 className="font-serif font-semibold text-sm sm:text-base leading-snug tracking-tight text-primary line-clamp-3">
            {formattedTitle}
          </h3>
          {formattedAuthor && (
            <p className="font-sans text-[11px] text-on-surface-variant font-medium tracking-wide uppercase line-clamp-2">
              {formattedAuthor}
            </p>
          )}
        </div>
      ) : (
        <svg
          viewBox="0 0 64 72"
          fill="none"
          className="w-4/5 h-auto mx-auto my-auto text-on-surface"
          aria-hidden="true"
        >
          <rect
            x="8"
            y="6"
            width="48"
            height="60"
            rx="3"
            className="fill-surface/60"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="1.3"
          />
          <path
            d="M32 16L37 26L32 36L27 26L32 16Z"
            className="fill-primary/18 stroke-primary"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
          <path
            d="M18 45H46M21 51H43M24 56.5H40"
            stroke="currentColor"
            strokeOpacity="0.4"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      )}
      <div className="border-t border-outline-variant/60 pt-2 flex items-center justify-between text-[10px] font-mono tabular-nums text-on-surface-variant/80">
        <span>{yearLabel || 'Cataloged'}</span>
        <span>book(ish)</span>
      </div>
    </div>
  );
}
