import React from 'react';

// SKELETON HEADER: Matches LibraryHeader proportions and dark contrast gradient
export function LibraryHeaderSkeleton() {
  return (
    <div className="w-full min-h-[110px] sm:min-h-[180px] md:min-h-[220px] relative overflow-hidden flex flex-col justify-between bg-primary animate-pulse transition-all">
      <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/60 to-primary/30 opacity-95" />

      {/* Top Back-button placeholder */}
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-4 sm:px-8 pt-2.5 sm:pt-3.5">
        <div className="h-6 sm:h-7 w-28 bg-white/20 rounded-full backdrop-blur-md" />
      </div>

      {/* Bottom Title & Subtitle */}
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-4 sm:px-8 pb-2 sm:pb-4 md:pb-5 text-white mt-auto">
        <div className="space-y-2 sm:space-y-3">
          <div className="h-6 sm:h-9 bg-white/30 rounded-lg w-1/3 max-w-[320px]" />
          <div className="flex items-center gap-2">
            <div className="h-3.5 bg-white/20 rounded-md w-36" />
          </div>
        </div>
      </div>
    </div>
  );
}

// SKELETON TABS: Simulates the sticky Sub-Navigation Bar
export function LibraryTabsSkeleton() {
  return (
    <div className="sticky top-16 z-20 bg-background/95 backdrop-blur-md border-b border-outline-variant/20 shadow-xs animate-pulse">
      <div className="w-full max-w-[1200px] mx-auto px-4 sm:px-8 py-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 p-1 bg-surface-container-low rounded-xl border border-outline-variant/30">
          <div className="h-7 w-20 bg-surface rounded-lg" />
          <div className="h-7 w-24 bg-surface-container rounded-lg" />
          <div className="hidden sm:block h-7 w-20 bg-surface-container rounded-lg" />
        </div>
        <div className="h-8 w-24 bg-surface-variant/40 rounded-xl" />
      </div>
    </div>
  );
}

// SKELETON OVERVIEW CONTENT: Simulates the Digest ribbon, Reading Pulse/Spotlight, and Perspectives
export function LibraryOverviewSkeleton() {
  return (
    <div className="layout-page-content space-y-10 animate-pulse">
      {/* Digest Ribbon Skeleton */}
      <div className="h-10 w-full rounded-xl bg-surface-container-low/70 border border-outline-variant/30 flex items-center px-4 gap-4">
        <div className="h-4 w-36 bg-surface-variant/40 rounded" />
        <div className="hidden sm:block h-4 w-28 bg-surface-variant/30 rounded" />
        <div className="hidden md:block h-4 w-32 bg-surface-variant/20 rounded ml-auto" />
      </div>

      {/* Tier 1: Personal & Active Cards Grid */}
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="h-6 w-40 bg-surface-variant/40 rounded" />
          <div className="h-4 w-64 bg-surface-variant/25 rounded" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
          {/* Categories Chart Card */}
          <div className="md:col-span-4 bg-surface p-5 sm:p-6 rounded-2xl border border-outline-variant/30 flex flex-col min-h-[220px]">
            <div className="flex justify-between items-center mb-5">
              <div className="h-4 w-24 bg-surface-variant/40 rounded" />
              <div className="h-3 w-16 bg-surface-variant/25 rounded" />
            </div>
            <div className="space-y-3.5 flex-grow flex flex-col justify-center">
              {[85, 65, 45, 30].map(width => (
                <div key={width} className="space-y-1.5">
                  <div className="flex justify-between">
                    <div className="h-3 bg-surface-variant/30 rounded w-20" />
                    <div className="h-3 bg-surface-variant/30 rounded w-6" />
                  </div>
                  <div className="w-full h-1.5 bg-outline-variant/15 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-surface-variant/40 rounded-full"
                      style={{width: `${width}%`}}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Spotlight Card */}
          <div className="md:col-span-8 bg-surface p-5 sm:p-6 rounded-2xl border border-outline-variant/30 flex flex-col sm:flex-row gap-5 min-h-[220px]">
            <div className="w-24 sm:w-28 h-36 sm:h-40 bg-surface-container-high rounded-lg shadow-sm shrink-0" />
            <div className="flex-1 space-y-3 pt-1">
              <div className="h-3 w-20 bg-secondary/20 rounded" />
              <div className="h-6 w-3/4 bg-surface-variant/40 rounded" />
              <div className="h-4 w-1/3 bg-surface-variant/30 rounded" />
              <div className="space-y-1.5 pt-2">
                <div className="h-3 w-full bg-surface-variant/20 rounded" />
                <div className="h-3 w-4/5 bg-surface-variant/20 rounded" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Perspectives / Explore Section Skeleton */}
      <div className="space-y-4">
        <div className="space-y-1">
          <div className="h-6 w-48 bg-surface-variant/40 rounded" />
          <div className="h-4 w-72 bg-surface-variant/25 rounded" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div
              key={i}
              className="bg-surface p-5 rounded-2xl border border-outline-variant/30 space-y-4 min-h-[140px]"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-surface-container-high shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <div className="h-4 w-24 bg-surface-variant/40 rounded" />
                  <div className="h-3 w-32 bg-surface-variant/20 rounded" />
                </div>
              </div>
              <div className="h-3 w-full bg-surface-variant/20 rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// SKELETON COLLECTION CONTENT: Search bar + Filter chips + Book covers grid
export function LibraryCollectionSkeleton() {
  return (
    <div className="layout-page-content space-y-6 pt-4 animate-pulse">
      {/* Search & Filter Bar Skeleton */}
      <div className="bg-surface flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 p-4 border border-outline-variant/30 rounded-2xl shadow-xs">
        <div className="h-10 bg-surface-container rounded-xl w-full md:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-9 bg-surface-container rounded-xl w-24" />
          <div className="h-9 bg-surface-container rounded-xl w-24" />
          <div className="h-9 bg-surface-container rounded-xl w-16" />
        </div>
      </div>

      {/* Genre Pills Skeleton */}
      <div className="flex items-center gap-2 overflow-x-hidden py-1">
        {[20, 24, 18, 28, 22, 26].map((w, i) => (
          <div
            key={i}
            className="h-7 bg-surface-container-low border border-outline-variant/20 rounded-full shrink-0"
            style={{width: `${w * 4}px`}}
          />
        ))}
      </div>

      {/* Books Grid Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => (
          <div key={i} className="flex flex-col space-y-2.5">
            <div className="aspect-[2/3] bg-surface-container rounded-xl shadow-xs border border-outline-variant/20 w-full" />
            <div className="space-y-1.5 px-0.5">
              <div className="h-3.5 bg-surface-variant/40 rounded w-4/5" />
              <div className="h-3 bg-surface-variant/25 rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface LibraryMainSkeletonProps {
  tab?: 'overview' | 'collection';
}

// MAIN skeleton page that seamlessly pieces together Header, Tabs, and Content
export function LibraryMainSkeleton({
  tab = 'overview',
}: LibraryMainSkeletonProps) {
  return (
    <div className="flex-grow flex flex-col min-h-screen w-full">
      <div className="flex-1 flex flex-col min-w-0">
        <LibraryHeaderSkeleton />
        <LibraryTabsSkeleton />
        <div className="pt-4">
          {tab === 'overview' ? (
            <LibraryOverviewSkeleton />
          ) : (
            <LibraryCollectionSkeleton />
          )}
        </div>
      </div>
    </div>
  );
}
