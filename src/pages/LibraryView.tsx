import React, {useState, useEffect} from 'react';
import {
  useParams,
  useNavigate,
  useSearchParams,
  useLocation,
  Link,
} from 'react-router-dom';
import {
  LayoutDashboard,
  BookOpen,
  Wand2,
  Plus,
  RefreshCw,
  ArrowLeft,
} from 'lucide-react';
import {
  BookshelfBookendsIllustration,
  FallenBookendIllustration,
} from '@/components/ui/empty-state-illustrations';
import {useAuth} from '../stores/authStore';
import {auth} from '../firebase';
import {uploadBase64Image} from '../lib/storage';
import {trpc, trpcVanilla} from '../lib/trpc';
import {toast} from 'sonner';
import {toTitleCase, getFirestoreTime, formatCompactNumber} from '../lib/utils';
import {motion, AnimatePresence} from 'motion/react';
import {formatFullDateTime} from '../lib/date';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {instrumentMutation} from '../lib/telemetry';
import {preloadRouteChunk} from '../lib/routePreload';

// Hooks
import {useLibraryData} from '../hooks/useLibraryData';
import {getAccessFromLibrary} from '../lib/permissions';
import {useBookFilters} from '../hooks/useBookFilters';
import {useSelection} from '../hooks/useSelection';
import {usePickOfTheDay} from '../hooks/usePickOfTheDay';
import {useDebugInspect} from '../hooks/useDebugInspect';
import {useAppPermissions} from '../hooks/useAppPermissions';
import {useOnlineStatus} from '../hooks/useOnlineStatus';

// Components
import {LibraryHeader} from './library/LibraryHeader';
import {LibraryOverview} from './library/LibraryOverview';
import {LibraryCollection} from './library/LibraryCollection';
import {LibrarySettingsModals} from './library/LibrarySettingsModals';
import {BulkActionsBar} from './library/BulkActionsBar';
import {QuickAddBookDialog} from '../components/book/QuickAddBookDialog';
import {ErrorBoundary} from '../components/layout/ErrorBoundary';
import {useDebug} from '../stores/debugStore';
import {
  LibraryMainSkeleton,
  LibraryOverviewSkeleton,
  LibraryCollectionSkeleton,
} from '../components/book/LibrarySkeletons';

