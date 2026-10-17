import React from 'react';
import {User, Users, Shield, Check} from 'lucide-react';
import {LibraryScope} from '../../schemas/libraryApi';

interface LibraryFilterControlsProps {
  scopes: LibraryScope[];
  onToggleScope: (scope: LibraryScope) => void;
  isAdmin: boolean;
  totalCount?: number;
}

export function LibraryFilterControls({
  scopes,
  onToggleScope,
  isAdmin,
  totalCount,
}: LibraryFilterControlsProps) {
  const isAllActive = scopes.includes('all');

  return (
    <div className="flex items-center justify-between gap-3 pt-1 pb-6 overflow-x-auto hide-scrollbar">
      <div className="inline-flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/60 shrink-0">
        {/* Control 1: My Libraries */}
        <button
          type="button"
          id="filter-toggle-owned"
          aria-label="My Libraries"
          aria-pressed={scopes.includes('owned') && !isAllActive}
          onClick={() => onToggleScope('owned')}
          className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-md text-xs font-sans font-medium transition-all cursor-pointer select-none shrink-0 whitespace-nowrap ${
            scopes.includes('owned') && !isAllActive
              ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface/50 border border-transparent'
          }`}
        >
          <User className="w-3.5 h-3.5 shrink-0" />
          <span className="sm:hidden">Mine</span>
          <span className="hidden sm:inline">My Libraries</span>
          {scopes.includes('owned') && !isAllActive && (
            <Check className="w-3 h-3 stroke-[2.5] shrink-0 text-primary" />
          )}
        </button>

        {/* Control 2: Shared with Me */}
        <button
          type="button"
          id="filter-toggle-shared"
          aria-label="Shared with Me"
          aria-pressed={scopes.includes('shared') && !isAllActive}
          onClick={() => onToggleScope('shared')}
          className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-md text-xs font-sans font-medium transition-all cursor-pointer select-none shrink-0 whitespace-nowrap ${
            scopes.includes('shared') && !isAllActive
              ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50'
              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface/50 border border-transparent'
          }`}
        >
          <Users className="w-3.5 h-3.5 shrink-0" />
          <span className="sm:hidden">Shared</span>
          <span className="hidden sm:inline">Shared with Me</span>
          {scopes.includes('shared') && !isAllActive && (
            <Check className="w-3 h-3 stroke-[2.5] shrink-0 text-primary" />
          )}
        </button>

        {/* Control 3: All Libraries (Super Admin / Admin only) */}
        {isAdmin && (
          <button
            type="button"
            id="filter-toggle-all"
            aria-label="All Libraries (Global Admin)"
            aria-pressed={isAllActive}
            onClick={() => onToggleScope('all')}
            className={`inline-flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 rounded-md text-xs font-sans font-medium transition-all cursor-pointer select-none shrink-0 whitespace-nowrap ${
              isAllActive
                ? 'bg-tertiary text-on-tertiary font-semibold shadow-2xs'
                : 'text-tertiary hover:bg-tertiary/10'
            }`}
            title="Global Catalog Access (Admin Only)"
          >
            <Shield className="w-3.5 h-3.5 shrink-0" />
            <span className="sm:hidden">All (Admin)</span>
            <span className="hidden sm:inline">All Libraries (Admin)</span>
            {isAllActive && <Check className="w-3 h-3 stroke-[2.5] shrink-0" />}
          </button>
        )}
      </div>

      {typeof totalCount === 'number' && (
        <div className="ml-auto font-mono tabular-nums text-xs font-medium text-on-surface-variant hidden sm:block shrink-0">
          {totalCount} {totalCount === 1 ? 'collection' : 'collections'}{' '}
          archived
        </div>
      )}
    </div>
  );
}
