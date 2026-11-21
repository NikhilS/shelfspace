import React, {useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {toast} from 'sonner';
import {toTitleCase} from '../../lib/utils';
import {
  useReadingShelf,
  type ShelfFilterTab,
} from '../../pages/dashboard/useReadingShelf';
import {
  CurrentlyReadingCard,
  normalizeToTrackedBookItem,
} from './CurrentlyReadingCard';
import {ReadStackCanvasCard} from '../../pages/dashboard/ReadStackCanvasCard';
import {GenreBreakdownCard} from './GenreBreakdownCard';
import {CuratorPickCard, type CuratorPickItem} from './CuratorPickCard';
import {SuggestedNextReadsCard} from './SuggestedNextReadsCard';
import {ExplorePerspectivesStrip} from './ExplorePerspectivesStrip';
import {
  ReadingOnboardingStudio,
  ReadingOnboardingBanner,
} from './ReadingOnboardingStudio';
import {
  computeEligibleUnreadLibraryBooks,
  ReadingBentoWantToReadCard,
} from './ReadingBentoWantToReadCard';
import {usePickOfTheDay} from '../../hooks/usePickOfTheDay';
import {useBookRecommendations} from '../../hooks/useBookRecommendations';
import {navigateWithCoverTransition} from '../../lib/bookCoverTransition';
import type {
  Book,
  TrackedBookItem,
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../../types';
import type {BookRecommendationItem} from '../../schemas/recommendation';

export interface ReadingBentoProps {
  /**
   * Determines whether the Bento renders the user's consolidated personal reading
   * life ('personal-reading') or scopes to tracked books within a specific library ('library').
   * Defaults to 'library' when `libraryId` is provided, otherwise 'personal-reading'.
   */
  mode?: 'personal-reading' | 'library';
  /**
   * Optional library ID to filter tracked books to a specific library collection.
   */
  libraryId?: string;
  /**
   * Optional pre-loaded books or tracked book items. When omitted, `ReadingBento`
   * reads from `useReadingShelf()`.
   */
  books?: Array<Book | TrackedBookItem>;
  /**
   * Optional pre-loaded unread books across all libraries accessible to the user.
   */
  unreadLibraryBooks?: UnreadLibraryBookItem[];
  /**
   * Optional total count of libraries (owned + shared) accessible to the user,
   * used to tailor the Getting Started onboarding studio.
   */
  librariesCount?: number;
  /**
   * Optional primary library ID for quick navigation to the Have You Read It? swipe deck.
   */
  primaryLibraryId?: string;
  /**
   * Optional callback to open the Create Library dialog from the onboarding studio.
   */
  onCreateLibrary?: () => void;
  /**
   * Loading state override when `books` are controlled externally.
   */
  isLoading?: boolean;
  /**
   * Handler invoked when a book's reading status is updated inline.
   */
  onStatusChange?: (
    libraryId: string,
    bookId: string,
    newStatus: TrackedShelfStatus | 'unset',
  ) => Promise<void>;
  /**
   * Opens the Track a Book dialog or Add Book flow with an optional default status shelf.
   */
  onTrackBook?: (
    defaultShelf: 'want_to_read' | 'reading' | 'finished' | 'abandoned',
  ) => void;
  /**
   * Switches to the All Books / Shelf view with an optional status tab and genre filter.
   */
  onOpenShelf?: (tab: ShelfFilterTab, genre?: string | null) => void;
  /**
   * Optional pre-computed Pick of the Day state from parent. When omitted,
   * `ReadingBento` computes its own Pick of the Day from the active reading seed.
   */
  pickOfTheDay?: CuratorPickItem | null;
  isGeneratingPick?: boolean;
  generateNewPick?: () => void;
  pickError?: string | null;
  onAddPickToWantToRead?: (pick: CuratorPickItem) => void;
  isPickAlreadyTracked?: boolean;
  isSavingPick?: boolean;
  /**
   * Optional visibility toggles for the Want-to-Read strip and Exploratory Perspectives strip.
   */
  showWantToReadStrip?: boolean;
  showExplorePerspectives?: boolean;
}

export function ReadingBento({
  mode,
  libraryId,
  books: externalBooks,
  unreadLibraryBooks: externalUnreadLibraryBooks,
  librariesCount = 0,
  primaryLibraryId,
  onCreateLibrary,
  isLoading: externalIsLoading,
  onStatusChange: externalOnStatusChange,
  onTrackBook,
  onOpenShelf,
  pickOfTheDay: externalPick,
  isGeneratingPick: externalIsGeneratingPick,
  generateNewPick: externalGenerateNewPick,
  pickError: externalPickError,
  onAddPickToWantToRead: externalOnAddPick,
  isPickAlreadyTracked: externalIsPickTracked,
  isSavingPick: externalIsSavingPick,
  showWantToReadStrip = true,
  showExplorePerspectives = true,
}: ReadingBentoProps) {
  const navigate = useNavigate();

  const resolvedMode: 'personal-reading' | 'library' =
    mode ?? (libraryId ? 'library' : 'personal-reading');
  const isLibraryScoped = resolvedMode === 'library' && Boolean(libraryId);

  const shouldFetchShelf = externalBooks === undefined;
  const {
    allItems: fetchedItems,
    unreadLibraryBooks: fetchedUnreadLibraryBooks,
    isLoading: isShelfLoading,
    updateItemStatus: shelfUpdateStatus,
    trackBookItem,
  } = useReadingShelf({enabled: shouldFetchShelf});

  const isLoading = externalIsLoading ?? (shouldFetchShelf && isShelfLoading);
  const handleStatusChange = externalOnStatusChange ?? shelfUpdateStatus;

  const scopedItems = useMemo<TrackedBookItem[]>(() => {
    const sourceList = externalBooks ?? fetchedItems;
    const normalized: TrackedBookItem[] = [];

    for (const item of sourceList) {
      const tracked = normalizeToTrackedBookItem(
        item,
        libraryId ? {id: libraryId} : undefined,
      );
      if (!tracked) {
        continue;
      }
      if (isLibraryScoped && libraryId && tracked.libraryId !== libraryId) {
        continue;
      }
      normalized.push(tracked);
    }

    return normalized;
  }, [externalBooks, fetchedItems, libraryId, isLibraryScoped]);

  const readingBooks = useMemo(
    () => scopedItems.filter(item => item.readingStatus === 'reading'),
    [scopedItems],
  );
  const finishedBooks = useMemo(
    () => scopedItems.filter(item => item.readingStatus === 'finished'),
    [scopedItems],
  );
  const wantToReadBooks = useMemo(
    () => scopedItems.filter(item => item.readingStatus === 'want_to_read'),
    [scopedItems],
  );

  const readAndCurrentlyReadingBooks = useMemo(
    () => [...finishedBooks, ...readingBooks],
    [finishedBooks, readingBooks],
  );

  const readingHistorySeed = useMemo(() => {
    return readAndCurrentlyReadingBooks.length > 0
      ? readAndCurrentlyReadingBooks
      : scopedItems;
  }, [readAndCurrentlyReadingBooks, scopedItems]);

  const eligibleUnreadLibraryBooks = useMemo<UnreadLibraryBookItem[]>(
    () =>
      computeEligibleUnreadLibraryBooks({
        isLibraryScoped,
        scopedItems,
        rawUnreadLibraryBooks:
          externalUnreadLibraryBooks ?? fetchedUnreadLibraryBooks ?? [],
        sourceList: externalBooks ?? fetchedItems,
      }),
    [
      isLibraryScoped,
      scopedItems,
      externalUnreadLibraryBooks,
      fetchedUnreadLibraryBooks,
      externalBooks,
      fetchedItems,
    ],
  );

  const [selectedUnreadBookKey, setSelectedUnreadBookKey] = useState<
    string | null
  >(null);
  const [isSavingUnreadPick, setIsSavingUnreadPick] = useState(false);
  const [savedUnreadWantToReadKeys, setSavedUnreadWantToReadKeys] = useState<
    Set<string>
  >(new Set());

  const activeUnreadLibraryBook = useMemo<UnreadLibraryBookItem | null>(() => {
    if (eligibleUnreadLibraryBooks.length === 0) {
      return null;
    }
    if (selectedUnreadBookKey) {
      const matched = eligibleUnreadLibraryBooks.find(
        b => `${b.libraryId}::${b.id}` === selectedUnreadBookKey,
      );
      if (matched) {
        return matched;
      }
    }
    const randomIndex = Math.floor(
      Math.random() * eligibleUnreadLibraryBooks.length,
    );
    return eligibleUnreadLibraryBooks[randomIndex] ?? null;
  }, [eligibleUnreadLibraryBooks, selectedUnreadBookKey]);

  const pickNextUnreadLibraryBook = () => {
    if (eligibleUnreadLibraryBooks.length === 0) {
      return;
    }
    if (eligibleUnreadLibraryBooks.length === 1) {
      const only = eligibleUnreadLibraryBooks[0];
      setSelectedUnreadBookKey(`${only.libraryId}::${only.id}`);
      return;
    }
    const currentKey = activeUnreadLibraryBook
      ? `${activeUnreadLibraryBook.libraryId}::${activeUnreadLibraryBook.id}`
      : null;
    const pool = eligibleUnreadLibraryBooks.filter(
      b => `${b.libraryId}::${b.id}` !== currentKey,
    );
    const chosen = pool[Math.floor(Math.random() * pool.length)];
    if (chosen) {
      setSelectedUnreadBookKey(`${chosen.libraryId}::${chosen.id}`);
    }
  };

  const activeUnreadPickItem = useMemo<CuratorPickItem | null>(() => {
    if (!activeUnreadLibraryBook) {
      return null;
    }
    const rawSynopsis = activeUnreadLibraryBook.synopsis?.trim();
    const reason = rawSynopsis
      ? rawSynopsis.length > 220
        ? `${rawSynopsis.slice(0, 217).trimEnd()}...`
        : rawSynopsis
      : activeUnreadLibraryBook.primaryGenre
        ? `An unread ${activeUnreadLibraryBook.primaryGenre.toLowerCase()} volume waiting on the shelves of ${toTitleCase(activeUnreadLibraryBook.libraryName)}.`
        : `Waiting on the shelves of ${toTitleCase(activeUnreadLibraryBook.libraryName)}, ready whenever you start your next read.`;

    return {
      title: activeUnreadLibraryBook.title,
      author: activeUnreadLibraryBook.author,
      coverUrl: activeUnreadLibraryBook.coverUrl,
      reason,
      bookId: activeUnreadLibraryBook.id,
      libraryId: activeUnreadLibraryBook.libraryId,
      libraryName: activeUnreadLibraryBook.libraryName,
    };
  }, [activeUnreadLibraryBook]);

  const isUnreadPickWantToRead = useMemo(() => {
    if (!activeUnreadLibraryBook) {
      return false;
    }
    const idKey = `${activeUnreadLibraryBook.libraryId}::${activeUnreadLibraryBook.id}`;
    if (
      activeUnreadLibraryBook.readingStatus === 'want_to_read' ||
      savedUnreadWantToReadKeys.has(idKey)
    ) {
      return true;
    }
    return wantToReadBooks.some(
      b =>
        (b.libraryId === activeUnreadLibraryBook.libraryId &&
          b.id === activeUnreadLibraryBook.id) ||
        (b.title.toLowerCase() ===
          activeUnreadLibraryBook.title.toLowerCase() &&
          b.author.toLowerCase() ===
            activeUnreadLibraryBook.author.toLowerCase()),
    );
  }, [activeUnreadLibraryBook, savedUnreadWantToReadKeys, wantToReadBooks]);

  const handleAddUnreadLibraryPick = async (book: UnreadLibraryBookItem) => {
    if (isSavingUnreadPick || isUnreadPickWantToRead) {
      return;
    }
    setIsSavingUnreadPick(true);
    try {
      await handleStatusChange(book.libraryId, book.id, 'want_to_read');
      const idKey = `${book.libraryId}::${book.id}`;
      setSavedUnreadWantToReadKeys(prev => new Set(prev).add(idKey));
    } finally {
      setIsSavingUnreadPick(false);
    }
  };

  const hasExternalPickControl =
    externalPick !== undefined || externalGenerateNewPick !== undefined;
  const pickScopeKey = isLibraryScoped
    ? `library-reading-${libraryId}`
    : 'personal-reading-room';

  const internalPicker = usePickOfTheDay(
    readingHistorySeed,
    !hasExternalPickControl,
    pickScopeKey,
  );

  const activePick = hasExternalPickControl
    ? (externalPick ?? null)
    : internalPicker.pickOfTheDay;
  const activeIsGeneratingPick = hasExternalPickControl
    ? Boolean(externalIsGeneratingPick)
    : internalPicker.isGeneratingPick;
  const activeGenerateNewPick =
    externalGenerateNewPick ?? (() => void internalPicker.generateNewPick());
  const activePickError = hasExternalPickControl
    ? externalPickError
    : internalPicker.error;

  const [internalSavingPick, setInternalSavingPick] = useState(false);
  const [internalSavedTitles, setInternalSavedTitles] = useState<Set<string>>(
    new Set(),
  );

  const resolvedIsPickTracked = useMemo(() => {
    if (externalIsPickTracked !== undefined) {
      return externalIsPickTracked;
    }
    if (!activePick) {
      return false;
    }
    const key = `${activePick.title.toLowerCase()}::${activePick.author.toLowerCase()}`;
    if (internalSavedTitles.has(key)) {
      return true;
    }
    return scopedItems.some(
      b =>
        b.title.toLowerCase() === activePick.title.toLowerCase() &&
        b.author.toLowerCase() === activePick.author.toLowerCase(),
    );
  }, [externalIsPickTracked, activePick, internalSavedTitles, scopedItems]);

  const handleInternalAddPick = async (pick: CuratorPickItem) => {
    if (externalOnAddPick) {
      externalOnAddPick(pick);
      return;
    }
    if (internalSavingPick || resolvedIsPickTracked) {
      return;
    }
    setInternalSavingPick(true);
    try {
      await trackBookItem({
        source: 'external',
        status: 'want_to_read',
        bookData: {
          title: pick.title,
          author: pick.author,
          coverUrl: pick.coverUrl,
          synopsis: pick.reason,
        },
      });
      const key = `${pick.title.toLowerCase()}::${pick.author.toLowerCase()}`;
      setInternalSavedTitles(prev => new Set(prev).add(key));
      toast.success(`Added "${toTitleCase(pick.title)}" to Want to Read`);
    } catch {
      toast.error('Failed to add recommendation to Want to Read');
    } finally {
      setInternalSavingPick(false);
    }
  };

  const {
    items: hybridRecommendations,
    allItems: allHybridRecommendations,
    activeFilter: recommendationFilter,
    setActiveFilter: setRecommendationFilter,
    isLoading: isLoadingRecommendations,
    isRefreshing: isRefreshingRecommendations,
    refreshRecommendations,
  } = useBookRecommendations({
    enabled: !isLibraryScoped,
    books: scopedItems,
    unreadLibraryBooks: eligibleUnreadLibraryBooks,
  });

  const mergedRecommendations = useMemo<BookRecommendationItem[]>(() => {
    const base = [...hybridRecommendations];
    if (
      activePick &&
      (recommendationFilter === 'all' || recommendationFilter === 'discover')
    ) {
      const pickKey = activePick.title.toLowerCase().trim();
      const alreadyPresent = base.some(
        item => item.title.toLowerCase().trim() === pickKey,
      );
      if (!alreadyPresent) {
        const fallbackItem: BookRecommendationItem = {
          id: `pick:${pickKey}`,
          title: activePick.title,
          author: activePick.author,
          coverUrl: activePick.coverUrl,
          source: 'ai_curator',
          reason: activePick.reason,
          matchTag: 'Curated for Your Taste',
        };
        if (base.length === 0) {
          base.push(fallbackItem);
        } else {
          base.splice(Math.min(1, base.length), 0, fallbackItem);
        }
      }
    }
    return base;
  }, [hybridRecommendations, activePick, recommendationFilter]);

  const trackedTitleKeys = useMemo(() => {
    const keys = new Set<string>(internalSavedTitles);
    for (const item of scopedItems) {
      keys.add(
        `${item.title.toLowerCase().trim()}::${item.author.toLowerCase().trim()}`,
      );
    }
    return keys;
  }, [scopedItems, internalSavedTitles]);

  const handleAddRecommendationToWantToRead = async (
    item: BookRecommendationItem,
  ) => {
    try {
      await trackBookItem({
        source: 'external',
        status: 'want_to_read',
        bookData: {
          title: item.title,
          author: item.author,
          isbn: item.isbn,
          coverUrl: item.coverUrl,
          publishedDate: item.publishedDate,
          primaryGenre: item.primaryGenre,
          subgenres: item.subgenres,
          synopsis: item.synopsis || item.reason,
          series: item.series,
        },
      });
      const key = `${item.title.toLowerCase().trim()}::${item.author.toLowerCase().trim()}`;
      setInternalSavedTitles(prev => new Set(prev).add(key));
      toast.success(`Added "${toTitleCase(item.title)}" to Want to Read`);
    } catch {
      toast.error('Failed to add recommendation to Want to Read');
    }
  };

  const handleTrackBookTrigger = (
    defaultShelf:
      'want_to_read' | 'reading' | 'finished' | 'abandoned' = 'want_to_read',
  ) => {
    if (onTrackBook) {
      onTrackBook(defaultShelf);
    } else if (isLibraryScoped && libraryId) {
      void navigate(`/library/${encodeURIComponent(libraryId)}/add`);
    } else {
      void navigate(`/reading/add?status=${encodeURIComponent(defaultShelf)}`);
    }
  };

  const handleOpenShelfTrigger = (
    tab: ShelfFilterTab,
    genre: string | null = null,
  ) => {
    if (onOpenShelf) {
      onOpenShelf(tab, genre);
    } else if (isLibraryScoped && libraryId) {
      const params = new URLSearchParams();
      if (genre) {
        params.set('genre', genre);
      }
      const query = params.toString();
      void navigate(
        `/library/${encodeURIComponent(libraryId)}/collection${query ? `?${query}` : ''}`,
      );
    }
  };

  if (isLoading) {
    return (
      <div
        className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6"
        data-testid="reading-bento-skeleton"
      >
        <div className="md:col-span-7 h-72 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
        <div className="md:col-span-5 h-72 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
        <div className="md:col-span-5 h-56 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
        <div className="md:col-span-7 h-56 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
      </div>
    );
  }

  const exploreBasePath =
    isLibraryScoped && libraryId ? `/library/${libraryId}` : '/reading';

  const pickOfTheDayCardNode = (
    <CuratorPickCard
      pickOfTheDay={activePick}
      isGeneratingPick={activeIsGeneratingPick}
      generateNewPick={activeGenerateNewPick}
      pickError={activePickError}
      eyebrow="Pick of the Day · From Your Reading History"
      emptyTitle="Daily Book Pick"
      emptyDescription={
        readingHistorySeed.length > 0
          ? 'Discover a personalized recommendation tailored to your reading life.'
          : "Track a few books you love, and we'll suggest what to read next."
      }
      onAddToWantToRead={pick => void handleInternalAddPick(pick)}
      isAddedToWantToRead={resolvedIsPickTracked}
      isAddingToWantToRead={externalIsSavingPick ?? internalSavingPick}
      className="w-full h-full"
    />
  );

  const genreBreakdownCardNode = (
    <GenreBreakdownCard
      books={finishedBooks}
      eyebrow="Books Read by Genre"
      headerRight={`${finishedBooks.length} ${finishedBooks.length === 1 ? 'volume' : 'volumes'} read`}
      emptyMessage="Finish your first book to see the genres you gravitate toward."
      onSelectGenre={genre => handleOpenShelfTrigger('finished', genre)}
    />
  );

  const renderWantToReadCard = (compactRow = false) => (
    <ReadingBentoWantToReadCard
      wantToReadBooks={wantToReadBooks}
      compactRow={compactRow}
      isLibraryScoped={isLibraryScoped}
      libraryId={libraryId}
      onTrackBook={handleTrackBookTrigger}
      onOpenShelf={handleOpenShelfTrigger}
      onStatusChange={handleStatusChange}
    />
  );

  if (!isLibraryScoped && scopedItems.length === 0) {
    return (
      <div className="space-y-8" data-testid="reading-bento-personal-reading">
        <ReadingOnboardingStudio
          unreadLibraryBooks={eligibleUnreadLibraryBooks}
          librariesCount={librariesCount}
          primaryLibraryId={primaryLibraryId}
          onTrackBook={handleTrackBookTrigger}
          onCreateLibrary={onCreateLibrary}
          onStatusChange={handleStatusChange}
        />
      </div>
    );
  }

  return (
    <div
      className="space-y-8"
      data-testid={`reading-bento-${isLibraryScoped ? `library-${libraryId}` : 'personal-reading'}`}
    >
      <div className="space-y-6">
        {!isLibraryScoped &&
          (scopedItems.length < 3 || finishedBooks.length === 0) && (
            <ReadingOnboardingBanner
              totalTrackedCount={scopedItems.length}
              readingCount={readingBooks.length}
              finishedCount={finishedBooks.length}
              unreadLibraryCount={eligibleUnreadLibraryBooks.length}
              primaryLibraryId={
                eligibleUnreadLibraryBooks[0]?.libraryId ?? primaryLibraryId
              }
              onTrackBook={handleTrackBookTrigger}
            />
          )}

        {/* Row 1: Active Reading Spotlight (7 cols) + Messy 5-Book Read Stack Canvas (5 cols) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
          <div className="md:col-span-7">
            <CurrentlyReadingCard
              readingBooks={readingBooks}
              showLibraryProvenance={!isLibraryScoped}
              onStatusChange={handleStatusChange}
              onTrackBook={() => handleTrackBookTrigger('reading')}
              onOpenReadingLists={tab => handleOpenShelfTrigger(tab)}
            />
          </div>
          <div className="md:col-span-5">
            <ReadStackCanvasCard
              finishedBooks={finishedBooks}
              onOpenAllRead={() => handleOpenShelfTrigger('finished')}
              onTrackBook={() => handleTrackBookTrigger('finished')}
            />
          </div>
        </div>

        {!isLibraryScoped ? (
          <>
            {/* Row 2 (Personal Reading Room): Compact Suggested Next Reads Hybrid Carousel */}
            <SuggestedNextReadsCard
              recommendations={mergedRecommendations}
              allRecommendations={allHybridRecommendations}
              activeFilter={recommendationFilter}
              onFilterChange={setRecommendationFilter}
              isLoading={isLoadingRecommendations && !activePick}
              isRefreshing={
                isRefreshingRecommendations || activeIsGeneratingPick
              }
              onRefresh={() => {
                refreshRecommendations();
                if (hasExternalPickControl) {
                  activeGenerateNewPick();
                }
              }}
              onAddExternalToWantToRead={handleAddRecommendationToWantToRead}
              onUpdateShelfBookStatus={(libId, bId, nextStatus) =>
                handleStatusChange(libId, bId, nextStatus)
              }
              onTrackBook={() => handleTrackBookTrigger('finished')}
              trackedTitleKeys={trackedTitleKeys}
            />

            {/* Row 3: Books Read by Genre (5 cols) + Up Next · Want to Read (7 cols) */}
            {(finishedBooks.length > 0 || wantToReadBooks.length > 0) && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
                <div
                  className={
                    showWantToReadStrip ? 'md:col-span-5' : 'md:col-span-12'
                  }
                >
                  {genreBreakdownCardNode}
                </div>
                {showWantToReadStrip && (
                  <div className="md:col-span-7 flex">
                    {renderWantToReadCard(true)}
                  </div>
                )}
              </div>
            )}
          </>
        ) : activeUnreadPickItem && activeUnreadLibraryBook ? (
          <>
            {/* Row 2: Responsive 6+6 Discovery Row */}
            <div
              className="grid grid-cols-1 lg:grid-cols-12 gap-5 sm:gap-6 items-stretch"
              data-testid="reading-discovery-row"
            >
              <div className="lg:col-span-6 flex">{pickOfTheDayCardNode}</div>
              <div className="lg:col-span-6 flex">
                <CuratorPickCard
                  pickOfTheDay={activeUnreadPickItem}
                  isGeneratingPick={false}
                  generateNewPick={pickNextUnreadLibraryBook}
                  requiresAiPlan={false}
                  refreshTitle="Pick another unread book from your shelves"
                  eyebrow={
                    activeUnreadLibraryBook.libraryName
                      ? `From Your Libraries · ${toTitleCase(activeUnreadLibraryBook.libraryName)}`
                      : 'From Your Libraries · Unread Pick'
                  }
                  onAddToWantToRead={() =>
                    void handleAddUnreadLibraryPick(activeUnreadLibraryBook)
                  }
                  isAddedToWantToRead={isUnreadPickWantToRead}
                  isAddingToWantToRead={isSavingUnreadPick}
                  onOpenBook={() =>
                    navigateWithCoverTransition({
                      navigate,
                      libraryId: activeUnreadLibraryBook.libraryId,
                      bookId: activeUnreadLibraryBook.id,
                      originSurface: 'curator-pick',
                      fromRouteKey: '/',
                      coverPreview: {
                        title: activeUnreadLibraryBook.title,
                        author: activeUnreadLibraryBook.author,
                        coverUrl: activeUnreadLibraryBook.coverUrl,
                        primaryGenre: activeUnreadLibraryBook.primaryGenre,
                        synopsis: activeUnreadLibraryBook.synopsis,
                        readingStatus: activeUnreadLibraryBook.readingStatus,
                      },
                    })
                  }
                  className="w-full h-full"
                />
              </div>
            </div>

            {/* Row 3: Books Read by Genre (5 cols) + Up Next · Want to Read (7 cols) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
              <div
                className={
                  showWantToReadStrip ? 'md:col-span-5' : 'md:col-span-12'
                }
              >
                {genreBreakdownCardNode}
              </div>
              {showWantToReadStrip && (
                <div className="md:col-span-7 flex">
                  {renderWantToReadCard(true)}
                </div>
              )}
            </div>
          </>
        ) : (
          <>
            {/* Row 2 (Library Overview): Read by Genre Breakdown (5 cols) + Pick of the Day (7 cols) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
              <div className="md:col-span-5">{genreBreakdownCardNode}</div>
              <div className="md:col-span-7 flex">{pickOfTheDayCardNode}</div>
            </div>

            {/* Row 3: Compact Want-to-Read Strip */}
            {showWantToReadStrip && renderWantToReadCard(false)}
          </>
        )}
      </div>

      {/* Row 4: Shared Exploratory Perspectives Strip */}
      {showExplorePerspectives && (
        <ExplorePerspectivesStrip
          books={readingHistorySeed}
          basePath={exploreBasePath}
          heading={
            isLibraryScoped ? 'Explore Library Reading' : 'Explore Your Reading'
          }
          subtitle="Immersive perspectives across history, geography, and theme for the books you read"
          ariaLabel="Explore Reading Visualizers"
        />
      )}
    </div>
  );
}
