import React, {useState, useMemo} from 'react';
import {useAuth} from '../stores/authStore';
import {Navigate, useNavigate} from 'react-router-dom';
import {
  Plus,
  Library as LibraryIcon,
  ShieldAlert,
  AlertTriangle,
  RefreshCw,
  Search,
  ListFilter,
  ArrowRight,
  Book as BookIcon,
  Play,
} from 'lucide-react';
import {toast} from 'sonner';
import {toTitleCase} from '../lib/utils';
import {ErrorBoundary} from '../components/layout/ErrorBoundary';
import {useLibraries} from './dashboard/useLibraries';
import {
  useReadingShelf,
  type ShelfFilterTab,
} from './dashboard/useReadingShelf';
import {CurrentlyReadingCard} from './dashboard/CurrentlyReadingCard';
import {ReadStackCanvasCard} from './dashboard/ReadStackCanvasCard';
import {ReadingListsDialog} from './dashboard/ReadingListsDialog';
import {TrackBookDialog} from './dashboard/TrackBookDialog';
import {LibraryCard} from './dashboard/LibraryCard';
import {LibrarySkeleton} from './dashboard/LibrarySkeleton';
import {CreateLibraryDialog} from './dashboard/CreateLibraryDialog';
import {LibraryFilterControls} from './dashboard/LibraryFilterControls';
import {GenreBreakdownCard} from '../components/book/GenreBreakdownCard';
import {
  CuratorPickCard,
  type CuratorPickItem,
} from '../components/book/CuratorPickCard';
import {usePickOfTheDay} from '../hooks/usePickOfTheDay';
import {Button} from '@/components/ui/button';
import {useAppPermissions} from '../hooks/useAppPermissions';

