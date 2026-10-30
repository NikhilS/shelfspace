import React, {useState, useRef, useMemo} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  Sparkles,
  RefreshCw,
  Plus,
  Check,
  Loader2,
  ChevronLeft,
  ChevronRight,
  BookOpen,
  Play,
  Library as LibraryIcon,
} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {BookLoader} from './BookLoader';
import {ArchivalCoverImage} from './ArchivalCoverImage';
import {ExLibrisStampIllustration} from '@/components/ui/empty-state-illustrations';
import {BookSwipeDeck, type BookSwipeDeckHandle} from './BookSwipeDeck';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import type {
  BookRecommendationItem,
  RecommendationCategoryFilter,
} from '../../schemas/recommendation';
import type {TrackedShelfStatus} from '../../server/services/readingTracker';

export interface SuggestedNextReadsCardProps {
  recommendations: BookRecommendationItem[];
  allRecommendations?: BookRecommendationItem[];
  activeFilter: RecommendationCategoryFilter;
  onFilterChange: (filter: RecommendationCategoryFilter) => void;
  isLoading?: boolean;
  isRefreshing?: boolean;
  onRefresh: () => void;
  onAddExternalToWantToRead?: (
    item: BookRecommendationItem,
  ) => Promise<void> | void;
  onUpdateShelfBookStatus?: (
    libraryId: string,
    bookId: string,
    status: TrackedShelfStatus,
  ) => Promise<void> | void;
  onTrackBook?: () => void;
  trackedTitleKeys?: Set<string>;
  className?: string;
}

const FILTER_TABS: Array<{
  id: RecommendationCategoryFilter;
  label: string;
}> = [
  {id: 'all', label: 'All Suggestions'},
  {id: 'discover', label: 'New Discoveries'},
  {id: 'from_shelves', label: 'On Your Shelves'},
  {id: 'series_and_authors', label: 'Series & Authors'},
];

function getSourceBadgeLabel(item: BookRecommendationItem): string {
  if (item.source === 'ai_curator') {
    return 'Curated Discovery';
  }
  if (item.source === 'catalog_graph') {
    return item.matchTag.startsWith('Next in ')
      ? 'Series Continuation'
      : 'Author Backlist';
  }
  return 'In Your Library';
}

