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
  Sparkles,
  BookOpen,
} from 'lucide-react';
import {toast} from 'sonner';
import {toTitleCase, formatCompactNumber} from '../lib/utils';
import {ErrorBoundary} from '../components/layout/ErrorBoundary';
import {useLibraries} from './dashboard/useLibraries';
import {
  useReadingShelf,
  type ShelfFilterTab,
} from './dashboard/useReadingShelf';
import {ReadingListsDialog} from './dashboard/ReadingListsDialog';
import {LibraryCard} from './dashboard/LibraryCard';
import {LibrarySkeleton} from './dashboard/LibrarySkeleton';
import {CreateLibraryDialog} from './dashboard/CreateLibraryDialog';
import {LibraryFilterControls} from './dashboard/LibraryFilterControls';
import {LibraryCollection} from './library/LibraryCollection';
import {type CuratorPickItem} from '../components/book/CuratorPickCard';
import {ReadingBento} from '../components/book/ReadingBento';
import {QuickAddBookDialog} from '../components/book/QuickAddBookDialog';
import {usePickOfTheDay} from '../hooks/usePickOfTheDay';
import {useBookFilters} from '../hooks/useBookFilters';
import {Button} from '@/components/ui/button';
import {Badge} from '@/components/ui/badge';
import {useAppPermissions} from '../hooks/useAppPermissions';

type OwnershipFilter = 'all' | 'owned' | 'unowned';

const READING_SHELF_TABS: Array<{id: ShelfFilterTab; label: string}> = [
  {id: 'all', label: 'All Tracked'},
  {id: 'reading', label: 'Currently Reading'},
  {id: 'want_to_read', label: 'Want to Read'},
  {id: 'finished', label: 'Read'},
  {id: 'abandoned', label: 'Abandoned'},
];

