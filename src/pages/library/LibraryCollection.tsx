import React, {useMemo} from 'react';
import {
  Search,
  SlidersHorizontal,
  LayoutGrid,
  Table as TableIcon,
  ArrowUp,
  ArrowDown,
  Book as BookIcon,
  Plus,
  X,
} from 'lucide-react';
import {LibraryShelf} from './LibraryShelf';
import {Book} from '../../types';
import {SortOption} from '../../hooks/useBookFilters';
import {User} from 'firebase/auth';
import {NavigateFunction} from 'react-router-dom';
import {Input} from '../../components/ui/input';
import {Button} from '../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select';

interface LibraryCollectionProps {
  libraryId: string;
  books: Book[];
  sortedBooks: Book[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  sortBy: SortOption;
  setSortBy: (sort: SortOption) => void;
  sortOrder: 'asc' | 'desc';
  setSortOrder: (order: 'asc' | 'desc') => void;
  viewMode: 'standard' | 'table';
  setViewMode: (mode: 'standard' | 'table') => void;
  isFiltersOpen: boolean;
  setIsFiltersOpen: (open: boolean) => void;
  filterGenre: string;
  setFilterGenre: (genre: string) => void;
  filterAuthor: string;
  setFilterAuthor: (author: string) => void;
  filterYearMin: string;
  setFilterYearMin: (yr: string) => void;
  filterYearMax: string;
  setFilterYearMax: (yr: string) => void;
  availableGenres: string[];
  availableAuthors: string[];
  clearFilters: () => void;
  canEdit: boolean;
  selectedBooks: Set<string>;
  toggleBookSelection: (e: React.MouseEvent, bookId: string) => void;
  toggleAllBooks: (books: Book[]) => void;
  handleSort: (option: SortOption) => void;
  user: User | null;
  navigate: NavigateFunction;
}

export const LibraryCollection: React.FC<LibraryCollectionProps> = ({
  libraryId,
  books,
  sortedBooks,
  searchQuery,
  setSearchQuery,
  sortBy,
  sortOrder,
  setSortOrder,
  viewMode,
  setViewMode,
  isFiltersOpen,
  setIsFiltersOpen,
  filterGenre,
  setFilterGenre,
  filterAuthor,
  setFilterAuthor,
  filterYearMin,
  setFilterYearMin,
  filterYearMax,
  setFilterYearMax,
  availableGenres,
  availableAuthors,
  clearFilters,
  canEdit,
  selectedBooks,
  toggleBookSelection,
  toggleAllBooks,
  handleSort,
  user,
  navigate,
}) => {
  const hasActiveFilters = Boolean(
    filterGenre || filterAuthor || filterYearMin || filterYearMax,
  );

  const activeFilterCount =
    (filterGenre ? 1 : 0) +
    (filterAuthor ? 1 : 0) +
    (filterYearMin || filterYearMax ? 1 : 0);

  const quickGenres = useMemo(() => {
    return availableGenres.slice(0, 8);
  }, [availableGenres]);

  return (
    <>
      <div className="sticky top-16 z-30 flex flex-col border-b border-outline-variant/30 bg-surface/90 backdrop-blur-md transition-all shadow-xs">
        {/* Main Controls Row: Ultra-compact, responsive, touch-friendly */}
        <div className="px-3 sm:px-6 py-2 flex items-center justify-between gap-2 sm:gap-3">
          {/* Search Bar with clear button */}
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none" />
            <Input
              className="pl-9 pr-8 h-9 text-sm rounded-full bg-surface-container-low border-outline-variant/40 focus:bg-surface"
              placeholder="Search title, author, isbn..."
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="Clear search"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary p-0.5 rounded-full"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Action buttons: Filter & Sort Drawer trigger, Grid/Table view */}
          <div className="flex items-center gap-1.5 sm:gap-2 flex-shrink-0">
            {/* Filter & Sort Button (opens bottom sheet on mobile, dialog on desktop) */}
            <Button
              variant={hasActiveFilters ? 'default' : 'outline'}
              size="sm"
              onClick={() => setIsFiltersOpen(true)}
              className={`h-9 px-3 rounded-full text-xs font-semibold flex items-center gap-1.5 border-outline-variant/50 transition-colors ${
                hasActiveFilters
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface hover:bg-surface-container text-on-surface'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Filter & Sort</span>
              <span className="sm:hidden">Filters</span>
              {activeFilterCount > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-secondary text-on-secondary">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            {/* View Mode Toggle: Grid vs Table */}
            <div className="flex bg-surface-container-low rounded-full p-0.5 border border-outline-variant/40 flex-shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('standard')}
                className={`h-7 px-2 sm:px-2.5 rounded-full text-xs font-medium ${
                  viewMode === 'standard'
                    ? 'bg-surface shadow-xs text-primary'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
                title="Grid View"
                aria-label="Grid View"
              >
                <LayoutGrid className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Grid</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setViewMode('table')}
                className={`h-7 px-2 sm:px-2.5 rounded-full text-xs font-medium ${
                  viewMode === 'table'
                    ? 'bg-surface shadow-xs text-primary'
                    : 'text-on-surface-variant hover:text-primary'
                }`}
                title="Table View"
                aria-label="Table View"
              >
                <TableIcon className="w-3.5 h-3.5 sm:mr-1" />
                <span className="hidden sm:inline">Table</span>
              </Button>
            </div>
          </div>
        </div>

        {/* Quick Genre Chips Row (Horizontal Scrollable, 1-tap filtering) */}
        {quickGenres.length > 0 && (
          <div className="px-3 sm:px-6 pb-2 pt-0.5 flex items-center gap-1.5 overflow-x-auto hide-scrollbar scroll-smooth">
            <button
              type="button"
              onClick={() => setFilterGenre('')}
              className={`text-xs px-3 py-1 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
                !filterGenre
                  ? 'bg-primary text-on-primary font-semibold shadow-xs'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
              }`}
            >
              All Genres
            </button>
            {quickGenres.map(genre => {
              const isSelected =
                filterGenre.toLowerCase() === genre.toLowerCase();
              return (
                <button
                  key={genre}
                  type="button"
                  onClick={() => setFilterGenre(isSelected ? '' : genre)}
                  className={`text-xs px-3 py-1 rounded-full whitespace-nowrap font-medium transition-colors flex-shrink-0 ${
                    isSelected
                      ? 'bg-primary text-on-primary font-semibold shadow-xs'
                      : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                  }`}
                >
                  {genre}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Filter & Sort Dialog / Mobile Bottom Sheet */}
      <Dialog open={isFiltersOpen} onOpenChange={setIsFiltersOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl font-bold text-primary">
              Filter & Sort Collection
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Sort Options */}
            <div className="space-y-1.5">
              <label className="text-xs font-sans font-semibold uppercase tracking-wider text-secondary/90">
                Sort Order
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  {id: 'added', label: 'Recently Added'},
                  {id: 'title', label: 'Title (A-Z)'},
                  {id: 'author', label: 'Author (A-Z)'},
                ].map(opt => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleSort(opt.id as SortOption)}
                    className={`px-2.5 py-2 text-xs font-medium rounded-xl border text-center transition-all ${
                      sortBy === opt.id
                        ? 'border-primary bg-primary/10 text-primary font-semibold'
                        : 'border-outline-variant/40 bg-surface-container-low text-on-surface hover:bg-surface-container'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {sortBy !== 'added' && (
                <div className="flex items-center justify-between pt-1 text-xs text-on-surface-variant">
                  <span>Direction:</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                    }
                    className="h-8 px-3 rounded-lg text-xs gap-1.5"
                  >
                    {sortOrder === 'asc' ? (
                      <>
                        <ArrowUp className="w-3.5 h-3.5" /> Ascending
                      </>
                    ) : (
                      <>
                        <ArrowDown className="w-3.5 h-3.5" /> Descending
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Genre Select */}
            <div className="space-y-1.5">
              <label className="text-xs font-sans font-semibold uppercase tracking-wider text-secondary/90">
                Genre
              </label>
              <Select
                value={filterGenre || 'all'}
                onValueChange={val => setFilterGenre(val === 'all' ? '' : val)}
              >
                <SelectTrigger className="w-full bg-surface">
                  <SelectValue placeholder="All Genres" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Genres</SelectItem>
                  {availableGenres.map(genre => (
                    <SelectItem key={genre} value={genre}>
                      {genre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Author Select */}
            <div className="space-y-1.5">
              <label className="text-xs font-sans font-semibold uppercase tracking-wider text-secondary/90">
                Author
              </label>
              <Select
                value={filterAuthor || 'all'}
                onValueChange={val => setFilterAuthor(val === 'all' ? '' : val)}
              >
                <SelectTrigger className="w-full bg-surface">
                  <SelectValue placeholder="All Authors" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Authors</SelectItem>
                  {availableAuthors.map(author => (
                    <SelectItem key={author} value={author}>
                      {author}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Publication Year Range */}
            <div className="space-y-1.5">
              <label className="text-xs font-sans font-semibold uppercase tracking-wider text-secondary/90">
                Publication Year Range
              </label>
              <div className="grid grid-cols-2 gap-3 items-center">
                <Input
                  type="number"
                  placeholder="Min Year (e.g. 1920)"
                  value={filterYearMin}
                  onChange={e => setFilterYearMin(e.target.value)}
                  className="bg-surface text-sm"
                />
                <Input
                  type="number"
                  placeholder="Max Year (e.g. 2024)"
                  value={filterYearMax}
                  onChange={e => setFilterYearMax(e.target.value)}
                  className="bg-surface text-sm"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between pt-3 border-t border-outline-variant/30 gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                clearFilters();
              }}
              disabled={!hasActiveFilters}
              className="text-xs text-on-surface-variant hover:text-primary min-h-[36px]"
            >
              Reset All
            </Button>
            <Button
              size="sm"
              onClick={() => setIsFiltersOpen(false)}
              className="px-5 text-xs font-semibold min-h-[40px] rounded-xl"
            >
              Done ({sortedBooks.length}{' '}
              {sortedBooks.length === 1 ? 'book' : 'books'})
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <main className="layout-page-content flex flex-col lg:flex-row gap-6 sm:gap-8 pt-6 sm:pt-8">
        <div className="flex-1 min-w-0">
          {sortedBooks.length === 0 ? (
            <div className="text-center py-24 px-6 bg-surface-container-low rounded-lg border border-outline-variant/30 architectural-shadow">
              <div className="w-20 h-20 bg-surface rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm border border-outline-variant/30 relative z-10">
                <BookIcon
                  size={36}
                  className="text-on-surface-variant"
                  strokeWidth={1.5}
                />
              </div>
              <h3 className="text-2xl font-serif font-bold mb-3 text-primary relative z-10 tracking-tight">
                No books found
              </h3>
              <p className="text-on-surface-variant text-lg max-w-md mx-auto relative z-10">
                {books.length === 0
                  ? "This library is empty. Let's add some great reads to your collection."
                  : 'No books match your current filters.'}
              </p>
              {books.length === 0 && canEdit && (
                <Button
                  onClick={() => navigate(`/library/${libraryId}/add`)}
                  className="mt-8 flex items-center gap-2 mx-auto"
                >
                  <Plus size={18} strokeWidth={2.5} />
                  Add Your First Book
                </Button>
              )}
            </div>
          ) : (
            <div className="mb-10 sm:mb-12 last:mb-0">
              <LibraryShelf
                books={sortedBooks}
                viewMode={viewMode}
                canEdit={canEdit}
                libraryId={libraryId}
                sortBy={sortBy}
                sortOrder={sortOrder as 'asc' | 'desc'}
                handleSort={handleSort}
                selectedBooks={selectedBooks}
                toggleBookSelection={toggleBookSelection}
                toggleAllBooks={toggleAllBooks}
                user={user}
                emptyMessage={
                  books.length === 0
                    ? 'Empty Collection'
                    : 'No results for these filters'
                }
              />
            </div>
          )}
        </div>
      </main>
    </>
  );
};
