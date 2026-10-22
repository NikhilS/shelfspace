import React from 'react';
import {Sliders, Compass} from 'lucide-react';
import {Book} from '../../types';

export const PRESETS = [
  {
    id: 'all',
    label: 'All-Time Focus',
    zoom: 1 as const,
    text: "A bird's-eye hydrographic view of your entire collection.",
  },
  {
    id: 'bce',
    label: 'Ancient & BCE Era',
    zoom: 5 as const,
    yearLimit: 0,
    text: 'Isolate historical epics of Antiquity and BCE headwaters.',
  },
  {
    id: 'modern',
    label: 'Century Highlights',
    zoom: 20 as const,
    text: 'Decompose modern centuries into decade river bends.',
  },
];

export const formatYear = (year: number): string => {
  if (year < 0) {
    return `${Math.abs(year)} BCE`;
  }
  return `${year} CE`;
};

export interface TimelineCluster {
  key: number;
  label: string;
  books: Book[];
  minYear: number;
  maxYear: number;
  channelWidth: number;
  spanningBooks: Book[];
}

export interface TimelinePresetControlsProps {
  selectedPreset: string;
  zoomLevel: 1 | 5 | 20;
  onPresetSelect: (presetId: string) => void;
  onZoomChange: (zoom: 1 | 5 | 20) => void;
}

export function TimelinePresetControls({
  selectedPreset,
  zoomLevel,
  onPresetSelect,
  onZoomChange,
}: TimelinePresetControlsProps) {
  return (
    <div className="flex items-center gap-2.5 flex-wrap shrink-0">
      {/* Segmented filter presets */}
      <div className="bg-surface-container p-1 rounded-lg flex border border-outline-variant/60 text-xs font-sans font-semibold">
        {PRESETS.map(p => (
          <button
            key={p.id}
            type="button"
            onClick={() => onPresetSelect(p.id)}
            className={`py-1.5 px-3 rounded-md transition-all cursor-pointer whitespace-nowrap shrink-0 ${
              selectedPreset === p.id
                ? 'bg-primary text-on-primary shadow-2xs font-semibold'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
            title={p.text}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Slider controls */}
      <div className="flex items-center gap-2 px-3.5 py-1.5 bg-surface-container rounded-lg border border-outline-variant/60">
        <Sliders className="w-4 h-4 text-on-surface-variant shrink-0" />
        <span className="text-xs font-mono tabular-nums font-semibold select-none text-on-surface-variant pr-1 whitespace-nowrap">
          Zoom: {zoomLevel}x
        </span>
        <input
          type="range"
          aria-label="Timeline zoom density"
          min="1"
          max="3"
          step="1"
          value={zoomLevel === 1 ? 1 : zoomLevel === 5 ? 2 : 3}
          onChange={e => {
            const val = Number(e.target.value);
            const z: 1 | 5 | 20 = val === 1 ? 1 : val === 2 ? 5 : 20;
            onZoomChange(z);
          }}
          className="w-20 accent-primary h-1 bg-outline-variant/50 rounded-lg cursor-pointer focus:outline-none"
        />
      </div>
    </div>
  );
}

export interface TimelineScrubberProps {
  clusters: TimelineCluster[];
  selectedClusterKey: number | null;
  hoveredClusterKey: number | null;
  maxClusterCount: number;
  onJumpToCluster: (clusterKey: number) => void;
  onHoverCluster: (clusterKey: number | null) => void;
}

export function TimelineScrubber({
  clusters,
  selectedClusterKey,
  hoveredClusterKey,
  maxClusterCount,
  onJumpToCluster,
  onHoverCluster,
}: TimelineScrubberProps) {
  if (clusters.length === 0) {
    return null;
  }

  return (
    <div
      className="mb-6 bg-surface-container-low border border-outline-variant/50 rounded-2xl p-4"
      aria-label="Century scrubber navigation"
    >
      <div className="flex items-center justify-between gap-4 mb-2.5">
        <div className="flex items-center gap-2 text-xs font-sans font-semibold text-on-surface">
          <Compass className="w-3.5 h-3.5 text-[#2d6d82] dark:text-[#6ab0c7] shrink-0" />
          <span>Hydrographic Century Scrubber</span>
          <span aria-hidden="true" className="text-outline-variant">
            ·
          </span>
          <span className="font-normal text-on-surface-variant">
            Select any era bend to jump along the river
          </span>
        </div>
        <span className="text-xs font-mono tabular-nums text-on-surface-variant hidden sm:inline">
          {formatYear(clusters[0].key)} →{' '}
          {formatYear(clusters[clusters.length - 1].key)}
        </span>
      </div>

      <div className="flex items-end gap-1.5 overflow-x-auto pb-1 pt-2 scrollbar-thin">
        {clusters.map(cluster => {
          const isSelected = selectedClusterKey === cluster.key;
          const isHovered = hoveredClusterKey === cluster.key;
          const heightRatio = Math.max(
            0.24,
            cluster.books.length / maxClusterCount,
          );
          const barHeightPx = Math.round(12 + heightRatio * 28);

          return (
            <button
              key={`scrubber-${cluster.key}`}
              type="button"
              onClick={() => onJumpToCluster(cluster.key)}
              onMouseEnter={() => onHoverCluster(cluster.key)}
              onMouseLeave={() => onHoverCluster(null)}
              className={`group flex-1 min-w-[72px] p-2 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-1.5 ${
                isSelected
                  ? 'bg-surface-container-high border-[#2d6d82] dark:border-[#6ab0c7] ring-1 ring-[#2d6d82]/25'
                  : isHovered
                    ? 'bg-surface-container border-[#2d6d82]/45'
                    : 'bg-background/60 border-outline-variant/30 hover:border-[#2d6d82]/40'
              }`}
              title={`${cluster.label} (${formatYear(cluster.key)}) — ${cluster.books.length} volumes`}
            >
              <div className="w-full h-10 flex items-end justify-between gap-2">
                <div
                  className={`w-2.5 rounded-t-sm transition-all ${
                    isSelected
                      ? 'bg-[#2d6d82] dark:bg-[#6ab0c7]'
                      : 'bg-[#2d6d82]/50 dark:bg-[#6ab0c7]/50 group-hover:bg-[#2d6d82]'
                  }`}
                  style={{height: `${barHeightPx}px`}}
                />
                <span className="text-[11px] font-mono tabular-nums font-semibold text-on-surface-variant group-hover:text-on-surface">
                  {cluster.books.length}v
                </span>
              </div>
              <div className="truncate w-full">
                <div className="text-[11px] font-mono tabular-nums font-semibold text-on-surface truncate">
                  {formatYear(cluster.key)}
                </div>
                <div className="text-[10px] font-sans text-on-surface-variant truncate">
                  {cluster.label}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