export default function Dashboard() {
  const {user} = useAuth();
  const navigate = useNavigate();
  const {isAdmin} = useAppPermissions();
  const {
    libraries,
    isLoading,
    error,
    refetch,
    isSubmitting,
    createLibrary,
    scopes,
    toggleScope,
  } = useLibraries();
  const {
    allItems,
    counts: shelfCounts,
    isLoading: isLoadingShelf,
    updateItemStatus,
    trackBookItem,
  } = useReadingShelf();

  const [isCreating, setIsCreating] = useState(false);
  const [isTrackingBook, setIsTrackingBook] = useState(false);
  const [trackDialogDefaultShelf, setTrackDialogDefaultShelf] = useState<
    'want_to_read' | 'reading' | 'finished' | 'abandoned'
  >('want_to_read');

  const [listsModalState, setListsModalState] = useState<{
    isOpen: boolean;
    initialTab: ShelfFilterTab;
    initialGenre: string | null;
  }>({
    isOpen: false,
    initialTab: 'all',
    initialGenre: null,
  });

  const [isSavingPick, setIsSavingPick] = useState(false);
  const [savedPickTitles, setSavedPickTitles] = useState<Set<string>>(
    new Set(),
  );

  // Partition personal reading shelves
  const readingBooks = useMemo(
    () => allItems.filter(item => item.readingStatus === 'reading'),
    [allItems],
  );
  const finishedBooks = useMemo(
    () => allItems.filter(item => item.readingStatus === 'finished'),
    [allItems],
  );
  const wantToReadBooks = useMemo(
    () => allItems.filter(item => item.readingStatus === 'want_to_read'),
    [allItems],
  );

  // Seed Pick of the Day from reading history (finished + currently reading, or all tracked if new reader)
  const readingHistorySeed = useMemo(() => {
    const history = [...finishedBooks, ...readingBooks];
    return history.length > 0 ? history : allItems;
  }, [finishedBooks, readingBooks, allItems]);

  const {
    pickOfTheDay,
    isGeneratingPick,
    generateNewPick,
    error: pickError,
  } = usePickOfTheDay(readingHistorySeed, true, 'personal-reading-room');

  const isPickAlreadyTracked = useMemo(() => {
    if (!pickOfTheDay) return false;
    const key = `${pickOfTheDay.title.toLowerCase()}::${pickOfTheDay.author.toLowerCase()}`;
    if (savedPickTitles.has(key)) return true;
    return allItems.some(
      b =>
        b.title.toLowerCase() === pickOfTheDay.title.toLowerCase() &&
        b.author.toLowerCase() === pickOfTheDay.author.toLowerCase(),
    );
  }, [pickOfTheDay, savedPickTitles, allItems]);

  const handleAddPickToWantToRead = async (pick: CuratorPickItem) => {
    if (isSavingPick || isPickAlreadyTracked) return;
    setIsSavingPick(true);
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
      setSavedPickTitles(prev => new Set(prev).add(key));
      toast.success(`Added "${toTitleCase(pick.title)}" to Want to Read`);
    } catch {
      toast.error('Failed to add recommendation to Want to Read');
    } finally {
      setIsSavingPick(false);
    }
  };

  const openReadingListsModal = (
    initialTab: ShelfFilterTab = 'all',
    initialGenre: string | null = null,
  ) => {
    setListsModalState({
      isOpen: true,
      initialTab,
      initialGenre,
    });
  };

  const openTrackBookModal = (
    defaultShelf:
      'want_to_read' | 'reading' | 'finished' | 'abandoned' = 'want_to_read',
  ) => {
    setTrackDialogDefaultShelf(defaultShelf);
    setIsTrackingBook(true);
  };

  const libraryList = Array.isArray(libraries)
    ? libraries
    : libraries &&
        typeof libraries === 'object' &&
        'libraries' in libraries &&
        Array.isArray((libraries as {libraries: unknown}).libraries)
      ? (libraries as {libraries: typeof libraries}).libraries
      : [];

  if (!user) {
    return <Navigate to="/login" />;
  }

  const readerName =
    user.displayName?.split(' ')[0] || user.email?.split('@')[0] || 'Reader';

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full w-full">
      <div className="layout-page-content space-y-12">
        {/* Tier 1: Personal Reading Room (Curated Bento Experience) */}
        <section aria-labelledby="reading-room-heading" className="space-y-6">
          <div className="layout-header border-none pb-0 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <span className="metadata-eyebrow block mb-1">
                Personal Reading Tracker
              </span>
              <h1 id="reading-room-heading" className="layout-header-title">
                {readerName}&apos;s Reading Room
              </h1>
              <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-on-surface-variant mt-1.5 font-sans">
                <button
                  type="button"
                  onClick={() => openReadingListsModal('reading')}
                  className="hover:text-primary transition-colors cursor-pointer"
                >
                  <strong className="font-mono tabular-nums text-on-surface">
                    {shelfCounts.reading}
                  </strong>{' '}
                  Currently Reading
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => openReadingListsModal('want_to_read')}
                  className="hover:text-primary transition-colors cursor-pointer"
                >
                  <strong className="font-mono tabular-nums text-on-surface">
                    {shelfCounts.want_to_read}
                  </strong>{' '}
                  Want to Read
                </button>
                <span aria-hidden="true">·</span>
                <button
                  type="button"
                  onClick={() => openReadingListsModal('finished')}
                  className="hover:text-primary transition-colors cursor-pointer"
                >
                  <strong className="font-mono tabular-nums text-on-surface">
                    {shelfCounts.finished}
                  </strong>{' '}
                  Read
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2.5 self-start sm:self-auto shrink-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => openReadingListsModal('all')}
                className="flex items-center gap-2 min-h-[42px] px-4 font-sans font-semibold rounded-lg whitespace-nowrap"
              >
                <ListFilter className="w-4 h-4" />
                <span>Reading Lists</span>
                <span className="font-mono tabular-nums text-xs text-on-surface-variant">
                  ({shelfCounts.all})
                </span>
              </Button>
              <Button
                type="button"
                onClick={() => openTrackBookModal('want_to_read')}
                className="flex items-center gap-2 min-h-[42px] px-5 bg-primary text-on-primary font-sans font-semibold rounded-lg hover:bg-primary/90 shadow-xs transition-all whitespace-nowrap"
              >
                <Search className="w-4 h-4 stroke-[2.25]" />
                <span>Track a Book</span>
              </Button>
            </div>
          </div>

          {isLoadingShelf ? (
            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
              <div className="md:col-span-7 h-72 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
              <div className="md:col-span-5 h-72 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
              <div className="md:col-span-5 h-56 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
              <div className="md:col-span-7 h-56 rounded-xl bg-surface-container/70 border border-outline-variant/40 animate-pulse" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Row 1: Active Reading Spotlight (7 cols) + Messy 5-Book Read Stack Canvas (5 cols) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
                <div className="md:col-span-7">
                  <CurrentlyReadingCard
                    readingBooks={readingBooks}
                    onStatusChange={updateItemStatus}
                    onTrackBook={() => openTrackBookModal('reading')}
                    onOpenReadingLists={tab => openReadingListsModal(tab)}
                  />
                </div>
                <div className="md:col-span-5">
                  <ReadStackCanvasCard
                    finishedBooks={finishedBooks}
                    onOpenAllRead={() => openReadingListsModal('finished')}
                    onTrackBook={() => openTrackBookModal('finished')}
                  />
                </div>
              </div>

              {/* Row 2: Read by Genre Breakdown (5 cols) + Pick of the Day from Reading History (7 cols) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
                <div className="md:col-span-5">
                  <GenreBreakdownCard
                    books={finishedBooks}
                    eyebrow="Books Read by Genre"
                    headerRight={`${finishedBooks.length} ${finishedBooks.length === 1 ? 'volume' : 'volumes'} read`}
                    emptyMessage="Finish your first book to see your personal reading breakdown by genre."
                    onSelectGenre={genre =>
                      openReadingListsModal('finished', genre)
                    }
                  />
                </div>
                <div className="md:col-span-7">
                  <CuratorPickCard
                    pickOfTheDay={pickOfTheDay}
                    isGeneratingPick={isGeneratingPick}
                    generateNewPick={() => void generateNewPick()}
                    pickError={pickError}
                    eyebrow="Pick of the Day · From Your Reading History"
                    emptyTitle="Pick of the Day"
                    emptyDescription={
                      readingHistorySeed.length > 0
                        ? 'Discover a personalized recommendation tailored to your reading history.'
                        : 'Track a book you have read or want to read to unlock daily AI recommendations.'
                    }
                    onAddToWantToRead={handleAddPickToWantToRead}
                    isAddedToWantToRead={isPickAlreadyTracked}
                    isAddingToWantToRead={isSavingPick}
                    className="h-full"
                  />
                </div>
              </div>

              {/* Compact Want-to-Read Strip (Up Next Queue) */}
              <div className="bento-card p-4 sm:p-5">
                <div className="flex items-center justify-between gap-3 mb-3.5">
                  <div className="flex items-center gap-2">
                    <span className="metadata-eyebrow">
                      Up Next · Want to Read
                    </span>
                    <span className="font-mono tabular-nums text-xs text-on-surface-variant">
                      ({wantToReadBooks.length})
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => openTrackBookModal('want_to_read')}
                      className="h-7 px-2.5 text-xs font-sans font-semibold text-on-surface-variant hover:text-primary gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add</span>
                    </Button>
                    {wantToReadBooks.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => openReadingListsModal('want_to_read')}
                        className="h-7 px-2.5 text-xs font-sans font-semibold text-primary hover:text-primary/80 gap-1"
                      >
                        <span>View All</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>

                {wantToReadBooks.length === 0 ? (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 px-1 text-xs text-on-surface-variant">
                    <p>
                      Your Want-to-Read queue is empty. Search across providers
                      or your libraries to save books for later.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openTrackBookModal('want_to_read')}
                      className="h-8 px-3 text-xs font-semibold shrink-0 self-start sm:self-auto"
                    >
                      Add to Want to Read
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3.5">
                    {wantToReadBooks.slice(0, 6).map(item => (
                      <div
                        key={`${item.libraryId}-${item.id}`}
                        onClick={() =>
                          void navigate(
                            `/library/${encodeURIComponent(item.libraryId)}/book/${encodeURIComponent(item.id)}`,
                            {state: {from: '/'}},
                          )
                        }
                        className="group flex flex-col p-2.5 rounded-lg bg-surface hover:bg-surface-container-low border border-outline-variant/40 transition-colors cursor-pointer"
                      >
                        <div className="relative aspect-[2/3] w-full rounded overflow-hidden bg-surface-container mb-2 border border-outline-variant/40 book-cover-shadow">
                          {item.coverUrl ? (
                            <img
                              src={item.coverUrl}
                              alt={item.title}
                              className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="w-full h-full p-2 flex flex-col justify-between bg-gradient-to-b from-surface-container-low to-surface-container">
                              <BookIcon className="w-3.5 h-3.5 text-on-surface-variant/60" />
                              <span className="font-serif text-[10px] font-semibold text-primary line-clamp-2 leading-tight">
                                {toTitleCase(item.title)}
                              </span>
                            </div>
                          )}
                          <button
                            type="button"
                            title="Start Reading"
                            onClick={e => {
                              e.stopPropagation();
                              void updateItemStatus(
                                item.libraryId,
                                item.id,
                                'reading',
                              );
                            }}
                            className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-primary text-on-primary text-[10px] font-sans font-semibold px-2 py-1 rounded shadow-xs inline-flex items-center gap-1 cursor-pointer"
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
            </div>
          )}
        </section>

        {/* Tier 2: Compact Libraries Section (De-centered Archive Strip) */}
        <section
          aria-labelledby="libraries-section-heading"
          className="pt-10 border-t border-outline-variant/60 space-y-5"
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <span className="metadata-eyebrow block mb-0.5">
                Owned & Shared Collections
              </span>
              <h2
                id="libraries-section-heading"
                className="font-serif text-2xl font-semibold tracking-tight text-on-surface"
              >
                Libraries
              </h2>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant mt-0.5">
                Personal archives, shared collections, and curated catalogs.
              </p>
            </div>
            {isLoading ? (
              <div className="h-[40px] w-36 bg-surface-variant/40 rounded-lg self-start sm:self-auto animate-pulse shrink-0" />
            ) : (
              <Button
                variant="outline"
                onClick={() => setIsCreating(true)}
                className="flex items-center gap-2 min-h-[40px] px-4 font-sans font-semibold rounded-lg self-start sm:self-auto transition-all whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                <span>Create Library</span>
              </Button>
            )}
          </div>

          {/* 3-State Filter Controls for User & Admin Scopes */}
          <LibraryFilterControls
            scopes={scopes}
            onToggleScope={toggleScope}
            isAdmin={isAdmin}
            totalCount={libraryList.length}
          />

          <ErrorBoundary name="Dashboard Content">
            <CreateLibraryDialog
              isOpen={isCreating}
              isSubmitting={isSubmitting}
              onClose={() => setIsCreating(false)}
              onCreate={createLibrary}
            />

            <TrackBookDialog
              isOpen={isTrackingBook}
              onClose={() => setIsTrackingBook(false)}
              libraries={libraryList}
              defaultShelf={trackDialogDefaultShelf}
              onTrackBook={trackBookItem}
            />

            <ReadingListsDialog
              isOpen={listsModalState.isOpen}
              onClose={() =>
                setListsModalState(prev => ({...prev, isOpen: false}))
              }
              allItems={allItems}
              counts={shelfCounts}
              initialTab={listsModalState.initialTab}
              initialGenre={listsModalState.initialGenre}
              onStatusChange={updateItemStatus}
              onOpenTrackBook={() => openTrackBookModal('want_to_read')}
            />

            {isLoading ? (
              <LibrarySkeleton />
            ) : error ? (
              <div
                role="alert"
                className="py-12 px-6 bg-surface-container-low rounded-lg border border-destructive/30 shadow-elevation-1 text-center max-w-2xl mx-auto"
              >
                <div className="w-12 h-12 bg-destructive/10 rounded-lg flex items-center justify-center mx-auto mb-4 border border-destructive/20">
                  <AlertTriangle className="w-6 h-6 text-destructive" />
                </div>
                <h3 className="font-sans text-lg font-bold text-on-surface mb-2">
                  Unable to Load Libraries
                </h3>
                <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-6 break-words">
                  {error instanceof Error
                    ? error.message
                    : 'An unexpected server error occurred while fetching your libraries.'}
                </p>
                <Button
                  onClick={() => void refetch?.()}
                  variant="outline"
                  className="mx-auto flex items-center gap-2 rounded-lg font-sans font-semibold"
                >
                  <RefreshCw className="w-4 h-4" />
                  <span>Retry</span>
                </Button>
              </div>
            ) : libraryList.length === 0 && !isCreating ? (
              <div className="text-center py-14 px-6 bg-surface-container-low rounded-xl border border-outline-variant/40">
                <div className="w-12 h-12 bg-surface rounded-lg flex items-center justify-center mx-auto mb-4 border border-outline-variant/50">
                  {scopes.includes('all') ? (
                    <ShieldAlert className="w-6 h-6 text-on-surface-variant" />
                  ) : (
                    <LibraryIcon className="w-6 h-6 text-on-surface-variant" />
                  )}
                </div>
                <h3 className="empty-state-title">
                  {scopes.includes('all')
                    ? 'No Cataloged Libraries Found'
                    : scopes.length === 1 && scopes[0] === 'shared'
                      ? 'No Shared Libraries'
                      : scopes.length === 1 && scopes[0] === 'owned'
                        ? 'No Owned Libraries'
                        : 'No Libraries Found'}
                </h3>
                <p className="empty-state-description max-w-md mx-auto mb-5">
                  {scopes.includes('all')
                    ? 'There are currently no libraries stored in the global system archive.'
                    : scopes.length === 1 && scopes[0] === 'shared'
                      ? 'No other users have granted you access to their library collections yet.'
                      : scopes.length === 1 && scopes[0] === 'owned'
                        ? 'You have not created any personal library collections yet.'
                        : 'Create a library collection if you also want to catalog owned physical or digital shelves.'}
                </p>
                {(!scopes.includes('shared') || scopes.includes('owned')) && (
                  <Button
                    variant="outline"
                    onClick={() => setIsCreating(true)}
                    className="mx-auto flex items-center gap-2 min-h-[40px] px-5 rounded-lg font-sans font-semibold"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Create Library</span>
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {libraryList.map((lib, index) => (
                  <LibraryCard key={lib.id} lib={lib} index={index} />
                ))}
              </div>
            )}
          </ErrorBoundary>
        </section>
      </div>
    </div>
  );
}