export function LibraryView() {
  const {id} = useParams<{id: string}>();
  const {user} = useAuth();
  const {hasAiPlan} = useAppPermissions();
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  // Data fetching (do not pass navigate so transient errors show in-page recovery UI instead of silently bouncing back to /)
  const {
    library,
    books,
    isLoading,
    isBooksLoading,
    isSyncing,
    isError,
    error,
    refetch,
  } = useLibraryData(id, user?.uid);

  // Filters and Sorts
  const filters = useBookFilters(books);

  // Selection logic
  const selection = useSelection(id, user?.uid);

  // Pick of the Day logic
  const picker = usePickOfTheDay(books, filters.currentTab);

  // Debug inspector registration for telemetry of state views
  useDebugInspect('LibraryView_ActiveFilters', {
    searchQuery: filters.searchQuery,
    currentTab: filters.currentTab,
    filterGenre: filters.filterGenre,
    sortBy: filters.sortBy,
    totalBooksLoaded: books.length,
    selectedIdsLength: selection.selectedBooks?.size || 0,
    isSyncing,
    isLoading,
  });

  // Local state for modals and UI
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [libraryToDelete, setLibraryToDelete] = useState(false);

  // Sync open request parameters
  const [searchParams, setSearchParams] = useSearchParams();
  const settingsParam = searchParams.get('settings');
  const shareParam = searchParams.get('share');

  useEffect(() => {
    if (settingsParam === 'true') {
      setIsAdvancedSettingsOpen(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('settings');
      setSearchParams(newParams, {replace: true});
    }
  }, [settingsParam, searchParams, setSearchParams]);

  useEffect(() => {
    if (shareParam === 'true') {
      setIsSettingsOpen(true);
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('share');
      setSearchParams(newParams, {replace: true});
    }
  }, [shareParam, searchParams, setSearchParams]);

  // Scroll restoration
  useEffect(() => {
    if (isLoading || isBooksLoading || !id) {
      return;
    }

    // Only restore/save scroll for the collection tab (Grid/Table views)
    if (filters.currentTab !== 'collection') {
      // If we switched to overview, we usually want to be at the top
      window.scrollTo(0, 0);
      return;
    }

    const scrollKey = `library_scroll_${id}_${filters.viewMode}`;
    let scrollTimer: NodeJS.Timeout;
    const savedScroll = sessionStorage.getItem(scrollKey);

    if (savedScroll) {
      // Small timeout to allow the browser to layout the content after tab/view switch
      scrollTimer = setTimeout(() => {
        const top = parseInt(savedScroll, 10);
        if (top > 0) {
          window.scrollTo({
            top,
            behavior: 'instant' as ScrollBehavior,
          });
        }
      }, 250);
    }

    let scrollRafId: number | null = null;
    const handleScroll = () => {
      if (filters.currentTab !== 'collection' || scrollRafId !== null) {
        return;
      }
      scrollRafId = window.requestAnimationFrame(() => {
        scrollRafId = null;
        if (filters.currentTab === 'collection') {
          sessionStorage.setItem(scrollKey, window.scrollY.toString());
        }
      });
    };

    const registerTimer = setTimeout(() => {
      window.addEventListener('scroll', handleScroll, {passive: true});
    }, 400);

    return () => {
      if (scrollTimer) {
        clearTimeout(scrollTimer);
      }
      if (scrollRafId !== null) {
        window.cancelAnimationFrame(scrollRafId);
      }
      clearTimeout(registerTimer);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [id, isLoading, isBooksLoading, filters.currentTab, filters.viewMode]);

  // Escape key for modals
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLibraryToDelete(false);
        setIsSettingsOpen(false);
        setIsAdvancedSettingsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleRemoveShare = async (email: string) => {
    if (!id || !library) {
      return;
    }
    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        throw new Error('Not logged in');
      }

      const targetEmail = email.trim().toLowerCase();

      await instrumentMutation(
        'update',
        `libraries/${id}`,
        {removeCollaborator: targetEmail},
        () =>
          trpcVanilla.library.removeCollaborator.mutate({
            libraryId: id,
            email: targetEmail,
          }),
      );

      void refetch();
      void utils.library.list?.invalidate?.();
      void utils.library.getCollaborators?.invalidate?.({libraryId: id});
      toast.success(`Removed access for ${email}`);
    } catch (error) {
      console.error('Failed to remove collaborator:', error);
      toast.error('Failed to remove collaborator');
    }
  };

  const handleUpdateRole = async (email: string, role: 'editor' | 'viewer') => {
    if (!id || !library) {
      return;
    }
    try {
      const targetEmail = email.trim().toLowerCase();

      await instrumentMutation(
        'update',
        `libraries/${id}`,
        {upsertCollaborator: {email: targetEmail, role}},
        () =>
          trpcVanilla.library.upsertCollaborator.mutate({
            libraryId: id,
            email: targetEmail,
            role,
          }),
      );

      void refetch();
      void utils.library.list?.invalidate?.();
      void utils.library.getCollaborators?.invalidate?.({libraryId: id});
      toast.success(`Updated role for ${email} to ${toTitleCase(role)}`);
    } catch (error) {
      console.error('Failed to update role:', error);
      toast.error('Failed to update collaborator role');
    }
  };

  const handleRenameLibrary = async (newName: string) => {
    if (!id || !library) {
      return;
    }
    try {
      await instrumentMutation(
        'update',
        `libraries/${id}`,
        {name: newName},
        () =>
          trpcVanilla.library.update.mutate({
            libraryId: id,
            name: newName,
          }),
      );
      void refetch();
      void utils.library.list?.invalidate?.();
      toast.success('Library name updated');
    } catch (error) {
      console.error('Failed to rename library:', error);
      toast.error('Failed to rename library');
    }
  };

  const confirmDeleteLibrary = async () => {
    if (!id) {
      return;
    }
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Not logged in');
      }

      await instrumentMutation(
        'delete',
        `libraries/${id}`,
        {libraryId: id},
        () => trpcVanilla.library.delete.mutate({libraryId: id}),
      );

      toast.success('Library deleted');
      void navigate('/');
    } catch (error) {
      console.error('Failed to delete library:', error);
      toast.error('Failed to delete library');
    } finally {
      setLibraryToDelete(false);
    }
  };

  const handleExportToCsv = () => {
    if (!library || books.length === 0) {
      toast.error('No books to export');
      return;
    }
    const headers = [
      'Title',
      'Author',
      'ISBN',
      'Primary Genre',
      'Subgenres',
      'Format',
      'Timeline Era / Setting',
      'Geographic Settings',
      'Cover Image URL',
      'Published Date',
      'Added Date',
    ];
    const escapeCsv = (str: string | undefined | null) => {
      if (!str) {
        return '""';
      }
      const escaped = String(str).replace(/"/g, '""');
      return `"${escaped}"`;
    };

    const formatYear = (year: number) => {
      if (year < 0) {
        return `${Math.abs(year)} BCE`;
      }
      return `${year}`;
    };

    const rows = books.map(book => {
      let addedDateStr = '';
      if (book.addedAt) {
        const time = getFirestoreTime(book.addedAt);
        if (time > 0) {
          addedDateStr = formatFullDateTime(time);
        }
      }

      // Format
      const formatStr = book.format ? toTitleCase(book.format) : 'Physical';

      // Timeline Era / Setting
      let eraSetting = '';
      if (book.temporalMetadata) {
        const {isNonHistorical, eraName, startYear, endYear} =
          book.temporalMetadata;
        if (isNonHistorical) {
          eraSetting = 'Non-Historical / Secondary World';
        } else if (
          eraName &&
          startYear !== undefined &&
          endYear !== undefined
        ) {
          const yearSpan =
            startYear === endYear
              ? formatYear(startYear)
              : `${formatYear(startYear)} – ${formatYear(endYear)}`;
          eraSetting = `${eraName} (${yearSpan})`;
        } else if (eraName) {
          eraSetting = eraName;
        } else if (startYear !== undefined && endYear !== undefined) {
          eraSetting =
            startYear === endYear
              ? formatYear(startYear)
              : `${formatYear(startYear)} – ${formatYear(endYear)}`;
        } else if (startYear !== undefined) {
          eraSetting = `Circa ${formatYear(startYear)}`;
        }
      }

      // Geographic Settings
      let geoSettings = '';
      if (book.geoMetadata) {
        if (book.geoMetadata.isNonEarth) {
          geoSettings = 'Non-Earth / Fantasy Setting';
        } else if (
          book.geoMetadata.locations &&
          book.geoMetadata.locations.length > 0
        ) {
          geoSettings = book.geoMetadata.locations
            .map(l => l.name)
            .filter(Boolean)
            .join('; ');
        }
      }

      // Cover Image URL
      const coverUrl = book.coverUrl || book.coverUrlRaw || '';

      return [
        escapeCsv(book.title),
        escapeCsv(book.author),
        escapeCsv(book.isbn),
        escapeCsv(book.primaryGenre || ''),
        escapeCsv(book.subgenres?.join(', ') || ''),
        escapeCsv(formatStr),
        escapeCsv(eraSetting),
        escapeCsv(geoSettings),
        escapeCsv(coverUrl),
        escapeCsv(book.publishedDate),
        escapeCsv(addedDateStr),
      ].join(',');
    });
    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${library.name
      .replace(/[\s/\\<>:"|?*]/g, '_')
      .toLowerCase()}_export.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Library exported to CSV');
  };

  const access = getAccessFromLibrary(library, user?.uid, user?.email);
  const isOwner = access.isOwner;
  const canEdit = access.canEdit;

  const {setDebugData, isDebugMode} = useDebug();

  const [isRefreshingHero, setIsRefreshingHero] = useState(false);
  const generateLibraryHeroImageMutation =
    trpc.gemini.generateLibraryHeroImage.useMutation();

  const handleRefreshHero = async () => {
    if (!id || !library || isRefreshingHero || !hasAiPlan || !isOnline) {
      return;
    }
    setIsRefreshingHero(true);
    const toastId = toast.loading('Generating library banner...');
    try {
      const url = await generateLibraryHeroImageMutation.mutateAsync({
        libraryName: library.name,
      });
      if (url) {
        const storagePath = `libraries/${id}/hero.png`;
        const storageUrl = await uploadBase64Image(url, storagePath);
        await instrumentMutation(
          'update',
          `libraries/${id}`,
          {heroImageUrl: storageUrl},
          () =>
            trpcVanilla.library.update.mutate({
              libraryId: id,
              heroImageUrl: storageUrl,
            }),
        );
        toast.success('Library banner updated!', {id: toastId});
      } else {
        toast.error('Failed to generate a new hero image.', {id: toastId});
      }
    } catch (error) {
      console.error('Error refreshing hero image:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const isKeyErr =
        errMsg.includes('GEMINI_API_KEY') ||
        errMsg.includes('key not valid') ||
        errMsg.includes('API_KEY_INVALID') ||
        errMsg.includes('INVALID_ARGUMENT') ||
        errMsg.includes('API key') ||
        errMsg.includes('Secrets');

      if (isKeyErr) {
        toast.error(
          'Gemini API Key is invalid or pending. Please configure a valid key in Settings > Secrets.',
          {id: toastId, duration: 6000},
        );
      } else {
        toast.error(`Failed to generate a new hero image: ${errMsg}`, {
          id: toastId,
        });
      }
    } finally {
      setIsRefreshingHero(false);
    }
  };

  const location = useLocation();

  useEffect(() => {
    if (library && isDebugMode) {
      const timer = setTimeout(() => {
        setDebugData(
          {
            id: library.id,
            name: library.name,
            ownerId: library.ownerId,
            access: library.access,
            createdAt: library.createdAt,
            summary: `[Books in collection: ${books?.length || 0}]`,
          },
          'Library Document',
        );
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [library, books, isDebugMode, setDebugData, location.pathname]);

  if (isLoading) {
    return <LibraryMainSkeleton tab={filters.currentTab} />;
  }

  if (!library) {
    if (!isOnline) {
      return (
        <div className="layout-page-content flex items-center justify-center min-h-[60vh]">
          <div className="py-12 px-6 bg-surface-container-low rounded-xl border border-outline-variant/40 shadow-elevation-1 text-center max-w-lg w-full">
            <div className="flex items-center justify-center mx-auto mb-3 text-on-surface">
              <BookshelfBookendsIllustration className="w-24 h-16" />
            </div>
            <h2 className="font-serif text-xl font-semibold text-on-surface mb-2">
              Not Available Offline Yet
            </h2>
            <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-6">
              This library hasn&apos;t been saved to your device&apos;s offline
              archive yet. Connect to the internet once to open and cache this
              shelf.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void navigate('/')}
                className="flex items-center gap-2 rounded-lg font-sans font-semibold"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Return to Reading Room</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    if (isError) {
      return (
        <div className="layout-page-content flex items-center justify-center min-h-[60vh]">
          <div
            role="alert"
            className="py-12 px-6 bg-surface-container-low rounded-xl border border-destructive/30 shadow-elevation-1 text-center max-w-lg w-full"
          >
            <div className="flex items-center justify-center mx-auto mb-3 text-on-surface">
              <FallenBookendIllustration className="w-24 h-16" />
            </div>
            <h2 className="font-serif text-xl font-semibold text-on-surface mb-2">
              Unable to Open Library
            </h2>
            <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-6 break-words">
              {error instanceof Error
                ? error.message
                : 'This library could not be found or you may not have permission to view it.'}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => void navigate('/')}
                className="flex items-center gap-2 rounded-lg font-sans font-semibold"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Reading Room</span>
              </Button>
              <Button
                type="button"
                onClick={() => void refetch()}
                className="flex items-center gap-2 rounded-lg font-sans font-semibold"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Retry</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return <LibraryMainSkeleton tab={filters.currentTab} />;
  }

  return (
    <>
      <div className="flex-grow flex flex-col min-h-screen w-full">
        <div className="flex-1 flex flex-col min-w-0">
          <ErrorBoundary name="Library Collection Header">
            <LibraryHeader
              library={library}
              books={books}
              isOwner={isOwner}
              isSyncing={isSyncing}
              role={access.role}
              canEdit={canEdit}
              hasAiPlan={hasAiPlan}
              isRefreshingHero={isRefreshingHero}
              onRefreshHero={handleRefreshHero}
            />
          </ErrorBoundary>

          {/* Sticky Library Command Bar */}
          <div className="sticky top-16 z-20 bg-background/95 backdrop-blur-md border-b border-outline-variant/60">
            <div className="w-full max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-2 sm:gap-4">
              {/* Segmented Workspace Mode Switcher */}
              <div className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/60 text-xs font-sans font-medium shrink-0">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => filters.setCurrentTab('overview')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 h-8 rounded-md transition-all ${
                    filters.currentTab === 'overview'
                      ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50 hover:bg-surface'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface/50'
                  }`}
                >
                  <LayoutDashboard
                    className="w-3.5 h-3.5 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span>Overview</span>
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => filters.setCurrentTab('collection')}
                  className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 h-8 rounded-md transition-all ${
                    filters.currentTab === 'collection'
                      ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/50 hover:bg-surface'
                      : 'text-on-surface-variant hover:text-on-surface hover:bg-surface/50'
                  }`}
                >
                  <BookOpen
                    className="w-3.5 h-3.5 shrink-0"
                    strokeWidth={1.75}
                  />
                  <span className="hidden sm:inline">All Books</span>
                  <span className="sm:hidden">Books</span>
                  <Badge
                    variant="outline"
                    size="sm"
                    className="ml-0.5 px-1.5 py-0 font-mono tabular-nums text-[10px] font-semibold bg-surface-container-high/80 text-on-surface border-transparent rounded-sm"
                    title={
                      isBooksLoading && books.length === 0
                        ? undefined
                        : `${
                            isSyncing && typeof library.bookCount === 'number'
                              ? Math.max(books.length, library.bookCount)
                              : books.length
                          } volumes`
                    }
                  >
                    {isBooksLoading && books.length === 0
                      ? library.bookCount !== undefined
                        ? formatCompactNumber(library.bookCount)
                        : '...'
                      : formatCompactNumber(
                          isSyncing && typeof library.bookCount === 'number'
                            ? Math.max(books.length, library.bookCount)
                            : books.length,
                        )}
                  </Badge>
                </Button>

                {canEdit &&
                  (isOnline ? (
                    <Link
                      to={`/library/${id}/spruce-up`}
                      onMouseEnter={() => preloadRouteChunk('spruceUp')}
                      onFocus={() => preloadRouteChunk('spruceUp')}
                      className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-8 rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface/50 transition-all"
                      title="Shelf Care & Health"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Shelf Care</span>
                    </Link>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 h-8 rounded-md text-on-surface-variant/50 opacity-50 cursor-not-allowed"
                      title="Unavailable while offline"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Shelf Care</span>
                    </button>
                  ))}
              </div>

              {/* Right Action: Primary Add Books Action (Opens shared Quick Search Dialog) */}
              {canEdit && (
                <button
                  type="button"
                  disabled={!isOnline}
                  onClick={() => isOnline && setIsQuickAddOpen(true)}
                  onMouseEnter={() => isOnline && preloadRouteChunk('addBook')}
                  onFocus={() => isOnline && preloadRouteChunk('addBook')}
                  className="flex items-center gap-1.5 px-3 sm:px-4 h-9 rounded-lg bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-xs font-sans font-semibold transition-all shadow-xs shrink-0 cursor-pointer"
                  title={!isOnline ? 'Unavailable while offline' : 'Add Books'}
                >
                  <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                  <span className="hidden sm:inline">Add Books</span>
                  <span className="sm:hidden">Add</span>
                </button>
              )}
            </div>
          </div>

          <div className="relative flex-grow flex flex-col pt-4 sm:pt-6">
            <AnimatePresence mode="wait">
              {filters.currentTab === 'overview' ? (
                <motion.div
                  key="overview"
                  initial={{opacity: 0, x: -10}}
                  animate={{opacity: 1, x: 0}}
                  exit={{opacity: 0, x: 10}}
                  transition={{duration: 0.2}}
                  className="flex-grow flex flex-col"
                >
                  <ErrorBoundary name="Library Overview">
                    {isBooksLoading && books.length === 0 ? (
                      <LibraryOverviewSkeleton />
                    ) : (
                      <LibraryOverview
                        books={books}
                        library={library}
                        user={user}
                        pickOfTheDay={picker.pickOfTheDay}
                        isGeneratingPick={picker.isGeneratingPick}
                        generateNewPick={picker.generateNewPick}
                        setCurrentTab={filters.setCurrentTab}
                        setFilterGenre={filters.setFilterGenre}
                        setIsFiltersOpen={filters.setIsFiltersOpen}
                        selectGenreAndGoToCollection={
                          filters.selectGenreAndGoToCollection
                        }
                        pickError={picker.error}
                        onAddBook={() => isOnline && setIsQuickAddOpen(true)}
                      />
                    )}
                  </ErrorBoundary>
                </motion.div>
              ) : (
                <motion.div
                  key="collection"
                  initial={{opacity: 0, x: 10}}
                  animate={{opacity: 1, x: 0}}
                  exit={{opacity: 0, x: -10}}
                  transition={{duration: 0.2}}
                  className="flex-grow flex flex-col"
                >
                  <ErrorBoundary name="Library Collection Shelf">
                    {isBooksLoading && books.length === 0 ? (
                      <LibraryCollectionSkeleton />
                    ) : (
                      <LibraryCollection
                        libraryId={id!}
                        books={books}
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
                        clearFilters={filters.clearFilters}
                        canEdit={canEdit && isOnline}
                        selectedBooks={selection.selectedBooks}
                        toggleBookSelection={selection.toggleBookSelection}
                        toggleAllBooks={selection.toggleAllBooks}
                        handleSort={filters.setSortBy}
                        user={user}
                        navigate={navigate}
                        onEmptyAction={
                          canEdit && isOnline
                            ? () => setIsQuickAddOpen(true)
                            : undefined
                        }
                      />
                    )}
                  </ErrorBoundary>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {canEdit && (
            <QuickAddBookDialog
              isOpen={isQuickAddOpen}
              onClose={() => setIsQuickAddOpen(false)}
              mode="library"
              libraryId={id}
              libraryName={library.name}
            />
          )}

          <LibrarySettingsModals
            isSettingsOpen={isSettingsOpen}
            setIsSettingsOpen={setIsSettingsOpen}
            isAdvancedSettingsOpen={isAdvancedSettingsOpen}
            setIsAdvancedSettingsOpen={setIsAdvancedSettingsOpen}
            libraryToDelete={libraryToDelete}
            setLibraryToDelete={setLibraryToDelete}
            library={library}
            isOwner={isOwner}
            canEdit={canEdit}
            addShareEmail={async (email, role) => {
              if (!id || !library || !email.trim()) {
                return;
              }
              try {
                const currentUser = auth.currentUser;
                if (!currentUser) {
                  throw new Error('Not logged in');
                }

                const newEmail = email.trim().toLowerCase();

                const res = await instrumentMutation(
                  'update',
                  `libraries/${id}`,
                  {upsertCollaborator: {email: newEmail, role}},
                  () =>
                    trpcVanilla.library.upsertCollaborator.mutate({
                      libraryId: id,
                      email: newEmail,
                      role,
                    }),
                );

                void refetch();
                void utils.library.list?.invalidate?.();
                void utils.library.getCollaborators?.invalidate?.({
                  libraryId: id,
                });

                if (res?.allowlistStatus === 'pending_approval') {
                  toast.success(
                    `Invited ${newEmail} as ${toTitleCase(role)} (Pending admin waitlist approval)`,
                  );
                } else {
                  toast.success(
                    `Shared with ${newEmail} as ${toTitleCase(role)}`,
                  );
                }
              } catch (error) {
                console.error('Failed to share library:', error);
                toast.error('Failed to update collaborator access');
              }
            }}
            handleRemoveShare={handleRemoveShare}
            handleUpdateRole={handleUpdateRole}
            handleRenameLibrary={handleRenameLibrary}
            handleExportToCsv={handleExportToCsv}
            handleDeleteLibrary={() => setLibraryToDelete(true)}
            confirmDeleteLibrary={confirmDeleteLibrary}
          />

          {canEdit && (
            <BulkActionsBar
              selectedCount={selection.selectedBooks.size}
              onClear={selection.clearSelection}
              onStatusChange={selection.handleBulkStatusChange}
            />
          )}
        </div>
      </div>
    </>
  );
}
