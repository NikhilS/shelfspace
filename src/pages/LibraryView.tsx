import React, {useState, useEffect} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {auth, handleFirestoreError, OperationType} from '../firebase';

import {toast} from 'sonner';
import {toTitleCase, getFirestoreTime} from '../lib/utils';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import {motion, AnimatePresence} from 'motion/react';

// Hooks
import {useLibraryData} from '../hooks/useLibraryData';
import {useBookFilters} from '../hooks/useBookFilters';
import {useSelection} from '../hooks/useSelection';
import {usePickOfTheDay} from '../hooks/usePickOfTheDay';

// Components
import {LibraryHeader} from './library/LibraryHeader';
import {LibraryOverview} from './library/LibraryOverview';
import {LibraryCollection} from './library/LibraryCollection';
import {LibrarySettingsModals} from './library/LibrarySettingsModals';
import {BulkActionsBar} from './library/BulkActionsBar';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {PageLoading} from '../components/PageLoading';
import {useDebug} from '../contexts/DebugContext';

export default function LibraryView() {
  const {id} = useParams<{id: string}>();
  const {user} = useAuth();
  const navigate = useNavigate();

  // Data fetching
  const {library, books, isLoading, isBooksLoading, isSyncing} = useLibraryData(
    id,
    user?.uid,
    navigate,
  );

  // Filters and Sorts
  const filters = useBookFilters(books);

  // Selection logic
  const selection = useSelection(id, user?.uid);

  // Pick of the Day logic
  const picker = usePickOfTheDay(books, filters.currentTab);

  // Local state for modals and UI
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [libraryToDelete, setLibraryToDelete] = useState(false);

  // Scroll restoration
  useEffect(() => {
    if (isLoading || isBooksLoading || !id) return;

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

    const handleScroll = () => {
      if (filters.currentTab === 'collection') {
        sessionStorage.setItem(scrollKey, window.scrollY.toString());
      }
    };

    const registerTimer = setTimeout(() => {
      window.addEventListener('scroll', handleScroll, {passive: true});
    }, 400);

    return () => {
      if (scrollTimer) clearTimeout(scrollTimer);
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
    if (!id || !library) return;
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not logged in');
      const token = await user.getIdToken();

      const res = await fetch(`/api/libraries/${id}/share/${email}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Failed to remove share');
      }

      toast.success(`Removed access for ${email}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}`);
    }
  };

  const confirmDeleteLibrary = async () => {
    if (!id) return;
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not logged in');
      const token = await user.getIdToken();
      const res = await fetch(`/api/libraries/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to delete library from server');
      }

      toast.success('Library deleted');
      void navigate('/');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `libraries/${id}`);
    } finally {
      setLibraryToDelete(false);
    }
  };

  const handleExportToCSV = () => {
    if (!library || books.length === 0) {
      toast.error('No books to export');
      return;
    }
    const headers = [
      'Title',
      'Author',
      'ISBN',
      'Genre',
      'Published Date',
      'Added Date',
    ];
    const escapeCSV = (str: string | undefined) => {
      if (!str) return '""';
      const escaped = String(str).replace(/"/g, '""');
      return `"${escaped}"`;
    };
    const rows = books.map(book => {
      let addedDateStr = '';
      if (book.addedAt) {
        const time = getFirestoreTime(book.addedAt);
        if (time > 0) addedDateStr = new Date(time).toLocaleString();
      }
      return [
        escapeCSV(book.title),
        escapeCSV(book.author),
        escapeCSV(book.isbn),
        escapeCSV(book.genres?.join(', ') || ''),
        escapeCSV(book.publishedDate),
        escapeCSV(addedDateStr),
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

  const isOwner = library?.ownerId === user?.uid;
  const canEdit = !!(
    isOwner ||
    (user?.email && library?.sharedWith?.includes(user.email))
  );

  const {setDebugData} = useDebug();

  useEffect(() => {
    if (library) {
      setDebugData(
        {
          id: library.id,
          name: library.name,
          ownerId: library.ownerId,
          sharedWith: library.sharedWith,
          createdAt: library.createdAt,
          summary: `[Books in collection: ${books?.length || 0}]`,
        },
        'Library Document',
      );
    }
  }, [library, books, setDebugData]);

  if ((isLoading || isBooksLoading) && books.length === 0) {
    return (
      <PageLoading
        title="Opening the vaults..."
        subtitle="Fetching catalog, blowing off dust, and retrieving your reading history."
      />
    );
  }

  if (!library) return null;

  return (
    <>
      <LibrarySidebarNav
        libraryId={id}
        onOpenSettings={() =>
          setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)
        }
        onOpenShare={() => setIsSettingsOpen(!isSettingsOpen)}
      />

      <div className="flex-grow flex flex-col min-h-screen w-full">
        <div className="layout-page">
          <ErrorBoundary name="Library Collection Header">
            <LibraryHeader
              library={library}
              books={books}
              isOwner={isOwner}
              isSyncing={isSyncing}
            />
          </ErrorBoundary>

          {/* Tabs Navigation */}
          <div className="w-full px-4 sm:px-8 pt-4 border-b border-outline-variant/30 flex flex-col sm:flex-row justify-between sm:items-end gap-3 sm:gap-0 bg-surface-container-lowest">
            <div className="flex gap-6 overflow-x-auto no-scrollbar">
              {(['overview', 'collection'] as const).map(tab => (
                <button
                  key={tab}
                  onClick={() => filters.setCurrentTab(tab)}
                  className={`pb-3 font-label-caps uppercase cursor-pointer tracking-wider text-sm transition-colors border-b-2 whitespace-nowrap ${filters.currentTab === tab ? 'border-primary text-primary' : 'border-transparent text-on-surface-variant hover:text-primary'}`}
                >
                  {toTitleCase(tab)}
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex-grow flex flex-col">
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
                    />
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
                      filterAuthor={filters.filterAuthor}
                      setFilterAuthor={filters.setFilterAuthor}
                      filterYearMin={filters.filterYearMin}
                      setFilterYearMin={filters.setFilterYearMin}
                      filterYearMax={filters.filterYearMax}
                      setFilterYearMax={filters.setFilterYearMax}
                      availableGenres={filters.availableGenres}
                      availableAuthors={filters.availableAuthors}
                      clearFilters={filters.clearFilters}
                      canEdit={canEdit}
                      selectedBooks={selection.selectedBooks}
                      toggleBookSelection={selection.toggleBookSelection}
                      toggleAllBooks={selection.toggleAllBooks}
                      handleSort={filters.setSortBy}
                      user={user}
                      navigate={navigate}
                    />
                  </ErrorBoundary>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

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
            addShareEmail={async email => {
              if (!id || !library || !email.trim()) return;
              try {
                const user = auth.currentUser;
                if (!user) throw new Error('Not logged in');
                const token = await user.getIdToken();
                const res = await fetch(`/api/libraries/${id}/share`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({email: email.trim().toLowerCase()}),
                });
                if (!res.ok) {
                  const errorData = await res.json();
                  throw new Error(errorData.error || 'Failed to share library');
                }
                toast.success(`Shared with ${email}`);
              } catch (error) {
                handleFirestoreError(
                  error,
                  OperationType.UPDATE,
                  `libraries/${id}`,
                );
              }
            }}
            handleRemoveShare={handleRemoveShare}
            handleExportToCSV={handleExportToCSV}
            handleDeleteLibrary={() => setLibraryToDelete(true)}
            confirmDeleteLibrary={confirmDeleteLibrary}
          />

          <BulkActionsBar
            selectedCount={selection.selectedBooks.size}
            onClear={selection.clearSelection}
            onStatusChange={selection.handleBulkStatusChange}
          />
        </div>
      </div>
    </>
  );
}
