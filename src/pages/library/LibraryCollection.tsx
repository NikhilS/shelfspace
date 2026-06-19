import React from 'react';
import {
  Search,
  Filter,
  LayoutGrid,
  Table as TableIcon,
  ArrowUp,
  ArrowDown,
  Book as BookIcon,
  Plus,
} from 'lucide-react';
import {LibraryShelf} from './LibraryShelf';
import {Book} from '../../types';
import {SortOption} from '../../hooks/useBookFilters';
import {User} from 'firebase/auth';
import {NavigateFunction} from 'react-router-dom';
import {Input} from '../../components/ui/input';
import {Button} from '../../components/ui/button';

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
  return (
    <>
      <div className="sticky top-16 z-40 flex flex-col shadow-elevation-2 border-b border-outline-variant/30 bg-surface/80 backdrop-blur-md">
        <div className="px-4 sm:px-8 min-h-16 py-2.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 transition-all">
          <div className="relative w-full lg:w-[320px] lg:flex-shrink-0">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant z-10" />
            <Input
              className="pl-9"
              placeholder="Search collection..."
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between w-full lg:w-auto gap-3">
            <div className="flex items-center gap-2 flex-grow overflow-x-auto pb-1 -mb-1 hide-scrollbar">
              <div className="flex items-center gap-2 bg-surface px-3 py-1.5 rounded-md border border-outline-variant/40 flex-shrink-0">
                <label className="text-xs font-label-caps text-on-surface-variant uppercase tracking-wider hidden sm:block">
                  Sort by:
                </label>
                <select
                  value={sortBy}
                  onChange={e => handleSort(e.target.value as SortOption)}
                  className="bg-transparent border-none text-on-surface font-body-md text-sm focus:outline-none cursor-pointer min-w-[125px] appearance-none hover:text-primary transition-colors pr-6"
                  style={{
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")",
                    backgroundPosition: 'right 0 center',
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: '1em',
                  }}
                >
                  <option value="added">Recently Added</option>
                  <option value="title">Title (A-Z)</option>
                  <option value="author">Author (A-Z)</option>
                </select>
                {sortBy !== 'added' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
                    }
                    className="h-6 w-6 ml-1 p-0"
                  >
                    {sortOrder === 'asc' ? (
                      <ArrowUp className="w-4 h-4" />
                    ) : (
                      <ArrowDown className="w-4 h-4" />
                    )}
                  </Button>
                )}
              </div>
              <Button
                variant={
                  isFiltersOpen ||
                  searchQuery ||
                  filterGenre ||
                  filterAuthor ||
                  filterYearMin ||
                  filterYearMax
                    ? 'default'
                    : 'outline'
                }
                onClick={() => setIsFiltersOpen(!isFiltersOpen)}
                className="flex flex-shrink-0 items-center gap-2"
              >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">Filters</span>
                {(searchQuery ||
                  filterGenre ||
                  filterAuthor ||
                  filterYearMin ||
                  filterYearMax) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-surface"></span>
                )}
              </Button>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 sm:ml-auto">
              <div className="flex bg-surface-container-lowest rounded-md p-0.5 border border-outline-variant/40 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewMode('standard')}
                  className={`h-8 sm:h-9 px-2 sm:px-3 text-sm font-body-md ${viewMode === 'standard' ? 'bg-surface shadow-sm text-primary hover:bg-surface hover:text-primary' : 'text-on-surface hover:text-primary'}`}
                  title="Grid View"
                >
                  <LayoutGrid className="w-4 h-4 mr-0 sm:mr-2" />
                  <span className="hidden sm:inline">Grid</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setViewMode('table')}
                  className={`h-8 sm:h-9 px-2 sm:px-3 text-sm font-body-md ${viewMode === 'table' ? 'bg-surface shadow-sm text-primary hover:bg-surface hover:text-primary' : 'text-on-surface hover:text-primary'}`}
                  title="Table View"
                >
                  <TableIcon className="w-4 h-4 mr-0 sm:mr-2" />
                  <span className="hidden sm:inline">Table</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {isFiltersOpen && (
          <div className="px-4 sm:px-8 py-4 bg-surface border-t border-outline-variant/40 flex flex-wrap gap-4 items-center animate-in slide-in-from-top-2 fade-in duration-200">
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={filterGenre}
                onChange={e => setFilterGenre(e.target.value)}
                className="px-4 py-2 bg-surface border border-outline-variant/60 rounded-md text-sm focus:outline-none focus:border-primary font-body-md text-on-surface appearance-none min-w-[120px]"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")",
                  backgroundPosition: 'right 0.75rem center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '1em',
                }}
              >
                <option value="">All Genres</option>
                {availableGenres.map(genre => (
                  <option key={genre} value={genre}>
                    {genre}
                  </option>
                ))}
              </select>

              <select
                value={filterAuthor}
                onChange={e => setFilterAuthor(e.target.value)}
                className="px-4 py-2 bg-surface border border-outline-variant/60 rounded-md text-sm focus:outline-none focus:border-primary font-body-md text-on-surface appearance-none min-w-[120px] max-w-[200px] truncate"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")",
                  backgroundPosition: 'right 0.75rem center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '1em',
                }}
              >
                <option value="">All Authors</option>
                {availableAuthors.map(author => (
                  <option key={author} value={author}>
                    {author}
                  </option>
                ))}
              </select>

              <div className="flex items-center gap-1.5 text-sm bg-surface border border-outline-variant/60 rounded-md px-1 py-1">
                <Input
                  type="number"
                  placeholder="Min Yr"
                  value={filterYearMin}
                  onChange={e => setFilterYearMin(e.target.value)}
                  className="w-16 h-7 bg-transparent border-none text-center text-on-surface"
                />
                <span className="opacity-40">-</span>
                <Input
                  type="number"
                  placeholder="Max Yr"
                  value={filterYearMax}
                  onChange={e => setFilterYearMax(e.target.value)}
                  className="w-16 h-7 bg-transparent border-none text-center text-on-surface"
                />
              </div>
            </div>
            {clearFilters && (
              <Button variant="ghost" onClick={clearFilters}>
                Clear All
              </Button>
            )}
          </div>
        )}
      </div>

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
