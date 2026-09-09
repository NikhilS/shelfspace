import React, {useMemo} from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
import {Book} from '../../types';
import {VirtuosoGrid} from 'react-virtuoso';
import {Book as BookIcon} from 'lucide-react';
import BookCard from '../../components/BookCard';
import {SortOption} from '../../hooks/useBookFilters';
import {User} from 'firebase/auth';
import {Checkbox} from '@/components/ui/checkbox';
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

export const LibraryShelf: React.FC<LibraryShelfProps> = ({
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
}) => {
  const navigate = useNavigate();
  const location = useLocation();

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

  const tableColumns: DataTableColumn<Book>[] = useMemo(
    () => [
      {
        id: 'title',
        header: () => (
          <div className="flex items-center gap-4">
            {user && (
              <div
                className={`w-8 flex items-center justify-center flex-shrink-0 transition-opacity ${selectedBooks.size > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
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
            <div className="flex items-center gap-2">Title</div>
          </div>
        ),
        sortable: true,
        headerClassName:
          'py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-2/3 sm:w-1/2',
        cellClassName: 'py-4 px-6',
        cell: book => (
          <BookTitleCell
            title={book.title}
            coverUrl={book.coverUrl}
            userStatus={user ? book.userStatuses?.[user.uid] : undefined}
            isSelected={selectedBooks.has(book.id)}
            showCheckbox={Boolean(user)}
            onToggleSelect={e => toggleBookSelection(e, book.id)}
          />
        ),
      },
      {
        id: 'author',
        header: 'Author',
        sortable: true,
        headerClassName:
          'py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-1/3 sm:w-1/4',
        cellClassName: 'py-4 px-6',
        cell: book => <BookAuthorCell author={book.author} />,
      },
      {
        id: 'added',
        header: 'Added',
        sortable: true,
        align: 'right',
        headerClassName:
          'hidden sm:table-cell sm:w-1/4 py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase text-right',
        cellClassName: 'hidden sm:table-cell py-4 px-6 text-right',
        cell: book => <BookDateCell date={book.addedAt || book.dateAdded} />,
      },
    ],
    [
      books,
      user,
      selectedBooks,
      shelfSelectAllState,
      toggleAllBooks,
      toggleBookSelection,
    ],
  );

  if (viewMode === 'table') {
    return (
      <div className="bg-surface-container-lowest rounded-xl border border-surface-variant overflow-hidden shadow-elevation-1">
        <div className="overflow-x-auto min-h-[500px]">
          <DataTable<Book>
            data={books}
            columns={tableColumns}
            keyExtractor={b => b.id}
            sortColumn={sortBy}
            sortDirection={sortOrder}
            onSort={colId => handleSort(colId as SortOption)}
            onRowClick={book =>
              navigate(`/library/${libraryId}/book/${book.id}`, {
                state: {
                  from: location.pathname + location.search,
                  bookList: books.map(b => b.id),
                },
              })
            }
            rowClassName={() =>
              'group hover:bg-surface-container-low/50 transition-colors cursor-pointer border-b border-surface-variant/60'
            }
            headerRowClassName="bg-surface-container-low border-b border-surface-variant shadow-sm h-14"
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
          listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-6 pb-24"
          itemContent={(_index, book) => (
            <BookCard
              canEdit={!!canEdit}
              book={book}
              isSelected={selectedBooks.has(book.id)}
              isSelectMode={selectedBooks.size > 0}
              onSelect={
                canEdit ? e => toggleBookSelection(e, book.id) : undefined
              }
              onClick={() =>
                navigate(`/library/${libraryId}/book/${book.id}`, {
                  state: {
                    from: location.pathname + location.search,
                    bookList: books.map(b => b.id),
                  },
                })
              }
            />
          )}
        />
      )}
    </div>
  );
};