const EMPTY_SELECTED_BOOKS = new Set<string>();
const NOOP = () => {};

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
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickAddStatus, setQuickAddStatus] = useState<
    'want_to_read' | 'reading' | 'finished' | 'abandoned'
  >('want_to_read');

  // Reading Shelf status & ownership filters for the shared "All Books" workspace tab
  const [collectionShelfTab, setCollectionShelfTab] =
    useState<ShelfFilterTab>('all');
  const [ownershipFilter, setOwnershipFilter] =
    useState<OwnershipFilter>('all');

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

  // Scoped books for the shared "All Books" collection view
  const shelfFilteredBooks = useMemo(() => {
    return allItems.filter(item => {
      if (
        collectionShelfTab !== 'all' &&
        item.readingStatus !== collectionShelfTab
      ) {
        return false;
      }
      if (ownershipFilter === 'owned') {
        return item.ownershipStatus === 'owned' && !item.isVirtual;
      }
      if (ownershipFilter === 'unowned') {
        return item.ownershipStatus === 'unowned' || item.isVirtual;
      }
      return true;
    });
  }, [allItems, collectionShelfTab, ownershipFilter]);

  // Shared collection filter/sort/viewMode hook (powers Overview | All Books tabs)
  const filters = useBookFilters(shelfFilteredBooks);

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

  const openAllBooksOnShelf = (
    initialTab: ShelfFilterTab = 'all',
    initialGenre: string | null = null,
  ) => {
    setCollectionShelfTab(initialTab);
    if (initialGenre !== null) {
      filters.selectGenreAndGoToCollection(initialGenre);
    } else {
      filters.setFilterGenre('');
      filters.setCurrentTab('collection');
    }
  };

  const openTrackBookDialog = (
    defaultShelf:
      'want_to_read' | 'reading' | 'finished' | 'abandoned' = 'want_to_read',
  ) => {
    setQuickAddStatus(defaultShelf);
    setIsQuickAddOpen(true);
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

  // Reading Status + Ownership filter bar injected into the top of the shared LibraryCollection card
  const readingCollectionHeaderSlot = (
    <div className="pb-2.5 border-b border-outline-variant/50 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
      <div
        className="flex items-center gap-1 p-1 bg-surface-container rounded-lg overflow-x-auto hide-scrollbar"
        role="tablist"
        aria-label="Filter tracked books by reading status"
      >
        {READING_SHELF_TABS.map(tab => {
          const isActive = collectionShelfTab === tab.id;
          const count = shelfCounts[tab.id] ?? 0;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setCollectionShelfTab(tab.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-sans font-medium whitespace-nowrap transition-all flex items-center gap-1.5 cursor-pointer ${
                isActive
                  ? 'bg-surface text-primary font-semibold shadow-2xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`font-mono tabular-nums text-[11px] ${
                  isActive ? 'text-primary' : 'text-on-surface-variant/80'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="flex items-center gap-1 p-1 bg-surface-container rounded-lg self-start sm:self-auto shrink-0"
        role="group"
        aria-label="Filter by book ownership"
      >
        {(
          [
            {id: 'all', label: 'All'},
            {id: 'owned', label: 'In Libraries'},
            {id: 'unowned', label: 'Un-owned'},
          ] as Array<{id: OwnershipFilter; label: string}>
        ).map(opt => {
          const isActive = ownershipFilter === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setOwnershipFilter(opt.id)}
              className={`px-2.5 py-1 rounded-md text-xs font-sans font-medium transition-colors cursor-pointer ${
                isActive
                  ? 'bg-surface text-on-surface font-semibold shadow-2xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col min-w-0 h-full w-full">
      <div className="layout-page-content space-y-12">
        {/* Tier 1: Personal Reading Room (Curated Bento Experience + Shared Workspace Tabs) */}
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
                  onClick={() => openAllBooksOnShelf('reading')}
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
                  onClick={() => openAllBooksOnShelf('want_to_read')}
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
                  onClick={() => openAllBooksOnShelf('finished')}
                  className="hover:text-primary transition-colors cursor-pointer"
                >
                  <strong className="font-mono tabular-nums text-on-surface">
                    {shelfCounts.finished}
                  </strong>{' '}
                  Read
                </button>
              </div>
            </div>

            {/* Shared Workspace Mode Switcher (Overview | All Books — No Shelf Care) + Track a Book CTA */}
            <div className="flex flex-wrap items-center gap-2.5 self-start sm:self-auto shrink-0">
              <div
                className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/60 text-xs font-sans font-medium shrink-0"
                role="tablist"
                aria-label="Reading Room Workspace View"
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  role="tab"
                  aria-selected={filters.currentTab === 'overview'}
                  onClick={() => filters.setCurrentTab('overview')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 h-8 rounded-md transition-all ${
                    filters.currentTab === 'overview'
                      ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50 hover:bg-surface'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface/50'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Overview</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  role="tab"
                  aria-selected={filters.currentTab === 'collection'}
                  onClick={() => filters.setCurrentTab('collection')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 h-8 rounded-md transition-all ${
                    filters.currentTab === 'collection'
                      ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50 hover:bg-surface'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface/50'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span>All Books</span>
                  <Badge
                    variant="outline"
                    size="sm"
                    className="ml-0.5 px-1.5 py-0 font-mono tabular-nums text-[10px] font-semibold bg-surface-container-high/80 text-on-surface border-transparent rounded-sm"
                  >
                    {formatCompactNumber(shelfCounts.all)}
                  </Badge>
                </Button>
              </div>

              <Button
                type="button"
                onClick={() => openTrackBookDialog('want_to_read')}
                className="flex items-center gap-2 min-h-[40px] px-4 sm:px-5 bg-primary text-on-primary font-sans font-semibold rounded-lg hover:bg-primary/90 shadow-xs transition-all whitespace-nowrap"
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
          ) : filters.currentTab === 'collection' ? (
            /* Shared All Books Tab (LibraryCollection + LibraryShelf with Reading Status & Ownership filters) */
            <div className="pt-1">
              <LibraryCollection
                libraryId={`virtual_${user.uid}`}
                books={shelfFilteredBooks}
                sortedBooks={filters.sortedBooks}
                searchQuery={filters.searchQuery}
                setSearchQuery={filters.setSearchQuery}
                sortBy={filters.sortBy}
                setSortBy={filters.setSortBy}
                sortOrder={filters.sortOrder}
                setSortOrder={filters.setSortOrder}
                viewMode={filters.viewMode}
                setViewMode={filters.setViewMode}
                isFiltersOpen={filters.isFiltersOpen}
                setIsFiltersOpen={filters.setIsFiltersOpen}
                filterGenre={filters.filterGenre}
                setFilterGenre={filters.setFilterGenre}
                filterSubgenre={filters.filterSubgenre}
                setFilterSubgenre={filters.setFilterSubgenre}
                activeSubgenres={filters.activeSubgenres}
                filterAuthor={filters.filterAuthor}
                setFilterAuthor={filters.setFilterAuthor}
                filterYearMin={filters.filterYearMin}
                setFilterYearMin={filters.setFilterYearMin}
                filterYearMax={filters.filterYearMax}
                setFilterYearMax={filters.setFilterYearMax}
                availableGenres={filters.availableGenres}
                availableAuthors={filters.availableAuthors}
                clearFilters={() => {
                  filters.clearFilters();
                  setCollectionShelfTab('all');
                  setOwnershipFilter('all');
                }}
                canEdit={false}
                selectedBooks={EMPTY_SELECTED_BOOKS}
                toggleBookSelection={NOOP}
                toggleAllBooks={NOOP}
                handleSort={filters.setSortBy}
                user={user}
                navigate={navigate}
                headerSlot={readingCollectionHeaderSlot}
                emptyTitle="No tracked books on this shelf"
                emptyDescription="Search across global book providers or your libraries to track books you want to read, are reading, or have finished."
                onEmptyAction={() => openTrackBookDialog('want_to_read')}
                emptyActionLabel="Track a Book"
                disablePaddingTop
              />
            </div>
          ) : (
            <ReadingBento
              mode="personal-reading"
              books={allItems}
              isLoading={isLoadingShelf}
              onStatusChange={updateItemStatus}
              onTrackBook={openTrackBookDialog}
              onOpenShelf={openAllBooksOnShelf}
              pickOfTheDay={pickOfTheDay}
              isGeneratingPick={isGeneratingPick}
              generateNewPick={() => void generateNewPick()}
              pickError={pickError}
              onAddPickToWantToRead={pick =>
                void handleAddPickToWantToRead(pick)
              }
              isPickAlreadyTracked={isPickAlreadyTracked}
              isSavingPick={isSavingPick}
            />
          )}
        </section>

        {/* Tier 2: Compact Libraries Section (On the Overview Tab) */}
        {filters.currentTab === 'overview' && (
          <section
            aria-labelledby="libraries-section-heading"
            className="pt-10 border-t border-outline-variant/60 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <span className="metadata-eyebrow block mb-0.5">
                  Owned &amp; Shared Collections
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

            <ErrorBoundary name="Dashboard Libraries">
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
        )}

        {/* Shared Dialogs available on both Overview and All Books tabs */}
        <ErrorBoundary name="Dashboard Modals">
          <CreateLibraryDialog
            isOpen={isCreating}
            isSubmitting={isSubmitting}
            onClose={() => setIsCreating(false)}
            onCreate={createLibrary}
          />

          <QuickAddBookDialog
            isOpen={isQuickAddOpen}
            onClose={() => setIsQuickAddOpen(false)}
            mode="reading"
            initialStatus={quickAddStatus}
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
            onOpenTrackBook={() => openTrackBookDialog('want_to_read')}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
