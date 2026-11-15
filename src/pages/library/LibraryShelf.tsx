import React, {useMemo, useCallback} from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
import {Book} from '../../types';
import {VirtuosoGrid} from 'react-virtuoso';
import {Book as BookIcon} from 'lucide-react';
import {BookCard} from '../../components/book/BookCard';
import {SortOption} from '../../hooks/useBookFilters';
import {User} from 'firebase/auth';
import {Checkbox} from '@/components/ui/checkbox';
import {navigateWithCoverTransition} from '../../lib/bookCoverTransition';
import {useCoverTransitionStore} from '../../stores/coverTransitionStore';
import {
  DataTable,
  DataTableColumn,
  BookTitleCell,
  BookAuthorCell,
  BookDateCell,
} from '@/components/ui/data-table';

interface LibraryShelfProps {
  books: Book[];
  viewMode: 'standard' | 'table';
  canEdit: boolean;
  libraryId: string;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  handleSort: (option: SortOption) => void;
  selectedBooks: Set<string>;
  toggleBookSelection: (e: React.MouseEvent, bookId: string) => void;
  toggleAllBooks: (books: Book[]) => void;
  user: User | null;
  emptyMessage?: string;
}

export function LibraryShelf({
  books,
  viewMode,
  canEdit,
  libraryId,
  sortBy,
  sortOrder,
  handleSort,
  selectedBooks,
  toggleBookSelection,
  toggleAllBooks,
  user,
  emptyMessage = 'Empty Shelf',
}: LibraryShelfProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Precompute ordered bookIds array and book lookup map once per books change
  const bookIds = useMemo(() => books.map(b => b.id), [books]);
  const booksById = useMemo(() => new Map(books.map(b => [b.id, b])), [books]);
  const isSelectMode = selectedBooks.size > 0;

  // When returning from BookDetailsView after swiping far away in the deck,
  // align virtualized lists so the active book's shelf slot is mounted in view.
  const returnTargetIndex = useCoverTransitionStore(state => {
    const active = state.activeTransition;
    if (
      !active ||
      active.phase !== 'to-shelf' ||
      active.libraryId !== libraryId ||
      (active.originSurface !== 'library-grid' &&
        active.originSurface !== 'library-table') ||
      active.bookId === active.initialBookId
    ) {
      return undefined;
    }
    const targetIdx = bookIds.indexOf(active.bookId);
    if (targetIdx < 0) {
      return undefined;
    }
    const initialIdx = bookIds.indexOf(active.initialBookId);
    if (initialIdx >= 0 && Math.abs(targetIdx - initialIdx) <= 4) {
      return undefined;
    }
    return targetIdx;
  });

  const handleNavigateBook = useCallback(
    (bookId: string) => {
      const targetBook = booksById.get(bookId);
      const targetLibraryId = targetBook?.libraryId || libraryId;
      navigateWithCoverTransition({
        navigate,
        libraryId: targetLibraryId,
        bookId,
        originSurface: viewMode === 'table' ? 'library-table' : 'library-grid',
        fromRouteKey: location.pathname + location.search,
        bookList: bookIds,
        coverPreview: {
          title: targetBook?.title || 'Untitled',
          author: targetBook?.author || 'Unknown Author',
          coverUrl: targetBook?.coverUrl,
          publishedDate: targetBook?.publishedDate,
          primaryGenre: targetBook?.primaryGenre,
          subgenres: targetBook?.subgenres,
          series: targetBook?.series,
          synopsis: targetBook?.synopsis,
          readingStatus: targetBook?.readingStatus,
          ownershipStatus: targetBook?.ownershipStatus,
          format: targetBook?.format,
          isbn: targetBook?.isbn,
        },
      });
    },
    [
      navigate,
      booksById,
      libraryId,
      viewMode,
      location.pathname,
      location.search,
      bookIds,
    ],
  );

  const allBooksSelected =
    books.length > 0 && books.every(b => selectedBooks.has(b.id));
  const someBooksSelected =
    books.length > 0 &&
    books.some(b => selectedBooks.has(b.id)) &&
    !allBooksSelected;
  const shelfSelectAllState = allBooksSelected
    ? true
    : someBooksSelected
      ? 'indeterminate'
      : false;

  const tableColumns: Array<DataTableColumn<Book>> = useMemo(
    () => [
      {
        id: 'title',
        header: () => (
          <div className="flex items-center gap-2.5 sm:gap-4 min-w-0">
            {canEdit && user && isSelectMode && (
              <div
                className="w-7 sm:w-8 flex items-center justify-center flex-shrink-0"
                onClick={e => {
                  e.stopPropagation();
                  toggleAllBooks(books);
                }}
              >
                <Checkbox
                  checked={shelfSelectAllState}
                  onCheckedChange={() => toggleAllBooks(books)}
                  className="pointer-events-none w-4 h-4"
                />
              </div>
            )}
            <div className="flex items-center gap-2 truncate">Title</div>
          </div>
        ),
        sortable: true,
        wrap: true,
        colClassName: 'w-[64%] sm:w-[52%] md:w-[54%]',
        headerClassName:
          'w-[64%] sm:w-[52%] md:w-[54%] py-3 px-3.5 sm:py-4 sm:px-6 font-label-caps text-label-caps text-on-surface-variant uppercase',
        cellClassName:
          'w-[64%] sm:w-[52%] md:w-[54%] py-3 px-3.5 sm:py-4 sm:px-6 whitespace-normal overflow-hidden',
        cell: book => (
          <BookTitleCell
            title={book.title}
            coverUrl={book.coverUrl}
            userStatus={book.readingStatus}
            isSelected={selectedBooks.has(book.id)}
            showCheckbox={Boolean(canEdit && user)}
            onToggleSelect={e => toggleBookSelection(e, book.id)}
            coverTransition={{
              surface: 'library-table',
              libraryId: book.libraryId || libraryId,
              bookId: book.id,
            }}
          />
        ),
      },
      {
        id: 'author',
        header: 'Author',
        sortable: true,
        wrap: true,
        colClassName: 'w-[36%] sm:w-[28%] md:w-[28%]',
        headerClassName:
          'w-[36%] sm:w-[28%] md:w-[28%] py-3 px-3.5 sm:py-4 sm:px-6 font-label-caps text-label-caps text-on-surface-variant uppercase',
        cellClassName:
          'w-[36%] sm:w-[28%] md:w-[28%] py-3 px-3.5 sm:py-4 sm:px-6 whitespace-normal overflow-hidden',
        cell: book => <BookAuthorCell author={book.author} />,
      },
      {
        id: 'added',
        header: 'Added',
        sortable: true,
        align: 'right',
        colClassName: 'hidden sm:table-column sm:w-[20%] md:w-[18%]',
        headerClassName:
          'hidden sm:table-cell sm:w-[20%] md:w-[18%] py-3 px-3.5 sm:py-4 sm:px-6 font-label-caps text-label-caps text-on-surface-variant uppercase text-right',
        cellClassName:
          'hidden sm:table-cell sm:w-[20%] md:w-[18%] py-3 px-3.5 sm:py-4 sm:px-6 text-right whitespace-nowrap overflow-hidden',
        cell: book => <BookDateCell date={book.addedAt} />,
      },
    ],
    [
      books,
      canEdit,
      user,
      selectedBooks,
      isSelectMode,
      shelfSelectAllState,
      libraryId,
      toggleAllBooks,
      toggleBookSelection,
    ],
  );

  if (viewMode === 'table') {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-surface-variant overflow-hidden shadow-elevation-1">
        <div className="w-full min-h-[500px]">
          <DataTable<Book>
            data={books}
            columns={tableColumns}
            keyExtractor={b => b.id}
            sortColumn={sortBy}
            sortDirection={sortOrder}
            onSort={colId => handleSort(colId as SortOption)}
            onRowClick={book => handleNavigateBook(book.id)}
            initialTopMostItemIndex={returnTargetIndex}
            tableClassName="table-fixed w-full"
            rowClassName={() =>
              'group hover:bg-surface-container-low/50 transition-colors cursor-pointer border-b border-surface-variant/60'
            }
            headerRowClassName="bg-surface-container-low border-b border-surface-variant shadow-sm h-12 sm:h-14"
            emptyPlaceholder={
              <div className="px-6 py-8 text-center text-on-surface-variant italic font-body-md text-sm">
                {emptyMessage}
              </div>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full min-h-[500px]">
      {books.length === 0 ? (
        <div className="w-full py-12 flex flex-col items-center justify-center opacity-80 font-body-md text-sm pb-8 text-on-surface-variant">
          <div className="w-12 h-12 mb-3 border-2 border-dashed border-outline-variant/60 rounded-full flex items-center justify-center">
            <BookIcon size={20} className="text-on-surface-variant" />
          </div>
          {emptyMessage}
        </div>
      ) : (
        <VirtuosoGrid
          useWindowScroll
          data={books}
          {...(typeof returnTargetIndex === 'number'
            ? {initialTopMostItemIndex: returnTargetIndex}
            : {})}
          listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 pb-24"
          itemContent={(_index, book) => (
            <BookCard
              canEdit={!!canEdit}
              book={book}
              fallbackLibraryId={libraryId}
              isSelected={selectedBooks.has(book.id)}
              isSelectMode={isSelectMode}
              onSelectBook={canEdit ? toggleBookSelection : undefined}
              onNavigateBook={handleNavigateBook}
            />
          )}
        />
      )}
    </div>
  );
}
