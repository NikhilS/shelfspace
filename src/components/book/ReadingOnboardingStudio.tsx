import React, {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  BookOpen,
  Check,
  Sparkles,
  Plus,
  Layers,
  Camera,
  Compass,
  X,
  ArrowRight,
  Play,
  Loader2,
} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {
  NightstandBookIllustration,
  ShelfViewfinderIllustration,
  BedsideStackIllustration,
} from '@/components/ui/empty-state-illustrations';
import {ArchivalCoverImage} from './ArchivalCoverImage';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import type {
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../../server/services/readingTracker';

export interface ReadingOnboardingStudioProps {
  unreadLibraryBooks?: UnreadLibraryBookItem[];
  librariesCount?: number;
  primaryLibraryId?: string;
  onTrackBook: (
    defaultShelf: 'want_to_read' | 'reading' | 'finished' | 'abandoned',
  ) => void;
  onCreateLibrary?: () => void;
  onStatusChange?: (
    libraryId: string,
    bookId: string,
    newStatus: TrackedShelfStatus | 'unset',
  ) => Promise<void>;
}

export function ReadingOnboardingStudio({
  unreadLibraryBooks = [],
  librariesCount = 0,
  primaryLibraryId,
  onTrackBook,
  onCreateLibrary,
  onStatusChange,
}: ReadingOnboardingStudioProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [updatingBookState, setUpdatingBookState] = useState<
    'reading' | 'finished' | null
  >(null);

  const featuredUnreadBook = unreadLibraryBooks[0] ?? null;
  const swipeTargetLibraryId =
    featuredUnreadBook?.libraryId || primaryLibraryId || null;
  const hasAccessibleLibraries =
    unreadLibraryBooks.length > 0 ||
    librariesCount > 0 ||
    Boolean(swipeTargetLibraryId);

  const handleQuickShelfStatus = async (
    book: UnreadLibraryBookItem,
    nextStatus: 'reading' | 'finished',
  ) => {
    if (!onStatusChange || !isOnline || updatingBookState) {
      return;
    }
    setUpdatingBookState(nextStatus);
    try {
      await onStatusChange(book.libraryId, book.id, nextStatus);
    } finally {
      setUpdatingBookState(null);
    }
  };

  return (
    <section
      aria-label="Getting Started with Your Reading Room"
      data-testid="reading-onboarding-studio"
      className="bento-card p-6 sm:p-8 space-y-7 bg-gradient-to-br from-surface-container-low/80 via-surface to-surface"
    >
      {/* Studio Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pb-6 border-b border-outline-variant/50">
        <div className="flex items-start gap-4">
          <div className="hidden sm:flex w-16 h-16 rounded-xl bg-surface-container border border-outline-variant/50 items-center justify-center shrink-0">
            <NightstandBookIllustration className="w-13 h-11" />
          </div>
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="metadata-eyebrow">
                Getting Started · Your Reading Room
              </span>
              <Badge
                variant="outline"
                size="sm"
                className="font-mono tabular-nums text-[10px] font-semibold bg-primary/10 text-primary border-primary/25 rounded"
              >
                0 Books Tracked
              </Badge>
            </div>
            <h2 className="font-serif text-xl sm:text-2xl font-semibold tracking-tight text-on-surface">
              Welcome to Your Reading Room
            </h2>
            <p className="font-sans text-xs sm:text-sm text-on-surface-variant max-w-2xl leading-relaxed">
              Your Reading Room tracks every book you read, want to read, or
              already love—whether it sits on your home shelves or was borrowed
              from a friend. Choose any starting path below to unlock tailored
              recommendations and interactive literary maps.
            </p>
          </div>
        </div>
      </div>

      {/* 3 Quick-Start Action Paths */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-5 items-stretch">
        {/* Path 1: Search & Track a Current or Favorite Read */}
        <div
          data-testid="onboarding-path-track-book"
          className="flex flex-col justify-between p-5 rounded-xl bg-surface border border-outline-variant/50 space-y-4"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-primary font-semibold tabular-nums">
                01 · Search &amp; Track
              </span>
              <NightstandBookIllustration className="w-11 h-9 shrink-0" />
            </div>
            <h3 className="font-serif text-base sm:text-lg font-semibold text-on-surface">
              Track a Current or Favorite Read
            </h3>
            <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
              Search for the book on your nightstand right now or log a favorite
              book you&apos;ve already finished to seed your personal taste
              profile.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={() => onTrackBook('reading')}
              className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Track Current Read</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={() => onTrackBook('finished')}
              className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5 text-primary" />
              <span>Log a Finished Book</span>
            </Button>
          </div>
        </div>

        {/* Path 2: Adaptive — Swipe Through Library Shelves OR Create a Home Library */}
        {hasAccessibleLibraries ? (
          <div
            data-testid="onboarding-path-swipe-libraries"
            className="flex flex-col justify-between p-5 rounded-xl bg-surface border border-outline-variant/50 space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-primary font-semibold tabular-nums">
                  02 · From Your Libraries
                </span>
                {unreadLibraryBooks.length > 0 && (
                  <Badge
                    variant="outline"
                    size="sm"
                    className="font-mono tabular-nums text-[10px] font-semibold bg-surface-container text-on-surface-variant border-outline-variant/50"
                  >
                    {unreadLibraryBooks.length} Unread on Shelves
                  </Badge>
                )}
              </div>
              <h3 className="font-serif text-base sm:text-lg font-semibold text-on-surface">
                Swipe Through Library Shelves
              </h3>
              <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                {unreadLibraryBooks.length > 0
                  ? 'Quickly sort through books in your owned or shared libraries to mark the ones you have already read or want to read next.'
                  : 'Browse your accessible libraries to mark books you have read or start a new volume from your shelves.'}
              </p>

              {featuredUnreadBook && (
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/40 flex items-center gap-3">
                  <div
                    onClick={() =>
                      void navigate(
                        `/library/${encodeURIComponent(featuredUnreadBook.libraryId)}/book/${encodeURIComponent(featuredUnreadBook.id)}`,
                        {state: {from: '/'}},
                      )
                    }
                    className="w-10 aspect-[2/3] rounded overflow-hidden shrink-0 border border-outline-variant/50 book-cover-shadow cursor-pointer"
                  >
                    <ArchivalCoverImage
                      src={featuredUnreadBook.coverUrl}
                      alt={featuredUnreadBook.title}
                      author={featuredUnreadBook.author}
                      variant="thumb"
                      className="w-full h-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      onClick={() =>
                        void navigate(
                          `/library/${encodeURIComponent(featuredUnreadBook.libraryId)}/book/${encodeURIComponent(featuredUnreadBook.id)}`,
                          {state: {from: '/'}},
                        )
                      }
                      className="font-serif text-xs font-semibold text-on-surface truncate hover:text-primary cursor-pointer"
                    >
                      {toTitleCase(featuredUnreadBook.title)}
                    </p>
                    <p className="font-sans text-[11px] text-on-surface-variant truncate">
                      {toTitleCase(featuredUnreadBook.author)}
                      {featuredUnreadBook.libraryName
                        ? ` · ${toTitleCase(featuredUnreadBook.libraryName)}`
                        : ''}
                    </p>
                    {onStatusChange && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={!isOnline || Boolean(updatingBookState)}
                          title={
                            !isOnline ? 'Unavailable while offline' : undefined
                          }
                          onClick={() =>
                            void handleQuickShelfStatus(
                              featuredUnreadBook,
                              'finished',
                            )
                          }
                          className="px-2 py-0.5 rounded text-[10px] font-sans font-semibold bg-surface hover:bg-primary/10 text-primary border border-outline-variant/50 transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {updatingBookState === 'finished' ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Check className="w-2.5 h-2.5" />
                          )}
                          <span>I&apos;ve Read This</span>
                        </button>
                        <button
                          type="button"
                          disabled={!isOnline || Boolean(updatingBookState)}
                          title={
                            !isOnline ? 'Unavailable while offline' : undefined
                          }
                          onClick={() =>
                            void handleQuickShelfStatus(
                              featuredUnreadBook,
                              'reading',
                            )
                          }
                          className="px-2 py-0.5 rounded text-[10px] font-sans font-semibold bg-surface hover:bg-surface-container text-on-surface-variant hover:text-on-surface border border-outline-variant/50 transition-colors cursor-pointer disabled:opacity-50 inline-flex items-center gap-1"
                        >
                          {updatingBookState === 'reading' ? (
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                          ) : (
                            <Play className="w-2.5 h-2.5 fill-current" />
                          )}
                          <span>Read Now</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-2">
              {swipeTargetLibraryId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    void navigate(
                      `/library/${encodeURIComponent(swipeTargetLibraryId)}/swipe`,
                    )
                  }
                  className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5"
                >
                  <Layers className="w-3.5 h-3.5 text-primary" />
                  <span>Swipe Through Shelves</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div
            data-testid="onboarding-path-create-library"
            className="flex flex-col justify-between p-5 rounded-xl bg-surface border border-outline-variant/50 space-y-4"
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-primary font-semibold tabular-nums">
                  02 · Home Library
                </span>
                <ShelfViewfinderIllustration className="w-11 h-9 shrink-0" />
              </div>
              <h3 className="font-serif text-base sm:text-lg font-semibold text-on-surface">
                Create a Home Library via Photo or Search
              </h3>
              <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                Catalog your physical bookshelves in seconds by snapping a
                bookshelf photo, scanning ISBN barcodes, or searching by title,
                and optionally share it with family.
              </p>
            </div>

            <div className="pt-2 flex flex-wrap items-center gap-2">
              {onCreateLibrary ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isOnline}
                  title={!isOnline ? 'Unavailable while offline' : undefined}
                  onClick={onCreateLibrary}
                  className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
                >
                  <Camera className="w-3.5 h-3.5 text-primary" />
                  <span>Create a Home Library</span>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!isOnline}
                  title={!isOnline ? 'Unavailable while offline' : undefined}
                  onClick={() => onTrackBook('finished')}
                  className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
                >
                  <Plus className="w-3.5 h-3.5 text-primary" />
                  <span>Add Your First Book</span>
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Path 3: Curate Your Want-to-Read Queue */}
        <div
          data-testid="onboarding-path-want-to-read"
          className="flex flex-col justify-between p-5 rounded-xl bg-surface border border-outline-variant/50 space-y-4"
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] uppercase tracking-wider text-primary font-semibold tabular-nums">
                03 · Up Next Queue
              </span>
              <BedsideStackIllustration className="w-11 h-9 shrink-0" />
            </div>
            <h3 className="font-serif text-base sm:text-lg font-semibold text-on-surface">
              Build Your Want-to-Read List
            </h3>
            <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
              Save books recommended by friends or titles you want to pick up
              soon so your next great read is always waiting when you finish a
              book.
            </p>
          </div>

          <div className="pt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={() => onTrackBook('want_to_read')}
              className="h-9 px-3.5 rounded-lg font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5 text-primary" />
              <span>Add to Want to Read</span>
            </Button>
          </div>
        </div>
      </div>

      {/* Progressive Unlocks Preview Strip */}
      <div className="pt-5 border-t border-outline-variant/50 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="metadata-eyebrow flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-primary" />
            <span>What Unlocks as You Add Books</span>
          </span>
          <span className="hidden sm:inline font-mono text-[11px] text-on-surface-variant tabular-nums">
            Progressive Reading Room Milestones
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
          <div className="p-3.5 rounded-lg bg-surface-container-low/80 border border-outline-variant/40 flex items-start gap-3">
            <span className="font-mono tabular-nums text-xs font-semibold text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/20 shrink-0">
              1 Book
            </span>
            <div className="min-w-0">
              <h4 className="font-serif text-xs sm:text-sm font-semibold text-on-surface">
                Suggested Reads, Timeline &amp; World Map
              </h4>
              <p className="font-sans text-[11px] text-on-surface-variant leading-snug mt-0.5">
                Unlocks personalized book suggestions plus historical eras and
                real-world story settings.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-container-low/80 border border-outline-variant/40 flex items-start gap-3">
            <span className="font-mono tabular-nums text-xs font-semibold text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/20 shrink-0">
              1 Read
            </span>
            <div className="min-w-0">
              <h4 className="font-serif text-xs sm:text-sm font-semibold text-on-surface">
                3D Read Stack &amp; Genre Breakdown
              </h4>
              <p className="font-sans text-[11px] text-on-surface-variant leading-snug mt-0.5">
                Builds your interactive bedside stack of finished books and
                charts your favorite genres.
              </p>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-surface-container-low/80 border border-outline-variant/40 flex items-start gap-3">
            <span className="font-mono tabular-nums text-xs font-semibold text-primary px-2 py-0.5 rounded bg-primary/10 border border-primary/20 shrink-0">
              3+ Books
            </span>
            <div className="min-w-0">
              <h4 className="font-serif text-xs sm:text-sm font-semibold text-on-surface">
                3D Thematic Constellations
              </h4>
              <p className="font-sans text-[11px] text-on-surface-variant leading-snug mt-0.5">
                Maps connected thematic clusters and literary neighborhoods
                across your reading life.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export interface ReadingOnboardingBannerProps {
  totalTrackedCount: number;
  readingCount: number;
  finishedCount: number;
  unreadLibraryCount: number;
  primaryLibraryId?: string;
  onTrackBook: (
    defaultShelf: 'want_to_read' | 'reading' | 'finished' | 'abandoned',
  ) => void;
}

const BANNER_DISMISS_STORAGE_KEY = 'bookish_reading_onboarding_dismissed';

export function ReadingOnboardingBanner({
  totalTrackedCount,
  finishedCount,
  unreadLibraryCount,
  primaryLibraryId,
  onTrackBook,
}: ReadingOnboardingBannerProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(BANNER_DISMISS_STORAGE_KEY) === 'true';
    } catch {
      return false;
    }
  });

  if (isDismissed) {
    return null;
  }

  const hasStartedShelf = totalTrackedCount >= 1;
  const hasFinishedBook = finishedCount >= 1;
  const hasUnlockedConstellations = totalTrackedCount >= 3;

  const completedSteps =
    (hasStartedShelf ? 1 : 0) +
    (hasFinishedBook ? 1 : 0) +
    (hasUnlockedConstellations ? 1 : 0);

  if (completedSteps >= 3) {
    return null;
  }

  const remainingForConstellations = Math.max(0, 3 - totalTrackedCount);

  const handleDismiss = () => {
    setIsDismissed(true);
    try {
      localStorage.setItem(BANNER_DISMISS_STORAGE_KEY, 'true');
    } catch {
      // Ignore storage errors in private browsing
    }
  };

  return (
    <div
      data-testid="reading-onboarding-banner"
      className="bento-card p-4 sm:p-5 bg-gradient-to-r from-surface-container-low/90 via-surface to-surface"
    >
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="metadata-eyebrow flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-primary" />
              <span>Reading Room Setup</span>
            </span>
            <Badge
              variant="outline"
              size="sm"
              className="font-mono tabular-nums text-[10px] font-semibold bg-primary/10 text-primary border-primary/25 rounded"
            >
              {completedSteps} of 3 Milestones Complete
            </Badge>
          </div>
          <p className="font-sans text-xs text-on-surface-variant">
            {!hasFinishedBook
              ? 'Log a book you have finished to unlock your Books Read by Genre breakdown and 3D Read Stack.'
              : `Track ${remainingForConstellations} more ${
                  remainingForConstellations === 1 ? 'book' : 'books'
                } to unlock your 3D Thematic Constellations galaxy.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Milestone 1: First Book Tracked */}
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans bg-surface-container text-on-surface-variant border border-outline-variant/40">
            <Check className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>1st Book Tracked</span>
          </div>

          {/* Milestone 2: First Finished Book */}
          {hasFinishedBook ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans bg-surface-container text-on-surface-variant border border-outline-variant/40">
              <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>Genre Breakdown Unlocked</span>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={() => onTrackBook('finished')}
              className="h-7 px-2.5 rounded-md font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-3 h-3 text-primary" />
              <span>Log a Finished Book</span>
            </Button>
          )}

          {/* Milestone 3: 3+ Books for Constellations */}
          {hasUnlockedConstellations ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-sans bg-surface-container text-on-surface-variant border border-outline-variant/40">
              <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>3D Constellations Ready</span>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              onClick={() => onTrackBook('want_to_read')}
              className="h-7 px-2.5 rounded-md font-sans text-xs font-semibold gap-1.5 disabled:opacity-50"
            >
              <Plus className="w-3 h-3 text-primary" />
              <span className="tabular-nums">
                Add {remainingForConstellations} More for 3D Galaxy (
                {Math.min(totalTrackedCount, 3)}/3)
              </span>
            </Button>
          )}

          {unreadLibraryCount > 0 && primaryLibraryId && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() =>
                void navigate(
                  `/library/${encodeURIComponent(primaryLibraryId)}/swipe`,
                )
              }
              className="h-7 px-2.5 rounded-md font-sans text-xs font-semibold text-primary hover:text-primary/80 gap-1"
            >
              <Layers className="w-3 h-3" />
              <span className="tabular-nums">
                Swipe {unreadLibraryCount} Unread
              </span>
            </Button>
          )}

          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss setup guide"
            title="Dismiss setup guide"
            className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
