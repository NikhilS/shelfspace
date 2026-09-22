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
    <div className="flex items-center gap-1.5 sm:gap-2.5 pt-1 pb-4 overflow-x-auto hide-scrollbar">
      {/* Control 1: My Libraries */}
      <button
        type="button"
        id="filter-toggle-owned"
        aria-label="My Libraries"
        aria-pressed={scopes.includes('owned') && !isAllActive}
        onClick={() => onToggleScope('owned')}
        className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none border shrink-0 whitespace-nowrap ${
          scopes.includes('owned') && !isAllActive
            ? 'bg-primary text-on-primary border-primary shadow-xs'
            : isAllActive
              ? 'bg-surface-container-high text-on-surface-variant/80 border-outline-variant/30 hover:bg-surface-container-highest'
              : 'bg-surface-container text-on-surface-variant border-outline-variant/50 hover:bg-surface-container-high'
        }`}
      >
        <User className="w-3.5 h-3.5 shrink-0" />
        <span className="sm:hidden">Mine</span>
        <span className="hidden sm:inline">My Libraries</span>
        {scopes.includes('owned') && !isAllActive && (
          <Check className="w-3 h-3 stroke-[2.5] shrink-0" />
        )}
      </button>

      {/* Control 2: Shared with Me */}
      <button
        type="button"
        id="filter-toggle-shared"
        aria-label="Shared with Me"
        aria-pressed={scopes.includes('shared') && !isAllActive}
        onClick={() => onToggleScope('shared')}
        className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none border shrink-0 whitespace-nowrap ${
          scopes.includes('shared') && !isAllActive
            ? 'bg-primary text-on-primary border-primary shadow-xs'
            : isAllActive
              ? 'bg-surface-container-high text-on-surface-variant/80 border-outline-variant/30 hover:bg-surface-container-highest'
              : 'bg-surface-container text-on-surface-variant border-outline-variant/50 hover:bg-surface-container-high'
        }`}
      >
        <Users className="w-3.5 h-3.5 shrink-0" />
        <span className="sm:hidden">Shared</span>
        <span className="hidden sm:inline">Shared with Me</span>
        {scopes.includes('shared') && !isAllActive && (
          <Check className="w-3 h-3 stroke-[2.5] shrink-0" />
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
          className={`inline-flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none border shrink-0 whitespace-nowrap ${
            isAllActive
              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
              : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
          }`}
          title="Global Catalog Access (Admin Only)"
        >
          <Shield className="w-3.5 h-3.5 shrink-0" />
          <span className="sm:hidden">All (Admin)</span>
          <span className="hidden sm:inline">All Libraries (Admin)</span>
          {isAllActive && <Check className="w-3 h-3 stroke-[2.5] shrink-0" />}
        </button>
      )}

      {typeof totalCount === 'number' && (
        <div className="ml-auto text-xs font-medium text-on-surface-variant/60 hidden sm:block shrink-0">
          {totalCount} {totalCount === 1 ? 'collection' : 'collections'} shown
        </div>
      )}
    </div>
  );
}