export function SuggestedNextReadsCard({
  recommendations,
  allRecommendations,
  activeFilter,
  onFilterChange,
  isLoading = false,
  isRefreshing = false,
  onRefresh,
  onAddExternalToWantToRead,
  onUpdateShelfBookStatus,
  onTrackBook,
  trackedTitleKeys,
  className = '',
}: SuggestedNextReadsCardProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const deckRef = useRef<BookSwipeDeckHandle | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [savingItemIds, setSavingItemIds] = useState<Set<string>>(new Set());
  const [savedWantToReadIds, setSavedWantToReadIds] = useState<Set<string>>(
    new Set(),
  );
  const [startedReadingIds, setStartedReadingIds] = useState<Set<string>>(
    new Set(),
  );

  const safeIndex = selectedIndex < recommendations.length ? selectedIndex : 0;
  const displayedIndex =
    previewIndex !== null && previewIndex < recommendations.length
      ? previewIndex
      : safeIndex;
  const activeItem = recommendations[safeIndex] || null;

  const itemIds = useMemo(
    () => recommendations.map(item => item.id),
    [recommendations],
  );

  const totalCount = (allRecommendations ?? recommendations).length;

  const isItemAlreadyWantToRead = (item: BookRecommendationItem): boolean => {
    if (
      savedWantToReadIds.has(item.id) ||
      item.readingStatus === 'want_to_read'
    ) {
      return true;
    }
    const key = `${item.title.toLowerCase().trim()}::${item.author.toLowerCase().trim()}`;
    return Boolean(trackedTitleKeys?.has(key));
  };

  const handleFilterSelect = (filter: RecommendationCategoryFilter) => {
    setSelectedIndex(0);
    setPreviewIndex(null);
    onFilterChange(filter);
  };

  const handleSaveWantToRead = async (item: BookRecommendationItem) => {
    if (savingItemIds.has(item.id) || isItemAlreadyWantToRead(item)) {
      return;
    }
    setSavingItemIds(prev => new Set(prev).add(item.id));
    try {
      if (
        item.source === 'shelf' &&
        item.libraryId &&
        item.bookId &&
        onUpdateShelfBookStatus
      ) {
        await onUpdateShelfBookStatus(
          item.libraryId,
          item.bookId,
          'want_to_read',
        );
      } else if (onAddExternalToWantToRead) {
        await onAddExternalToWantToRead(item);
      }
      setSavedWantToReadIds(prev => new Set(prev).add(item.id));
    } finally {
      setSavingItemIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const handleStartReadingShelfBook = async (item: BookRecommendationItem) => {
    if (
      !item.libraryId ||
      !item.bookId ||
      !onUpdateShelfBookStatus ||
      savingItemIds.has(item.id) ||
      startedReadingIds.has(item.id)
    ) {
      return;
    }
    setSavingItemIds(prev => new Set(prev).add(item.id));
    try {
      await onUpdateShelfBookStatus(item.libraryId, item.bookId, 'reading');
      setStartedReadingIds(prev => new Set(prev).add(item.id));
    } finally {
      setSavingItemIds(prev => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  };

  const openLibraryBook = (item: BookRecommendationItem) => {
    if (!item.libraryId || !item.bookId) {
      return;
    }
    void navigate(
      `/library/${encodeURIComponent(item.libraryId)}/book/${encodeURIComponent(item.bookId)}`,
      {state: {from: '/'}},
    );
  };

  const renderRecommendationSlide = (item: BookRecommendationItem) => {
    const isShelfBook =
      item.source === 'shelf' && Boolean(item.libraryId && item.bookId);
    const isSaving = savingItemIds.has(item.id);
    const isSavedTbr = isItemAlreadyWantToRead(item);
    const isStartedReading = startedReadingIds.has(item.id);

    return (
      <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 items-center sm:items-start py-1">
        {/* Book Cover */}
        <div
          onClick={isShelfBook ? () => openLibraryBook(item) : undefined}
          className={`w-24 sm:w-28 aspect-[2/3] shrink-0 rounded-lg book-cover-shadow border border-outline-variant/60 overflow-hidden relative ${
            isShelfBook ? 'cursor-pointer group' : ''
          }`}
        >
          <ArchivalCoverImage
            src={item.coverUrl}
            alt={item.title}
            author={item.author}
            variant="compact"
            draggable={false}
            showSpineHighlight={true}
            className="w-full h-full"
            imgClassName="group-hover:scale-[1.03] transition-transform duration-300 select-none"
          />
        </div>

        {/* Editorial Recommendation Details */}
        <div className="flex-1 min-w-0 text-center sm:text-left">
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mb-1.5">
            <Badge
              variant="outline"
              size="sm"
              className="rounded px-2 py-0.5 text-[11px] font-sans font-semibold bg-surface-container-high/80 text-primary border-outline-variant/60"
            >
              {item.matchTag}
            </Badge>
            <span className="text-[11px] font-sans text-on-surface-variant">
              {getSourceBadgeLabel(item)}
            </span>
            {item.primaryGenre && (
              <>
                <span
                  aria-hidden="true"
                  className="text-xs text-on-surface-variant"
                >
                  ·
                </span>
                <span className="text-xs font-sans text-on-surface-variant">
                  {item.primaryGenre}
                </span>
              </>
            )}
          </div>

          <h3
            onClick={isShelfBook ? () => openLibraryBook(item) : undefined}
            className={`font-serif text-lg sm:text-xl font-semibold tracking-tight text-primary line-clamp-1 ${
              isShelfBook ? 'hover:underline cursor-pointer' : ''
            }`}
          >
            {toTitleCase(item.title)}
          </h3>
          <p className="font-sans text-xs sm:text-sm text-on-surface-variant mt-0.5">
            {toTitleCase(item.author)}
            {item.series ? ` · ${item.series}` : ''}
            {item.libraryName ? ` · ${toTitleCase(item.libraryName)}` : ''}
          </p>

          <div className="mt-2.5 pt-2.5 border-t border-outline-variant/40 text-left">
            <p className="font-serif text-xs sm:text-sm text-on-surface leading-relaxed italic line-clamp-2">
              &ldquo;{item.reason}&rdquo;
            </p>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center justify-center sm:justify-start gap-2">
            {isShelfBook && onUpdateShelfBookStatus && (
              <Button
                type="button"
                size="sm"
                disabled={!isOnline || isSaving || isStartedReading}
                title={!isOnline ? 'Unavailable while offline' : undefined}
                onClick={() => void handleStartReadingShelfBook(item)}
                className="h-8 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
              >
                {isStartedReading ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Reading Now</span>
                  </>
                ) : (
                  <>
                    <Play className="w-3 h-3 fill-current" />
                    <span>Start Reading</span>
                  </>
                )}
              </Button>
            )}

            <Button
              type="button"
              size="sm"
              variant={isSavedTbr || isShelfBook ? 'outline' : 'default'}
              disabled={!isOnline || isSaving || isSavedTbr}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={() => void handleSaveWantToRead(item)}
              className="h-8 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
            >
              {isSaving ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : isSavedTbr ? (
                <>
                  <Check className="w-3.5 h-3.5 text-primary" />
                  <span>On Want-to-Read Shelf</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Want to Read</span>
                </>
              )}
            </Button>

            {isShelfBook && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => openLibraryBook(item)}
                className="h-8 px-3 rounded-lg font-sans text-xs font-semibold text-on-surface-variant hover:text-primary gap-1.5"
              >
                <LibraryIcon className="w-3.5 h-3.5" />
                <span>View in Library</span>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      data-testid="suggested-next-reads-card"
      className={`bento-card bg-gradient-to-br from-surface-container-low/80 to-surface p-5 sm:p-6 relative overflow-hidden flex flex-col justify-between ${className}`}
    >
      <div className="absolute -top-1 -right-1 pointer-events-none opacity-20">
        <ExLibrisStampIllustration className="w-16 h-14" />
      </div>

      {/* Header + Filter Bar + Stepper */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4 z-10">
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="metadata-eyebrow flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            <span>Suggested Next Reads</span>
          </span>
          {totalCount > 0 && (
            <span className="font-mono tabular-nums text-xs text-on-surface-variant">
              ({recommendations.length})
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Category Filter Tabs */}
          <div
            className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/50 overflow-x-auto hide-scrollbar"
            role="tablist"
            aria-label="Filter book suggestions"
          >
            {FILTER_TABS.map(tab => {
              const isActive = activeFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleFilterSelect(tab.id)}
                  className={`px-2.5 py-1 rounded text-xs font-sans font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-surface text-primary font-semibold shadow-2xs'
                      : 'text-on-surface-variant hover:text-on-surface'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          {/* Stepper (1 / N) + Refresh */}
          <div className="flex items-center gap-1.5">
            {recommendations.length > 1 && (
              <div
                data-testid="suggestions-stepper"
                className="inline-flex items-center gap-1 rounded-lg border border-outline-variant/60 bg-surface-container-low px-1 py-0.5"
              >
                <button
                  type="button"
                  data-testid="suggestions-prev"
                  aria-label="Previous book suggestion"
                  disabled={displayedIndex <= 0}
                  onClick={() => deckRef.current?.slidePrev()}
                  className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span
                  data-testid="suggestions-step-indicator"
                  className="font-mono text-[11px] font-semibold text-on-surface tabular-nums px-1 select-none"
                >
                  {displayedIndex + 1} / {recommendations.length}
                </span>
                <button
                  type="button"
                  data-testid="suggestions-next"
                  aria-label="Next book suggestion"
                  disabled={displayedIndex >= recommendations.length - 1}
                  onClick={() => deckRef.current?.slideNext()}
                  className="w-6 h-6 rounded flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
                >
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={!isOnline || isRefreshing}
              onClick={onRefresh}
              title={
                !isOnline
                  ? 'Unavailable while offline'
                  : 'Refresh book suggestions'
              }
              aria-label="Refresh book suggestions"
              className="w-8 h-8 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-primary disabled:opacity-40"
            >
              <RefreshCw
                size={15}
                strokeWidth={1.6}
                className={isRefreshing ? 'animate-spin' : ''}
              />
            </Button>
          </div>
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="w-full flex flex-col items-center justify-center gap-3 py-8 z-10">
          <BookLoader size="sm" />
          <p className="font-sans text-xs text-on-surface-variant animate-pulse">
            Curating next reads from your reading history and shelves...
          </p>
        </div>
      ) : !activeItem ? (
        <div className="w-full flex flex-col items-center justify-center gap-2 py-6 text-center z-10 px-4">
          <ExLibrisStampIllustration className="w-14 h-12 mb-0.5" />
          <p className="font-serif text-base sm:text-lg font-semibold text-on-surface">
            {activeFilter === 'from_shelves'
              ? 'No Unread Books Waiting on Your Shelves'
              : activeFilter === 'series_and_authors'
                ? 'No Unfinished Series or Author Backlists Found Yet'
                : 'Ready to Curate Your Next Read'}
          </p>
          <p className="font-sans text-xs text-on-surface-variant max-w-md">
            {activeFilter !== 'all' && totalCount > 0
              ? 'Switch back to All Suggestions to browse every curated recommendation.'
              : 'Track a few books you have read or enjoyed, and we will weave together new discoveries, series continuations, and unread gems from your shelves.'}
          </p>
          <div className="mt-2 flex items-center gap-2">
            {activeFilter !== 'all' && totalCount > 0 ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => handleFilterSelect('all')}
                className="h-8 px-3.5 rounded-lg text-xs font-semibold"
              >
                Show All Suggestions ({totalCount})
              </Button>
            ) : (
              onTrackBook && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isOnline}
                  onClick={onTrackBook}
                  className="h-8 px-3.5 rounded-lg text-xs font-semibold gap-1.5"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>Track Books You&apos;ve Read</span>
                </Button>
              )
            )}
          </div>
        </div>
      ) : (
        <div className="z-10 flex flex-col gap-3">
          {recommendations.length > 1 ? (
            <>
              <BookSwipeDeck
                ref={deckRef}
                bookIds={itemIds}
                activeIndex={safeIndex}
                autoHeight
                enablePointerDrag
                onIndexPreview={nextIdx => setPreviewIndex(nextIdx)}
                onIndexCommit={committedIdx => {
                  setPreviewIndex(null);
                  setSelectedIndex(committedIdx);
                }}
                renderSlide={({index}) => {
                  const slideItem = recommendations[index] || activeItem;
                  return renderRecommendationSlide(slideItem);
                }}
              />

              {/* Synchronized Pill Strip */}
              <div
                data-testid="suggestions-pill-strip"
                className="flex items-center gap-1.5 pt-2 border-t border-outline-variant/40 overflow-x-auto hide-scrollbar"
                role="tablist"
                aria-label="Select book recommendation"
              >
                {recommendations.map((rec, idx) => {
                  const isActive = idx === displayedIndex;
                  return (
                    <button
                      key={rec.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => {
                        setPreviewIndex(null);
                        setSelectedIndex(idx);
                      }}
                      className={`px-2.5 py-1 rounded text-[11px] font-sans font-medium truncate max-w-[160px] transition-colors cursor-pointer shrink-0 ${
                        isActive
                          ? 'bg-primary/12 text-primary font-semibold border border-primary/30'
                          : 'bg-surface-container-low text-on-surface-variant hover:text-on-surface border border-transparent'
                      }`}
                    >
                      {toTitleCase(rec.title)}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            renderRecommendationSlide(activeItem)
          )}
        </div>
      )}
    </div>
  );
}
