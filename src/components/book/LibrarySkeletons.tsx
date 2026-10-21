import React from 'react';
import {Link} from 'react-router-dom';
import {
  ArrowLeft,
  Sparkles,
  BookOpen,
  Compass,
  Globe,
  Clock,
  Wand2,
  Plus,
} from 'lucide-react';
import {Library, Book} from '../../types';
import {LibraryHeader} from '../../pages/library/LibraryHeader';
import {toTitleCase, formatCompactNumber} from '../../lib/utils';

export type LibrarySkeletonViewType =
  | 'overview'
  | 'collection'
  | 'constellation'
  | 'world-map'
  | 'timeline'
  | 'book-details'
  | 'add-book'
  | 'spruce-up';

export interface WarmSkeletonContextProps {
  isWarm?: boolean;
  cachedLibrary?: Library | null;
  cachedBooks?: Book[];
  currentUserId?: string;
  isReadingShelf?: boolean;
}

// SKELETON HEADER: Matches LibraryHeader proportions and dark contrast gradient
export function LibraryHeaderSkeleton() {
  return (
    <div
      data-testid="library-header-skeleton"
      className="w-full min-h-[110px] sm:min-h-[180px] md:min-h-[220px] relative overflow-hidden flex flex-col justify-between bg-primary animate-pulse transition-all"
    >
      <div className="absolute inset-0 bg-gradient-to-t from-primary via-primary/60 to-primary/30 opacity-95" />

      {/* Top Back-button placeholder */}
      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pt-3 sm:pt-4">
        <div className="h-7 w-28 bg-white/20 rounded-lg backdrop-blur-md" />
      </div>

      {/* Bottom Title & Subtitle */}
      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 pb-3 sm:pb-5 md:pb-6 text-white mt-auto">
        <div className="space-y-2 sm:space-y-3">
          <div className="h-7 sm:h-9 bg-white/30 rounded-lg w-1/3 max-w-[320px]" />
          <div className="flex items-center gap-2">
            <div className="h-3.5 bg-white/20 rounded-md w-36" />
          </div>
        </div>
      </div>
    </div>
  );
}

// SKELETON TABS: Simulates the sticky Sub-Navigation Bar on cold load
export function LibraryTabsSkeleton() {
  return (
    <div
      data-testid="library-tabs-skeleton"
      className="sticky top-16 z-20 bg-background/95 backdrop-blur-md border-b border-outline-variant/20 shadow-xs animate-pulse"
    >
      <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/40">
          <div className="h-8 w-24 bg-surface rounded-md" />
          <div className="h-8 w-24 bg-surface-container-high/50 rounded-md" />
          <div className="hidden sm:block h-8 w-24 bg-surface-container-high/50 rounded-md" />
        </div>
        <div className="h-9 w-28 bg-surface-variant/40 rounded-lg" />
      </div>
    </div>
  );
}

