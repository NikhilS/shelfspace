import React, {useState, useEffect} from 'react';
import {
  useParams,
  useNavigate,
  useSearchParams,
  useLocation,
} from 'react-router-dom';
import {useAuth} from '../stores/authStore';
import {auth, db, handleFirestoreError, OperationType} from '../firebase';
import {uploadBase64Image} from '../services/db/storage';
import {
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';

import {toast} from 'sonner';
import {toTitleCase, getFirestoreTime} from '../lib/utils';
import {motion, AnimatePresence} from 'motion/react';
import {format} from 'date-fns';
import {Library} from '../types';
import {trpc} from '../lib/trpc';

// Hooks
import {useLibraryData} from '../hooks/useLibraryData';
import {getAccessFromLibrary} from '../hooks/useLibraryAccess';
import {useBookFilters} from '../hooks/useBookFilters';
import {useSelection} from '../hooks/useSelection';
import {usePickOfTheDay} from '../hooks/usePickOfTheDay';
import {useDebugInspect} from '../hooks/useDebugInspect';

// Components
import {LibraryHeader} from './library/LibraryHeader';
import {LibraryOverview} from './library/LibraryOverview';
import {LibraryCollection} from './library/LibraryCollection';
import {LibrarySettingsModals} from './library/LibrarySettingsModals';
import {BulkActionsBar} from './library/BulkActionsBar';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useDebug} from '../stores/debugStore';
import {PageLoading} from '../components/PageLoading';

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

      const targetEmail = email.trim().toLowerCase();

      const updateData: Partial<Library> = {};

      // Remove from access
      if (library.access && library.access[targetEmail]) {
        const newAccess = {...library.access};
        delete newAccess[targetEmail];
        updateData.access = newAccess;
      }

      await updateDoc(doc(db, 'libraries', id), updateData);

      toast.success(`Removed access for ${email}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}`);
    }
  };

  const handleUpdateRole = async (email: string, role: 'editor' | 'viewer') => {
    if (!id || !library) return;
    try {
      const targetEmail = email.trim().toLowerCase();
      const newAccess = {...(library.access || {})};
      newAccess[targetEmail] = role;

      await updateDoc(doc(db, 'libraries', id), {
        access: newAccess,
      });

      toast.success(`Updated role for ${email} to ${role}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}`);
    }
  };

  const confirmDeleteLibrary = async () => {
    if (!id) return;
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not logged in');

      // Fetch all books in the library to delete them (optional cleanup, but good practice)
      const booksRef = collection(db, 'libraries', id, 'books');
      const booksSnap = await getDocs(booksRef);

      const batch = writeBatch(db);

      // Add deletes for all books
      booksSnap.forEach(bookDoc => {
        batch.delete(bookDoc.ref);
        // Note: this won't delete subcollections of books like reviews if they exist,
        // but for a client-side delete it's okay to skip deeper orphans rather than building a full recursive delete here.
      });

      // Delete the library document itself
      const libRef = doc(db, 'libraries', id);
      batch.delete(libRef);

      await batch.commit();

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
        if (time > 0) addedDateStr = format(new Date(time), 'PPpp');
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

  const access = getAccessFromLibrary(library, user?.uid, user?.email);
  const isOwner = access.isOwner;
  const canEdit = access.canEdit;

  const {setDebugData} = useDebug();

  const [isRefreshingHero, setIsRefreshingHero] = useState(false);
  const generateLibraryHeroImageMutation =
    trpc.gemini.generateLibraryHeroImage.useMutation();

  const handleRefreshHero = async () => {
    if (!id || !library || isRefreshingHero) return;
    setIsRefreshingHero(true);
    const toastId = toast.loading('Generating a fun & playful hero banner...');
    try {
      const url = await generateLibraryHeroImageMutation.mutateAsync({
        libraryName: library.name,
      });
      if (url) {
        const storagePath = `libraries/${id}/hero.png`;
        const storageUrl = await uploadBase64Image(url, storagePath);
        await updateDoc(doc(db, 'libraries', id), {
          heroImageUrl: storageUrl,
        });
        toast.success('Hero image refreshed!', {id: toastId});
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
    if (library) {
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
  }, [library, books, setDebugData, location.pathname]);

  const isLibraryLoading = isLoading || (isBooksLoading && books.length === 0);

  if (isLibraryLoading || !library) {
    return (
      <PageLoading
        title="Opening the archives..."
        subtitle="Verifying credentials, consulting the catalog, and preparing your collection."
      />
    );
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
              isRefreshingHero={isRefreshingHero}
              onRefreshHero={handleRefreshHero}
            />
          </ErrorBoundary>

          <div className="relative flex-grow flex flex-col pt-6">
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
                      selectGenreAndGoToCollection={
                        filters.selectGenreAndGoToCollection
                      }
                      pickError={picker.error}
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
            addShareEmail={async (email, role) => {
              if (!id || !library || !email.trim()) return;
              try {
                const user = auth.currentUser;
                if (!user) throw new Error('Not logged in');

                const newEmail = email.trim().toLowerCase();
                const newAccess = {...(library.access || {})};
                newAccess[newEmail] = role;

                // 1. Update library access
                await updateDoc(doc(db, 'libraries', id), {
                  access: newAccess,
                });

                // 2. Auto-provision to global allowlist
                await setDoc(
                  doc(db, 'appSettings/allowlist/users', newEmail),
                  {
                    email: newEmail,
                    addedAt: serverTimestamp(),
                  },
                  {merge: true},
                );

                toast.success(`Shared with ${email} as ${toTitleCase(role)}`);
              } catch (error) {
                handleFirestoreError(
                  error,
                  OperationType.UPDATE,
                  `libraries/${id}`,
                );
              }
            }}
            handleRemoveShare={handleRemoveShare}
            handleUpdateRole={handleUpdateRole}
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
