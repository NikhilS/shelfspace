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
    <div className="flex flex-wrap items-center gap-2.5 pt-1 pb-4">
      <div className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant/70 mr-1 select-none">
        Filter Catalog:
      </div>

      {/* Control 1: My Libraries */}
      <button
        type="button"
        id="filter-toggle-owned"
        aria-pressed={scopes.includes('owned') && !isAllActive}
        onClick={() => onToggleScope('owned')}
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none border ${
          scopes.includes('owned') && !isAllActive
            ? 'bg-primary text-on-primary border-primary shadow-xs'
            : isAllActive
              ? 'bg-surface-container-high text-on-surface-variant/80 border-outline-variant/30 hover:bg-surface-container-highest'
              : 'bg-surface-container text-on-surface-variant border-outline-variant/50 hover:bg-surface-container-high'
        }`}
      >
        <User className="w-3.5 h-3.5" />
        <span>My Libraries</span>
        {scopes.includes('owned') && !isAllActive && (
          <Check className="w-3 h-3 stroke-[2.5]" />
        )}
      </button>

      {/* Control 2: Shared with Me */}
      <button
        type="button"
        id="filter-toggle-shared"
        aria-pressed={scopes.includes('shared') && !isAllActive}
        onClick={() => onToggleScope('shared')}
        className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none border ${
          scopes.includes('shared') && !isAllActive
            ? 'bg-primary text-on-primary border-primary shadow-xs'
            : isAllActive
              ? 'bg-surface-container-high text-on-surface-variant/80 border-outline-variant/30 hover:bg-surface-container-highest'
              : 'bg-surface-container text-on-surface-variant border-outline-variant/50 hover:bg-surface-container-high'
        }`}
      >
        <Users className="w-3.5 h-3.5" />
        <span>Shared with Me</span>
        {scopes.includes('shared') && !isAllActive && (
          <Check className="w-3 h-3 stroke-[2.5]" />
        )}
      </button>

      {/* Control 3: All Libraries (Super Admin / Admin only) */}
      {isAdmin && (
        <button
          type="button"
          id="filter-toggle-all"
          aria-pressed={isAllActive}
          onClick={() => onToggleScope('all')}
          className={`inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium transition-all cursor-pointer select-none border ${
            isAllActive
              ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
              : 'bg-amber-500/10 text-amber-800 dark:text-amber-300 border-amber-500/30 hover:bg-amber-500/20'
          }`}
          title="Global Catalog Access (Admin Only)"
        >
          <Shield className="w-3.5 h-3.5" />
          <span>All Libraries (Global Admin)</span>
          {isAllActive && <Check className="w-3 h-3 stroke-[2.5]" />}
        </button>
      )}

      {typeof totalCount === 'number' && (
        <div className="ml-auto text-xs font-medium text-on-surface-variant/60 hidden sm:block">
          {totalCount} {totalCount === 1 ? 'collection' : 'collections'} shown
        </div>
      )}
    </div>
  );
}
