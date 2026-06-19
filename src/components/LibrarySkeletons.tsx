import React from 'react';

// SKELETON HEADER: Simulates the large hero banner area with corresponding dark-contrast background
export function LibraryHeaderSkeleton() {
  return (
    <div className="w-full h-[280px] sm:h-[400px] relative overflow-hidden flex items-end bg-primary animate-pulse">
      <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/40 to-transparent opacity-90" />
      <div className="relative z-10 w-full max-w-[1200px] mx-auto px-6 sm:px-10 pb-10 sm:pb-16 text-white translate-y-4">
        <div className="space-y-4">
          {/* Header Title Mask */}
          <div className="h-8 sm:h-12 bg-white/20 rounded-md w-1/3" />
          {/* Header Subtitle Mask */}
          <div className="flex items-center gap-3">
            <div className="h-4 bg-white/10 rounded w-24" />
            <div className="w-[1px] h-4 bg-white/20" />
            <div className="h-4 bg-white/10 rounded w-36" />
          </div>
        </div>
      </div>
    </div>
  );
}

// SKELETON TABS: Simulates the Overview / Collection tab navigation buttons
export function LibraryTabsSkeleton() {
  return (
    <div className="w-full px-4 sm:px-8 pt-4 border-b border-outline-variant/30 flex gap-6 bg-surface-container-lowest animate-pulse">
      <div className="h-8 bg-surface-variant/40 rounded-t w-20 mb-3" />
      <div className="h-8 bg-surface-variant/40 rounded-t w-24 mb-3" />
    </div>
  );
}

// SKELETON OVERVIEW CONTENT: Simulates metrics boxes, the categories bar chart vertical list, currently reading, and recruiter picks
export function LibraryOverviewSkeleton() {
  return (
    <div className="layout-page-content animate-pulse">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Left Column Skeletons */}
        <div className="md:col-span-4 flex flex-col gap-6">
          {/* Total volumes card */}
          <div className="bg-surface-container-low p-6 shadow-sm border border-outline-variant/20 flex flex-col justify-between h-44">
            <div>
              <div className="h-4 bg-surface-variant/30 rounded w-1/2 mb-3" />
              <div className="h-8 bg-surface-variant/40 rounded w-1/3" />
            </div>
            <div className="h-4 bg-surface-variant/30 rounded w-full pt-4 border-t border-outline-variant/30" />
          </div>

          {/* Top categories chart box */}
          <div className="bg-surface p-6 border border-surface-variant relative shadow-sm flex flex-col min-h-[400px]">
            <div className="h-4 bg-surface-variant/40 rounded w-2/5 mb-8" />
            <div className="space-y-6 flex-grow flex flex-col justify-center">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="space-y-2">
                  <div className="flex justify-between">
                    <div className="h-4 bg-surface-variant/30 rounded w-1/3" />
                    <div className="h-4 bg-surface-variant/30 rounded w-10" />
                  </div>
                  <div className="w-full h-1.5 bg-outline-variant/10 rounded-full">
                    <div
                      className="h-full bg-surface-variant/30 rounded-full"
                      style={{width: `${100 - i * 15}%`}}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column Skeletons */}
        <div className="md:col-span-8 flex flex-col gap-6">
          {/* Currently Reading block */}
          <div className="bg-surface-container-lowest p-8 shadow-sm border border-surface-variant flex flex-col sm:flex-row gap-8 items-center min-h-[220px]">
            <div className="w-32 h-44 bg-surface-variant/30 rounded-sm shadow-md flex-shrink-0" />
            <div className="flex-grow w-full space-y-4">
              <div className="h-5 bg-surface-variant/40 rounded-sm w-28" />
              <div className="h-8 bg-surface-variant/40 rounded w-3/4" />
              <div className="h-4 bg-surface-variant/30 rounded w-1/2" />
              <div className="h-10 bg-surface-variant/30 rounded w-28 ml-auto" />
            </div>
          </div>

          {/* Curator's Pick block */}
          <div className="bg-gradient-to-br from-surface-container-low to-surface border border-outline-variant/30 p-8 min-h-[220px] flex flex-col sm:flex-row gap-8 items-center relative overflow-hidden">
            <div className="w-24 h-36 bg-surface-variant/30 rounded-sm shadow-md flex-shrink-0 mt-2 sm:mt-0" />
            <div className="flex-grow w-full space-y-4">
              <div className="h-5 bg-surface-variant/40 rounded-sm w-32" />
              <div className="h-6 bg-surface-variant/40 rounded w-2/3" />
              <div className="h-4 bg-surface-variant/30 rounded w-1/3" />
              <div className="space-y-2 pl-4 border-l-2 border-outline-variant/20 py-1">
                <div className="h-4 bg-surface-variant/30 rounded w-full" />
                <div className="h-4 bg-surface-variant/30 rounded-sm w-5/6" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// SKELETON COLLECTION CONTENT: Simulates search filters and a beautiful grid of 2:3 ratio book covers
export function LibraryCollectionSkeleton() {
  return (
    <div className="layout-page-content animate-pulse">
      {/* Filtering Row Skeleton */}
      <div className="bg-surface flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 mb-8 p-4 border border-outline-variant/30 rounded-lg">
        {/* Search Input Box Skeleton */}
        <div className="h-10 bg-surface-variant/30 rounded w-full md:w-80" />
        {/* Actions Skeletal Blocks */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="h-10 bg-surface-variant/30 rounded w-28" />
          <div className="h-10 bg-surface-variant/30 rounded w-28" />
          <div className="h-10 bg-surface-variant/30 rounded w-20" />
          <div className="h-10 bg-surface-variant/30 rounded w-10" />
        </div>
      </div>

      {/* Grid skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6 sm:gap-8">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => (
          <div key={i} className="flex flex-col h-full space-y-3">
            {/* Aspect 2/3 Book Cover skeleton */}
            <div className="aspect-[2/3] bg-surface-container rounded-lg shadow-sm border border-outline-variant/10 w-full" />
            {/* Metadata Text lines */}
            <div className="space-y-1.5 pl-1">
              <div className="h-4 bg-surface-variant/40 rounded w-5/6" />
              <div className="h-3 bg-surface-variant/30 rounded w-1/2" />
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

// MAIN skeleton page that pieces together Header and Tab Content
export function LibraryMainSkeleton({
  tab = 'overview',
}: LibraryMainSkeletonProps) {
  return (
    <div className="flex-grow flex flex-col min-h-screen w-full">
      <div className="flex-1 flex flex-col min-w-0">
        <LibraryHeaderSkeleton />
        <div className="pt-6">
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
