import React, {useState, useEffect} from 'react';
import {useParams, Link, useNavigate, useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {
  doc,
  updateDoc,
  writeBatch,
  getDocs,
  collection,
} from 'firebase/firestore';
import {ArrowLeft, Plus, Share2, Settings, Map, Wand2} from 'lucide-react';
import {toast} from 'sonner';
import {toTitleCase, getFirestoreTime} from '../lib/utils';
import SidebarActions from '../components/SidebarActions';
import Chatbot from '../components/Chatbot';

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

export default function LibraryView() {
  const {id} = useParams<{id: string}>();
  const {user} = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Data fetching
  const {library, books, isLoading, isBooksLoading} = useLibraryData(
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
  const [shareEmail, setShareEmail] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isAdvancedSettingsOpen, setIsAdvancedSettingsOpen] = useState(false);
  const [libraryToDelete, setLibraryToDelete] = useState(false);

  // Scroll restoration
  useEffect(() => {
    if (isLoading || isBooksLoading || !id) return;
    const savedScroll = sessionStorage.getItem(`library_scroll_${id}`);
    if (savedScroll) {
      requestAnimationFrame(() => {
        window.scrollTo(0, parseInt(savedScroll, 10));
      });
    }
    const handleScroll = () => {
      sessionStorage.setItem(`library_scroll_${id}`, window.scrollY.toString());
    };
    const timeoutId = setTimeout(() => {
      window.addEventListener('scroll', handleScroll, {passive: true});
    }, 100);
    return () => {
      clearTimeout(timeoutId);
      window.removeEventListener('scroll', handleScroll);
    };
  }, [id, isLoading, isBooksLoading]);

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

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !library || !shareEmail.trim()) return;
    try {
      const email = shareEmail.trim().toLowerCase();
      const newSharedWith = [...new Set([...library.sharedWith, email])];
      await updateDoc(doc(db, 'libraries', id), {sharedWith: newSharedWith});
      setShareEmail('');
      toast.success(`Shared with ${email}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}`);
    }
  };

  const handleRemoveShare = async (email: string) => {
    if (!id || !library) return;
    try {
      const newSharedWith = library.sharedWith.filter(e => e !== email);
      await updateDoc(doc(db, 'libraries', id), {sharedWith: newSharedWith});
      toast.success(`Removed access for ${email}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `libraries/${id}`);
    }
  };

  const confirmDeleteLibrary = async () => {
    if (!id) return;
    try {
      const batch = writeBatch(db);
      const booksRef = collection(db, 'libraries', id, 'books');
      const booksSnapshot = await getDocs(booksRef);
      booksSnapshot.forEach(doc => batch.delete(doc.ref));
      batch.delete(doc(db, 'libraries', id));
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
    const blob = new Blob([csvContent], {type: 'text/csv;charset=utf-8;'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${library.name
      .replace(/[^a-z0-9]/gi, '_')
      .toLowerCase()}_export.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Library exported to CSV');
  };

  const isOwner = library?.ownerId === user?.uid;
  const canEdit = !!(
    isOwner || library?.sharedWith.includes(user?.email || '')
  );

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
      <SidebarActions>
        <>
          <Link
            to="/"
            className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
          >
            <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
            <span>Back to Libraries</span>
          </Link>
          <Link
            to={`/library/${id}/constellation`}
            className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
          >
            <Map className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
            <span>Constellation Map</span>
          </Link>
          {canEdit && (
            <button
              onClick={() =>
                navigate(`/library/${id}/add`, {
                  state: {from: location.pathname + location.search},
                })
              }
              className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
            >
              <Plus className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
              <span>Add Book</span>
            </button>
          )}
          {canEdit && (
            <Link
              to={`/library/${id}/spruce-up`}
              className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
            >
              <Wand2 className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
              <span>Spruce Up Library</span>
            </Link>
          )}
          {canEdit && (
            <button
              onClick={() => setIsAdvancedSettingsOpen(!isAdvancedSettingsOpen)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer ${isAdvancedSettingsOpen ? 'bg-surface-container text-primary shadow-sm' : 'text-on-surface hover:text-primary hover:bg-surface-container'}`}
            >
              <Settings className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
              <span>Settings</span>
            </button>
          )}
          {isOwner && (
            <button
              onClick={() => setIsSettingsOpen(!isSettingsOpen)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer ${isSettingsOpen ? 'bg-surface-container text-primary shadow-sm' : 'text-on-surface hover:text-primary hover:bg-surface-container'}`}
            >
              <Share2 className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
              <span>Share</span>
            </button>
          )}
        </>
      </SidebarActions>

      <div className="flex-grow flex flex-col min-h-screen w-full">
        <div className="flex-grow flex flex-col w-full">
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

          {filters.currentTab === 'overview' ? (
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
          ) : (
            <>
              <ErrorBoundary name="Library Collection Header">
                <LibraryHeader
                  library={library}
                  books={books}
                  isOwner={isOwner}
                />
              </ErrorBoundary>
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
            </>
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
            shareEmail={shareEmail}
            setShareEmail={setShareEmail}
            handleShare={handleShare}
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

          <Chatbot
            libraryBooks={books.map(b => ({
              title: b.title,
              author: b.author,
              genres: b.genres,
            }))}
          />
        </div>
      </div>
    </>
  );
}
