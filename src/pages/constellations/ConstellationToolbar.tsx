import React from 'react';
import {Search, X, Layers} from 'lucide-react';
import {ClusterGeometry} from './types';

interface ConstellationToolbarProps {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  totalVolumes: number;
  clustersGeometry: ClusterGeometry[];
  activeClusterId: number | null;
  selectedStarId: string | null;
  isDrawerOpen: boolean;
  onToggleDrawer: () => void;
  onResetView: () => void;
  onFocusCluster: (clusterId: number) => void;
}

export function ConstellationToolbar({
  searchQuery,
  onSearchChange,
  totalVolumes,
  clustersGeometry,
  activeClusterId,
  selectedStarId,
  isDrawerOpen,
  onToggleDrawer,
  onResetView,
  onFocusCluster,
}: ConstellationToolbarProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-surface-container border border-outline-variant/60 rounded-xl p-3">
      {/* Search Input */}
      <div className="relative flex-1 max-w-md">
        <Search className="w-4 h-4 text-on-surface-variant absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          type="text"
          value={searchQuery}
          onChange={e => onSearchChange(e.target.value)}
          placeholder="Locate book by title, author, genre, or constellation..."
          aria-label="Locate book by title, author, genre, or constellation"
          className="w-full pl-9 pr-8 py-2 text-xs sm:text-sm bg-surface border border-outline-variant/60 rounded-lg text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-on-surface"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Constellation Quick-Filter Strip + Atlas Drawer Toggle */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
          <button
            type="button"
            onClick={onResetView}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
              activeClusterId === null && !selectedStarId
                ? 'bg-primary text-on-primary border-primary'
                : 'bg-surface text-on-surface-variant border-outline-variant/50 hover:text-on-surface'
            }`}
          >
            All Constellations ({totalVolumes})
          </button>
          {clustersGeometry.map(cluster => {
            const isSelected = activeClusterId === cluster.clusterId;
            return (
              <button
                key={cluster.clusterId}
                type="button"
                onClick={() => onFocusCluster(cluster.clusterId)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 transition-colors border ${
                  isSelected
                    ? 'bg-surface-container-highest text-on-surface border-primary/50 shadow-xs'
                    : 'bg-surface text-on-surface-variant border-outline-variant/50 hover:text-on-surface'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-xs shrink-0"
                  style={{backgroundColor: cluster.color}}
                />
                <span>{cluster.name}</span>
                <span className="font-mono tabular-nums text-[11px] opacity-70">
                  {cluster.pointIndices.length}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={onToggleDrawer}
          aria-expanded={isDrawerOpen}
          aria-label="Toggle Atlas Inspector Drawer"
          className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors border ${
            isDrawerOpen
              ? 'bg-surface-container-highest text-on-surface border-outline-variant'
              : 'bg-surface text-on-surface-variant border-outline-variant/60 hover:text-on-surface'
          }`}
        >
          <Layers className="w-3.5 h-3.5 text-primary" />
          <span className="hidden md:inline">Atlas Index</span>
        </button>
      </div>
    </div>
  );
}