// WARM TABS BAR: Non-pulsing real sub-navigation bar rendered during warm library transitions
export function WarmLibraryTabsBar({
  activeTab = 'overview',
  cachedLibrary,
  cachedBooks = [],
}: {
  activeTab?: 'overview' | 'collection';
  cachedLibrary?: Library | null;
  cachedBooks?: Book[];
}) {
  const bookCount =
    cachedBooks.length > 0
      ? cachedBooks.length
      : cachedLibrary?.bookCount !== undefined
        ? cachedLibrary.bookCount
        : undefined;

  return (
    <div
      data-testid="warm-library-tabs-bar"
      className="sticky top-16 z-20 bg-background/95 backdrop-blur-md border-b border-outline-variant/60"
    >
      <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/60 text-xs font-sans font-medium shrink-0">
          <div
            className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 h-8 rounded-md ${
              activeTab === 'overview'
                ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50'
                : 'text-on-surface-variant'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Overview</span>
          </div>
          <div
            className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 h-8 rounded-md ${
              activeTab === 'collection'
                ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50'
                : 'text-on-surface-variant'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden sm:inline">All Books</span>
            <span className="sm:hidden">Books</span>
            {bookCount !== undefined && (
              <span className="ml-0.5 px-1.5 py-0.5 font-mono tabular-nums text-[10px] font-semibold bg-surface-container-high/80 text-on-surface rounded-sm">
                {formatCompactNumber(bookCount)}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// SKELETON OVERVIEW CONTENT: Simulates the Digest ribbon, Reading Pulse/Spotlight, and Perspectives
export function LibraryOverviewSkeleton() {
  return (
    <div
      data-testid="library-overview-skeleton"
      className="layout-page-content space-y-10 animate-pulse"
    >
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
          <div className="md:col-span-4 bg-surface p-5 sm:p-6 rounded-xl border border-outline-variant/30 flex flex-col min-h-[220px]">
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
                  <div className="w-full h-1.5 bg-outline-variant/15 rounded-sm overflow-hidden">
                    <div
                      className="h-full bg-surface-variant/40 rounded-sm"
                      style={{width: `${width}%`}}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Spotlight Card */}
          <div className="md:col-span-8 bg-surface p-5 sm:p-6 rounded-xl border border-outline-variant/30 flex flex-col sm:flex-row gap-5 min-h-[220px]">
            <div className="w-24 sm:w-28 h-36 sm:h-40 bg-surface-container-high rounded-lg shadow-xs shrink-0" />
            <div className="flex-1 space-y-3 pt-1">
              <div className="h-3 w-20 bg-surface-container-high rounded" />
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
              className="bg-surface p-5 rounded-xl border border-outline-variant/30 space-y-4 min-h-[140px]"
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-surface-container-high shrink-0" />
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
    <div
      data-testid="library-collection-skeleton"
      className="layout-page-content space-y-6 pt-4 animate-pulse"
    >
      {/* Search & Filter Bar Skeleton */}
      <div className="bg-surface flex flex-col md:flex-row justify-between items-stretch md:items-center gap-4 p-4 border border-outline-variant/30 rounded-xl shadow-xs">
        <div className="h-10 bg-surface-container rounded-lg w-full md:w-80" />
        <div className="flex flex-wrap items-center gap-2">
          <div className="h-9 bg-surface-container rounded-lg w-24" />
          <div className="h-9 bg-surface-container rounded-lg w-24" />
          <div className="h-9 bg-surface-container rounded-lg w-16" />
        </div>
      </div>

      {/* Genre Chips Skeleton */}
      <div className="flex items-center gap-2 overflow-x-hidden py-1">
        {[20, 24, 18, 28, 22, 26].map((w, i) => (
          <div
            key={i}
            className="h-7 bg-surface-container-low border border-outline-variant/20 rounded-md shrink-0"
            style={{width: `${w * 4}px`}}
          />
        ))}
      </div>

      {/* Books Grid Skeleton */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 sm:gap-6">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(i => (
          <div key={i} className="flex flex-col space-y-2.5">
            <div className="aspect-[2/3] bg-surface-container rounded-lg shadow-xs border border-outline-variant/20 w-full" />
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

// SPATIAL MAP SKELETON: Dedicated skeleton for Constellation 3D & World Map views
export function SpatialMapSkeleton({
  variant = 'constellation',
  isWarm = false,
  cachedLibrary,
  cachedBooks = [],
  currentUserId,
  isReadingShelf = false,
}: WarmSkeletonContextProps & {
  variant?: 'constellation' | 'world-map';
}) {
  const showRealHeader = Boolean(isWarm && cachedLibrary);
  const label =
    variant === 'constellation' ? 'Constellation View' : 'Literary World Map';

  return (
    <div
      data-testid={`spatial-map-skeleton-${variant}`}
      className="flex-grow flex flex-col min-h-screen w-full bg-background"
    >
      {showRealHeader && cachedLibrary ? (
        <LibraryHeader
          library={cachedLibrary}
          books={cachedBooks}
          isOwner={Boolean(
            currentUserId && cachedLibrary.ownerId === currentUserId,
          )}
        />
      ) : !isWarm && !isReadingShelf ? (
        <LibraryHeaderSkeleton />
      ) : null}

      <div className="flex-1 flex flex-col layout-page-content py-4 sm:py-6 space-y-4">
        {/* Top Control HUD Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-surface-container-low border border-outline-variant/40 rounded-xl p-3 sm:p-4">
          <div className="flex items-center gap-3">
            {isWarm && (cachedLibrary || isReadingShelf) ? (
              <Link
                to={cachedLibrary ? `/library/${cachedLibrary.id}` : '/'}
                className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-on-surface-variant hover:text-on-surface px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant/40"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>
                  {cachedLibrary
                    ? toTitleCase(cachedLibrary.name)
                    : 'Reading Shelf'}
                </span>
              </Link>
            ) : (
              <div className="h-8 w-28 bg-surface-variant/40 rounded-lg animate-pulse" />
            )}
            <div className="flex items-center gap-2 text-on-surface font-sans font-semibold text-sm">
              {variant === 'constellation' ? (
                <Compass className="w-4 h-4 text-primary" />
              ) : (
                <Globe className="w-4 h-4 text-primary" />
              )}
              <span>{label}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 animate-pulse">
            <div className="h-8 w-36 sm:w-48 bg-surface-container rounded-lg border border-outline-variant/30" />
            <div className="h-8 w-20 bg-surface-container rounded-lg border border-outline-variant/30" />
          </div>
        </div>

        {/* Spatial Canvas Viewport Skeleton */}
        <div className="relative flex-1 min-h-[520px] rounded-xl border border-outline-variant/40 bg-surface-container-lowest overflow-hidden flex items-center justify-center animate-pulse">
          {/* Subtle Archival Grid Lines */}
          <div className="absolute inset-6 border border-dashed border-outline-variant/25 rounded-lg pointer-events-none" />
          <div className="flex flex-col items-center gap-3 text-center px-6">
            <div className="w-12 h-12 rounded-lg bg-surface-container-high border border-outline-variant/40 flex items-center justify-center">
              {variant === 'constellation' ? (
                <Compass className="w-5 h-5 text-on-surface-variant/60" />
              ) : (
                <Globe className="w-5 h-5 text-on-surface-variant/60" />
              )}
            </div>
            <div className="h-4 w-44 bg-surface-variant/40 rounded" />
            <div className="h-3 w-64 bg-surface-variant/25 rounded" />
          </div>

          {/* Bottom Legend Placeholder */}
          <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between pointer-events-none">
            <div className="flex items-center gap-2 bg-surface/90 border border-outline-variant/30 rounded-lg px-3 py-2">
              <div className="h-3 w-20 bg-surface-variant/40 rounded" />
              <div className="h-3 w-16 bg-surface-variant/30 rounded" />
            </div>
            <div className="h-8 w-24 bg-surface/90 border border-outline-variant/30 rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}

// TIMELINE VIEW SKELETON: Dedicated skeleton for Chronological Timeline view
export function TimelineViewSkeleton({
  isWarm = false,
  cachedLibrary,
  cachedBooks = [],
  currentUserId,
  isReadingShelf = false,
}: WarmSkeletonContextProps) {
  const showRealHeader = Boolean(isWarm && cachedLibrary);

  return (
    <div
      data-testid="timeline-view-skeleton"
      className="flex-grow flex flex-col min-h-screen w-full bg-background"
    >
      {showRealHeader && cachedLibrary ? (
        <LibraryHeader
          library={cachedLibrary}
          books={cachedBooks}
          isOwner={Boolean(
            currentUserId && cachedLibrary.ownerId === currentUserId,
          )}
        />
      ) : !isWarm && !isReadingShelf ? (
        <LibraryHeaderSkeleton />
      ) : null}

      <div className="layout-page-content py-6 space-y-6">
        {/* Timeline Header & Era Scrubber Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-low border border-outline-variant/40 rounded-xl p-4">
          <div className="flex items-center gap-3">
            {isWarm && (cachedLibrary || isReadingShelf) ? (
              <Link
                to={cachedLibrary ? `/library/${cachedLibrary.id}` : '/'}
                className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-on-surface-variant hover:text-on-surface px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant/40"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>
                  {cachedLibrary
                    ? toTitleCase(cachedLibrary.name)
                    : 'Reading Shelf'}
                </span>
              </Link>
            ) : (
              <div className="h-8 w-28 bg-surface-variant/40 rounded-lg animate-pulse" />
            )}
            <div className="flex items-center gap-2 text-on-surface font-sans font-semibold text-sm">
              <Clock className="w-4 h-4 text-primary" />
              <span>Chronological Timeline</span>
            </div>
          </div>

          <div className="flex items-center gap-2 animate-pulse">
            {[1, 2, 3, 4].map(i => (
              <div
                key={i}
                className="h-7 w-16 bg-surface-container rounded-md border border-outline-variant/30"
              />
            ))}
          </div>
        </div>

        {/* Chronological Era Swimlanes */}
        <div className="space-y-6 animate-pulse">
          {[1, 2, 3].map(era => (
            <div
              key={era}
              className="bg-surface border border-outline-variant/30 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
                <div className="h-5 w-36 bg-surface-variant/40 rounded" />
                <div className="h-4 w-20 bg-surface-variant/25 rounded font-mono" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map(card => (
                  <div
                    key={card}
                    className="flex gap-3 p-3 rounded-lg bg-surface-container-low border border-outline-variant/20"
                  >
                    <div className="w-12 h-18 bg-surface-container-high rounded shrink-0" />
                    <div className="flex-1 space-y-2 py-0.5">
                      <div className="h-3.5 w-4/5 bg-surface-variant/40 rounded" />
                      <div className="h-3 w-1/2 bg-surface-variant/25 rounded" />
                      <div className="h-2.5 w-16 bg-surface-variant/20 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// BOOK DETAILS SKELETON: Two-column archival dossier skeleton for BookDetailsView
export function BookDetailsSkeleton({
  isWarm = false,
  cachedLibrary,
  cachedBooks = [],
  currentUserId,
}: WarmSkeletonContextProps) {
  const showRealHeader = Boolean(isWarm && cachedLibrary);

  return (
    <div
      data-testid="book-details-skeleton"
      className="flex-grow flex flex-col min-h-screen w-full bg-background"
    >
      {showRealHeader && cachedLibrary ? (
        <LibraryHeader
          library={cachedLibrary}
          books={cachedBooks}
          isOwner={Boolean(
            currentUserId && cachedLibrary.ownerId === currentUserId,
          )}
        />
      ) : null}

      <div className="layout-page-content py-6 sm:py-8 space-y-6 animate-pulse">
        {/* Back Breadcrumb Row */}
        <div className="flex items-center justify-between">
          <div className="h-8 w-36 bg-surface-variant/35 rounded-lg" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-24 bg-surface-container rounded-lg border border-outline-variant/30" />
            <div className="h-8 w-24 bg-surface-container rounded-lg border border-outline-variant/30" />
          </div>
        </div>

        {/* Two-Column Archival Dossier Layout */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 bg-surface border border-outline-variant/30 rounded-xl p-6 sm:p-8">
          {/* Left Column: 2:3 Book Cover + Status Controls */}
          <div className="md:col-span-4 lg:col-span-3 space-y-4">
            <div className="aspect-[2/3] w-full max-w-[240px] mx-auto md:mx-0 bg-surface-container-high rounded-lg border border-outline-variant/30 shadow-xs" />
            <div className="h-10 w-full max-w-[240px] mx-auto md:mx-0 bg-surface-container rounded-lg border border-outline-variant/30" />
            <div className="h-9 w-full max-w-[240px] mx-auto md:mx-0 bg-surface-container-low rounded-lg border border-outline-variant/20" />
          </div>

          {/* Right Column: Title, Author, Metadata Grid, Synopsis */}
          <div className="md:col-span-8 lg:col-span-9 space-y-6">
            <div className="space-y-3 border-b border-outline-variant/25 pb-5">
              <div className="h-4 w-28 bg-surface-variant/30 rounded" />
              <div className="h-8 sm:h-10 w-3/4 bg-surface-variant/45 rounded-lg" />
              <div className="h-5 w-1/3 bg-surface-variant/30 rounded" />
            </div>

            {/* Synopsis Placeholder Lines */}
            <div className="space-y-2.5">
              <div className="h-3.5 w-full bg-surface-variant/25 rounded" />
              <div className="h-3.5 w-11/12 bg-surface-variant/25 rounded" />
              <div className="h-3.5 w-4/5 bg-surface-variant/25 rounded" />
              <div className="h-3.5 w-3/5 bg-surface-variant/20 rounded" />
            </div>

            {/* Archival Metadata Specs Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4">
              {[1, 2, 3, 4].map(spec => (
                <div
                  key={spec}
                  className="p-3.5 rounded-lg bg-surface-container-low border border-outline-variant/25 space-y-2"
                >
                  <div className="h-3 w-16 bg-surface-variant/30 rounded" />
                  <div className="h-4 w-24 bg-surface-variant/45 rounded" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// WORKBENCH FORM SKELETON: Dedicated skeleton for AddBookView & SpruceUpView
export function WorkbenchFormSkeleton({
  variant = 'add-book',
  isWarm = false,
  cachedLibrary,
  cachedBooks = [],
  currentUserId,
  isReadingShelf = false,
}: WarmSkeletonContextProps & {
  variant?: 'add-book' | 'spruce-up';
}) {
  const showRealHeader = Boolean(isWarm && cachedLibrary);
  const title =
    variant === 'spruce-up' ? 'Shelf Care & Metadata Audit' : 'Add Books';

  return (
    <div
      data-testid={`workbench-form-skeleton-${variant}`}
      className="flex-grow flex flex-col min-h-screen w-full bg-background"
    >
      {showRealHeader && cachedLibrary ? (
        <LibraryHeader
          library={cachedLibrary}
          books={cachedBooks}
          isOwner={Boolean(
            currentUserId && cachedLibrary.ownerId === currentUserId,
          )}
        />
      ) : !isWarm && !isReadingShelf ? (
        <LibraryHeaderSkeleton />
      ) : null}

      <div className="layout-page-content py-6 space-y-6">
        {/* Workbench Top Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-surface-container-low border border-outline-variant/40 rounded-xl p-4">
          <div className="flex items-center gap-3">
            {isWarm && (cachedLibrary || isReadingShelf) ? (
              <Link
                to={cachedLibrary ? `/library/${cachedLibrary.id}` : '/'}
                className="inline-flex items-center gap-1.5 text-xs font-sans font-medium text-on-surface-variant hover:text-on-surface px-2.5 py-1.5 rounded-lg bg-surface border border-outline-variant/40"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>
                  {cachedLibrary
                    ? toTitleCase(cachedLibrary.name)
                    : 'Reading Shelf'}
                </span>
              </Link>
            ) : (
              <div className="h-8 w-28 bg-surface-variant/40 rounded-lg animate-pulse" />
            )}
            <div className="flex items-center gap-2 text-on-surface font-sans font-semibold text-sm">
              {variant === 'spruce-up' ? (
                <Wand2 className="w-4 h-4 text-primary" />
              ) : (
                <Plus className="w-4 h-4 text-primary" />
              )}
              <span>{title}</span>
            </div>
          </div>

          <div className="flex items-center gap-2 animate-pulse">
            <div className="h-8 w-24 bg-surface-container rounded-lg border border-outline-variant/30" />
            <div className="h-8 w-28 bg-surface-container rounded-lg border border-outline-variant/30" />
          </div>
        </div>

        {/* Workbench Content Panels */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-pulse">
          <div className="lg:col-span-5 bg-surface border border-outline-variant/30 rounded-xl p-6 space-y-4 min-h-[320px]">
            <div className="h-5 w-40 bg-surface-variant/40 rounded" />
            <div className="h-4 w-64 bg-surface-variant/25 rounded" />
            <div className="h-44 w-full bg-surface-container-low border border-dashed border-outline-variant/40 rounded-lg" />
            <div className="h-10 w-full bg-surface-container-high rounded-lg" />
          </div>
          <div className="lg:col-span-7 bg-surface border border-outline-variant/30 rounded-xl p-6 space-y-4 min-h-[320px]">
            <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
              <div className="h-5 w-36 bg-surface-variant/40 rounded" />
              <div className="h-4 w-20 bg-surface-variant/25 rounded" />
            </div>
            {[1, 2, 3].map(row => (
              <div
                key={row}
                className="flex items-center gap-4 p-3 rounded-lg bg-surface-container-low border border-outline-variant/20"
              >
                <div className="w-10 h-14 bg-surface-container-high rounded shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/3 bg-surface-variant/40 rounded" />
                  <div className="h-3 w-1/3 bg-surface-variant/25 rounded" />
                </div>
                <div className="h-8 w-20 bg-surface-container rounded-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface LibraryMainSkeletonProps extends WarmSkeletonContextProps {
  tab?: 'overview' | 'collection';
  viewType?: LibrarySkeletonViewType;
}

// MAIN skeleton page that seamlessly pieces together Header, Tabs, and Content
// When `isWarm` and `cachedLibrary` are present, keeps the real LibraryHeader and WarmLibraryTabsBar
// and only skeletonizes the content region below.
export function LibraryMainSkeleton({
  tab = 'overview',
  viewType,
  isWarm = false,
  cachedLibrary,
  cachedBooks = [],
  currentUserId,
  isReadingShelf = false,
}: LibraryMainSkeletonProps) {
  const resolvedView: LibrarySkeletonViewType = viewType || tab;

  if (resolvedView === 'constellation' || resolvedView === 'world-map') {
    return (
      <SpatialMapSkeleton
        variant={resolvedView}
        isWarm={isWarm}
        cachedLibrary={cachedLibrary}
        cachedBooks={cachedBooks}
        currentUserId={currentUserId}
        isReadingShelf={isReadingShelf}
      />
    );
  }

  if (resolvedView === 'timeline') {
    return (
      <TimelineViewSkeleton
        isWarm={isWarm}
        cachedLibrary={cachedLibrary}
        cachedBooks={cachedBooks}
        currentUserId={currentUserId}
        isReadingShelf={isReadingShelf}
      />
    );
  }

  if (resolvedView === 'book-details') {
    return (
      <BookDetailsSkeleton
        isWarm={isWarm}
        cachedLibrary={cachedLibrary}
        cachedBooks={cachedBooks}
        currentUserId={currentUserId}
        isReadingShelf={isReadingShelf}
      />
    );
  }

  if (resolvedView === 'add-book' || resolvedView === 'spruce-up') {
    return (
      <WorkbenchFormSkeleton
        variant={resolvedView}
        isWarm={isWarm}
        cachedLibrary={cachedLibrary}
        cachedBooks={cachedBooks}
        currentUserId={currentUserId}
        isReadingShelf={isReadingShelf}
      />
    );
  }

  const showRealHeader = Boolean(isWarm && cachedLibrary);
  const activeTab = resolvedView === 'collection' ? 'collection' : 'overview';

  return (
    <div
      data-testid="library-main-skeleton"
      data-warm={showRealHeader ? 'true' : 'false'}
      className="flex-grow flex flex-col min-h-screen w-full"
    >
      <div className="flex-1 flex flex-col min-w-0">
        {showRealHeader && cachedLibrary ? (
          <>
            <LibraryHeader
              library={cachedLibrary}
              books={cachedBooks}
              isOwner={Boolean(
                currentUserId && cachedLibrary.ownerId === currentUserId,
              )}
            />
            <WarmLibraryTabsBar
              activeTab={activeTab}
              cachedLibrary={cachedLibrary}
              cachedBooks={cachedBooks}
            />
          </>
        ) : (
          <>
            <LibraryHeaderSkeleton />
            <LibraryTabsSkeleton />
          </>
        )}
        <div className="pt-4">
          {activeTab === 'overview' ? (
            <LibraryOverviewSkeleton />
          ) : (
            <LibraryCollectionSkeleton />
          )}
        </div>
      </div>
    </div>
  );
}

// DASHBOARD skeleton page that matches the Dashboard layout, header, and library cards
export function DashboardMainSkeleton() {
  return (
    <div
      data-testid="dashboard-main-skeleton"
      className="flex-1 flex flex-col min-w-0 h-full w-full"
    >
      <div className="layout-page-content animate-pulse">
        {/* Header matching Dashboard.tsx */}
        <div className="layout-header border-none pb-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-2">
            <div className="h-8 sm:h-9 bg-surface-variant/50 rounded-lg w-44" />
            <div className="h-4 bg-surface-variant/30 rounded w-72 sm:w-96 max-w-full" />
          </div>
          <div className="h-[42px] w-36 bg-surface-variant/40 rounded-xl self-start sm:self-auto shrink-0" />
        </div>

        {/* 2-column cards grid matching LibraryCard anatomy exactly */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mt-2">
          {[1, 2, 3, 4].map(i => (
            <div
              key={i}
              className="bg-surface-container-low rounded-lg overflow-hidden border border-outline-variant/30 shadow-elevation-1 flex flex-col h-full"
            >
              <div className="h-44 w-full bg-surface-variant/40" />
              <div className="p-6 flex flex-col flex-grow justify-between bg-surface-container-lowest">
                <div className="h-7 bg-surface-variant/50 rounded w-2/3 mb-6" />
                <div className="flex items-center justify-between mt-auto pt-2">
                  <div className="h-4 bg-surface-variant/40 rounded w-24" />
                  <div className="h-5 bg-surface-variant/30 rounded-sm w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
