import React, {useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Plus, ArrowRight, Play} from 'lucide-react';
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
import {ExplorePerspectivesStrip} from './ExplorePerspectivesStrip';
import {usePickOfTheDay} from '../../hooks/usePickOfTheDay';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {MonographCoverFallback} from './MonographCoverFallback';
import {Button} from '@/components/ui/button';
import type {Book} from '../../types';
import type {
  TrackedBookItem,
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../../server/services/readingTracker';

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
  const isOnline = useOnlineStatus();
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());

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

  // Normalize and scope items to either 'personal-reading' (all tracked) or a specific `libraryId`
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

  // Partition into active reading, finished, want_to_read, and consolidated 'Read + Currently Reading'
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

  // Consolidated 'Read + Currently Reading' set
  const readAndCurrentlyReadingBooks = useMemo(
    () => [...finishedBooks, ...readingBooks],
    [finishedBooks, readingBooks],
  );

  const readingHistorySeed = useMemo(() => {
    return readAndCurrentlyReadingBooks.length > 0
      ? readAndCurrentlyReadingBooks
      : scopedItems;
  }, [readAndCurrentlyReadingBooks, scopedItems]);

  // Eligible unread books across all accessible libraries (not reading, read, or abandoned)
  const eligibleUnreadLibraryBooks = useMemo<UnreadLibraryBookItem[]>(() => {
    if (isLibraryScoped) {
      return [];
    }

    const excludedIds = new Set<string>();
    const excludedTitleAuthorKeys = new Set<string>();

    for (const item of scopedItems) {
      if (
        item.readingStatus === 'reading' ||
        item.readingStatus === 'finished' ||
        item.readingStatus === 'abandoned'
      ) {
        excludedIds.add(`${item.libraryId}::${item.id}`);
        excludedTitleAuthorKeys.add(
          `${item.title.toLowerCase().trim()}::${item.author.toLowerCase().trim()}`,
        );
      }
    }

    const rawCandidates: UnreadLibraryBookItem[] = [
      ...(externalUnreadLibraryBooks ?? fetchedUnreadLibraryBooks ?? []),
    ];

    const sourceList = externalBooks ?? fetchedItems;
    for (const item of sourceList) {
      const resolvedLibId = item.libraryId || '';
      const isVirtual =
        ('isVirtual' in item && Boolean(item.isVirtual)) ||
        resolvedLibId.startsWith('virtual_') ||
        item.ownershipStatus === 'unowned';
      if (!resolvedLibId || isVirtual) {
        continue;
      }

      const rawStatus = item.readingStatus || 'unset';

      if (
        rawStatus === 'reading' ||
        rawStatus === 'finished' ||
        rawStatus === 'completed' ||
        rawStatus === 'abandoned'
      ) {
        continue;
      }

      rawCandidates.push({
        id: item.id,
        libraryId: resolvedLibId,
        libraryName: ('libraryName' in item && item.libraryName) || 'Library',
        title: item.title,
        author: item.author,
        coverUrl: item.coverUrl,
        primaryGenre: item.primaryGenre,
        synopsis: item.synopsis,
        readingStatus: rawStatus === 'want_to_read' ? 'want_to_read' : 'unset',
      });
    }

    const seenKeys = new Set<string>();
    const filtered: UnreadLibraryBookItem[] = [];

    for (const candidate of rawCandidates) {
      const idKey = `${candidate.libraryId}::${candidate.id}`;
      const titleAuthorKey = `${candidate.title.toLowerCase().trim()}::${candidate.author.toLowerCase().trim()}`;

      if (
        excludedIds.has(idKey) ||
        excludedTitleAuthorKeys.has(titleAuthorKey) ||
        seenKeys.has(titleAuthorKey)
      ) {
        continue;
      }

      seenKeys.add(titleAuthorKey);
      filtered.push(candidate);
    }

    return filtered;
  }, [
    isLibraryScoped,
    scopedItems,
    externalUnreadLibraryBooks,
    fetchedUnreadLibraryBooks,
    externalBooks,
    fetchedItems,
  ]);

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

  // Internal Pick of the Day fallback when not controlled by parent
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
    <div
      className={`bento-card p-4 sm:p-5 ${
        compactRow ? 'w-full flex flex-col justify-between' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <div className="flex items-center gap-2">
          <span className="metadata-eyebrow">Up Next · Want to Read</span>
          <span className="font-mono tabular-nums text-xs text-on-surface-variant">
            ({wantToReadBooks.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            onClick={() => handleTrackBookTrigger('want_to_read')}
            className="h-7 px-2.5 text-xs font-sans font-semibold text-on-surface-variant hover:text-primary gap-1 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </Button>
          {wantToReadBooks.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => handleOpenShelfTrigger('want_to_read')}
              className="h-7 px-2.5 text-xs font-sans font-semibold text-primary hover:text-primary/80 gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {wantToReadBooks.length === 0 ? (
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 px-1 text-xs text-on-surface-variant ${
            compactRow ? 'my-auto' : ''
          }`}
        >
          <p>
            Your reading list is wide open. Save a few books you&apos;d love to
            pick up next.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            onClick={() => handleTrackBookTrigger('want_to_read')}
            className="h-8 px-3 text-xs font-semibold shrink-0 self-start sm:self-auto disabled:opacity-50"
          >
            Add to Want to Read
          </Button>
        </div>
      ) : (
        <div
          className={
            compactRow
              ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5'
              : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3.5'
          }
        >
          {wantToReadBooks.slice(0, compactRow ? 4 : 6).map(item => (
            <div
              key={`${item.libraryId}-${item.id}`}
              onClick={() =>
                void navigate(
                  `/library/${encodeURIComponent(item.libraryId)}/book/${encodeURIComponent(item.id)}`,
                  {
                    state: {
                      from:
                        isLibraryScoped && libraryId
                          ? `/library/${libraryId}`
                          : '/',
                    },
                  },
                )
              }
              className="group flex flex-col p-2.5 rounded-lg bg-surface hover:bg-surface-container-low border border-outline-variant/40 transition-colors cursor-pointer"
            >
              <div className="relative aspect-[2/3] w-full rounded overflow-hidden bg-surface-container mb-2 border border-outline-variant/40 book-cover-shadow">
                {item.coverUrl && !failedCovers.has(item.id) ? (
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    onError={() =>
                      setFailedCovers(prev => new Set(prev).add(item.id))
                    }
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <MonographCoverFallback
                    title={item.title}
                    author={item.author}
                    variant="compact"
                    className="w-full h-full"
                  />
                )}
                <button
                  type="button"
                  disabled={!isOnline}
                  title={
                    !isOnline ? 'Unavailable while offline' : 'Start Reading'
                  }
                  onClick={e => {
                    e.stopPropagation();
                    if (!isOnline) {
                      return;
                    }
                    void handleStatusChange(item.libraryId, item.id, 'reading');
                  }}
                  className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-primary text-on-primary text-[10px] font-sans font-semibold px-2 py-1 rounded shadow-xs inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>Read</span>
                </button>
              </div>
              <h4 className="font-serif text-xs font-semibold text-on-surface group-hover:text-primary truncate">
                {toTitleCase(item.title)}
              </h4>
              <p className="font-sans text-[11px] text-on-surface-variant truncate">
                {toTitleCase(item.author)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div
      className="space-y-8"
      data-testid={`reading-bento-${isLibraryScoped ? `library-${libraryId}` : 'personal-reading'}`}
    >
      <div className="space-y-6">
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

        {activeUnreadPickItem && activeUnreadLibraryBook ? (
          <>
            {/* Row 2 (When Unread Library Pick exists): Responsive 6+6 Discovery Row on Desktop, Stacked on Mobile/Tablet */}
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
                    void navigate(
                      `/library/${encodeURIComponent(activeUnreadLibraryBook.libraryId)}/book/${encodeURIComponent(activeUnreadLibraryBook.id)}`,
                      {state: {from: '/'}},
                    )
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
            {/* Row 2 (When no Unread Library Pick exists): Read by Genre Breakdown (5 cols) + Pick of the Day (7 cols) */}
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
              <div className="md:col-span-5">{genreBreakdownCardNode}</div>
              <div className="md:col-span-7 flex">{pickOfTheDayCardNode}</div>
            </div>

            {/* Row 3: Compact Want-to-Read Strip (Up Next Queue) */}
            {showWantToReadStrip && renderWantToReadCard(false)}
          </>
        )}
      </div>

      {/* Row 4: Shared Exploratory Perspectives Strip over Consolidated Read + Currently Reading Set */}
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
