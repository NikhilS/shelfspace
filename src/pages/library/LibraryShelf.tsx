import React from 'react';
import {useNavigate, useLocation} from 'react-router-dom';
import {Book} from '../../types';
import {TableVirtuoso, VirtuosoGrid} from 'react-virtuoso';
import {ArrowUpDown, ArrowUp, ArrowDown, Book as BookIcon} from 'lucide-react';
import BookCard from '../../components/BookCard';
import {toTitleCase, getFirestoreTime} from '../../lib/utils';
import {SortOption} from '../../hooks/useBookFilters';
import {User} from 'firebase/auth';
import {format} from 'date-fns';

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

  if (viewMode === 'table') {
    const SortIcon = ({column}: {column: string}) => {
      if (sortBy !== column)
        return <ArrowUpDown size={14} className="opacity-30" />;
      return sortOrder === 'asc' ? (
        <ArrowUp size={14} className="text-accent" />
      ) : (
        <ArrowDown size={14} className="text-accent" />
      );
    };

    return (
      <div className="bg-surface-container-lowest rounded-xl border border-surface-variant overflow-hidden shadow-[0_2px_12px_rgba(2,26,53,0.03)]">
        <div className="overflow-x-auto min-h-[500px]">
          {books.length === 0 ? (
            <table className="w-full table-fixed text-left border-collapse">
              <thead>
                <tr className="bg-surface-container-low border-b border-surface-variant shadow-sm h-14">
                  <th
                    className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-2/3 sm:w-1/2 cursor-pointer hover:bg-surface-variant/30 transition-colors"
                    onClick={() => handleSort('title' as SortOption)}
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        Title <SortIcon column="title" />
                      </div>
                    </div>
                  </th>
                  <th
                    className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-1/3 sm:w-1/4 cursor-pointer hover:bg-surface-variant/30 transition-colors"
                    onClick={() => handleSort('author' as SortOption)}
                  >
                    <div className="flex items-center gap-2">
                      Author <SortIcon column="author" />
                    </div>
                  </th>
                  <th
                    className="hidden sm:table-cell sm:w-1/4 py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase text-right cursor-pointer hover:bg-surface-variant/30 transition-colors"
                    onClick={() => handleSort('added' as SortOption)}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Added <SortIcon column="added" />
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td
                    colSpan={3}
                    className="px-6 py-8 text-center text-on-surface-variant italic font-body-md text-sm"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <TableVirtuoso
              data={books}
              useWindowScroll
              className="w-full text-left border-collapse"
              components={{
                Table: ({...props}) => (
                  <table
                    {...props}
                    className="w-full table-fixed text-left border-collapse"
                  />
                ),
                TableHead: React.forwardRef<
                  HTMLTableSectionElement,
                  React.HTMLAttributes<HTMLTableSectionElement>
                >((props, ref) => <thead {...props} ref={ref} />),
                TableRow: ({item, ...props}) => {
                  void item;
                  return (
                    <tr
                      {...props}
                      className="group hover:bg-surface-container-low/50 transition-colors cursor-pointer border-b border-surface-variant/60"
                    />
                  );
                },
                TableBody: React.forwardRef<
                  HTMLTableSectionElement,
                  React.HTMLAttributes<HTMLTableSectionElement>
                >((props, ref) => <tbody {...props} ref={ref} />),
              }}
              fixedHeaderContent={() => (
                <tr className="bg-surface-container-low border-b border-surface-variant shadow-sm h-14">
                  <th
                    className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-2/3 sm:w-1/2 cursor-pointer hover:bg-surface-variant/30 transition-colors bg-surface-container-low"
                    onClick={() => handleSort('title' as SortOption)}
                  >
                    <div className="flex items-center gap-4">
                      {user && (
                        <div
                          className={`w-8 flex items-center justify-center flex-shrink-0 transition-opacity ${selectedBooks.size > 0 ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
                          onClick={e => {
                            e.stopPropagation();
                            toggleAllBooks(books);
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={
                              selectedBooks.size > 0 &&
                              books.length > 0 &&
                              books.every(b => selectedBooks.has(b.id))
                            }
                            ref={el => {
                              if (el)
                                el.indeterminate =
                                  selectedBooks.size > 0 &&
                                  !books.every(b => selectedBooks.has(b.id));
                            }}
                            onChange={() => {}}
                            className="pointer-events-none w-4 h-4 accent-primary"
                          />
                        </div>
                      )}
                      <div className="flex items-center gap-2">
                        Title <SortIcon column="title" />
                      </div>
                    </div>
                  </th>
                  <th
                    className="py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase w-1/3 sm:w-1/4 cursor-pointer hover:bg-surface-variant/30 transition-colors bg-surface-container-low"
                    onClick={() => handleSort('author' as SortOption)}
                  >
                    <div className="flex items-center gap-2">
                      Author <SortIcon column="author" />
                    </div>
                  </th>
                  <th
                    className="hidden sm:table-cell sm:w-1/4 py-4 px-6 font-label-caps text-label-caps text-on-surface-variant uppercase text-right cursor-pointer hover:bg-surface-variant/30 transition-colors bg-surface-container-low"
                    onClick={() => handleSort('added' as SortOption)}
                  >
                    <div className="flex items-center gap-2 justify-end">
                      Added <SortIcon column="added" />
                    </div>
                  </th>
                </tr>
              )}
              itemContent={(_index, book) => {
                const hash = (book.title || '')
                  .split('')
                  .reduce((acc, char) => acc + char.charCodeAt(0), 0);
                const gradients = [
                  'from-[#2f4d40] to-[#163428]',
                  'from-[#7d5633] to-[#2e1500]',
                  'from-[#021a35] to-[#041c37]',
                  'from-[#8397b8] to-[#4b5f7e]',
                  'from-[#e5e2dc] to-[#dcdad4]',
                ];
                const gradientClass = gradients[hash % gradients.length];

                return (
                  <>
                    <td
                      className="py-4 px-6"
                      onClick={() =>
                        navigate(`/library/${libraryId}/book/${book.id}`, {
                          state: {
                            from: location.pathname + location.search,
                            bookList: books.map(b => b.id),
                          },
                        })
                      }
                    >
                      <div className="flex items-center gap-4 group/cover">
                        <div
                          className="h-12 w-8 flex-shrink-0 relative overflow-hidden rounded-sm cursor-pointer"
                          onClick={e => {
                            e.stopPropagation();
                            toggleBookSelection(e, book.id);
                          }}
                        >
                          {user && (
                            <div
                              className={`absolute inset-0 z-20 flex items-center justify-center transition-all ${selectedBooks.size > 0 || selectedBooks.has(book.id) ? 'opacity-100 bg-transparent' : 'opacity-0 group-hover/cover:opacity-100 hover:bg-surface-variant/30'}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedBooks.has(book.id)}
                                onChange={() => {}}
                                className="pointer-events-none w-4 h-4 accent-primary"
                              />
                            </div>
                          )}
                          <div
                            className={`absolute inset-0 bg-surface-variant shadow-sm border border-outline-variant/30 transition-opacity ${user && (selectedBooks.size > 0 || selectedBooks.has(book.id)) ? 'opacity-0' : 'opacity-100 group-hover/cover:opacity-0'}`}
                          >
                            {book.coverUrl ? (
                              <img
                                src={book.coverUrl}
                                alt={book.title}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                              />
                            ) : (
                              <div
                                className={`absolute inset-0 bg-gradient-to-br ${gradientClass} opacity-80`}
                              />
                            )}
                          </div>
                        </div>
                        <span className="font-serif text-lg sm:text-xl font-medium text-on-surface line-clamp-2 max-w-lg leading-snug">
                          {toTitleCase(book.title)}
                        </span>
                      </div>
                    </td>
                    <td
                      className="py-4 px-6 font-body-md text-body-md text-on-surface-variant"
                      onClick={() =>
                        navigate(`/library/${libraryId}/book/${book.id}`, {
                          state: {
                            from: location.pathname + location.search,
                            bookList: books.map(b => b.id),
                          },
                        })
                      }
                    >
                      {toTitleCase(book.author)}
                    </td>
                    <td
                      className="hidden sm:table-cell py-4 px-6 text-right font-body-md text-outline whitespace-nowrap"
                      onClick={() =>
                        navigate(`/library/${libraryId}/book/${book.id}`, {
                          state: {
                            from: location.pathname + location.search,
                            bookList: books.map(b => b.id),
                          },
                        })
                      }
                    >
                      {book.addedAt && getFirestoreTime(book.addedAt) > 0
                        ? format(
                            new Date(getFirestoreTime(book.addedAt)),
                            'MMM d, yyyy',
                          )
                        : 'Unknown'}
                    </td>
                  </>
                );
              }}
            />
          )}
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
