import React from 'react';
import {Link} from 'react-router-dom';
import {ArrowLeft} from 'lucide-react';

export interface BackToLibraryProps {
  libraryId?: string;
  customTo?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
  'aria-label'?: string;
}

/**
 * Standardized, accessible "Back to Library" navigation control.
 * Ensures consistent touch targets (>= 44px on mobile), hover micro-interactions,
 * and aesthetic alignment across all library sub-views.
 */
export const BackToLibrary: React.FC<BackToLibraryProps> = ({
  libraryId,
  customTo,
  label = 'Back to Library',
  className = '',
  onClick,
  'aria-label': ariaLabel,
}) => {
  const targetUrl = customTo || (libraryId ? `/library/${libraryId}` : '/');

  const baseClasses = `group inline-flex items-center gap-2 min-h-[44px] px-3 py-1.5 -ml-3 rounded-full text-xs sm:text-sm font-sans font-medium text-on-surface-variant hover:text-primary active:text-primary hover:bg-surface-container-high/60 active:bg-surface-container-highest transition-all duration-150 border border-transparent hover:border-outline-variant/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-1 cursor-pointer select-none ${className}`;

  if (onClick && !customTo && !libraryId) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={baseClasses}
        aria-label={ariaLabel || label}
      >
        <ArrowLeft className="w-4 h-4 text-on-surface-variant group-hover:text-primary group-hover:-translate-x-1 transition-transform duration-150 shrink-0" />
        <span className="truncate">{label}</span>
      </button>
    );
  }

  return (
    <Link
      to={targetUrl}
      onClick={onClick}
      className={baseClasses}
      aria-label={ariaLabel || label}
    >
      <ArrowLeft className="w-4 h-4 text-on-surface-variant group-hover:text-primary group-hover:-translate-x-1 transition-transform duration-150 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
};
