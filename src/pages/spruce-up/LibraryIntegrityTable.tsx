import React, {useMemo, useState, useEffect} from 'react';
import {
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  User,
  Book as BookIcon,
} from 'lucide-react';
import {Book} from '../../types';
import {cn} from '@/lib/utils';
import {Checkbox} from '@/components/ui/checkbox';

interface LibraryIntegrityTableProps {
  books: Book[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  filter:
    | 'all'
    | 'missing_metadata'
    | 'missing_genre'
    | 'low_res_cover'
    | 'missing_cover';
  emptyCoverUrls?: Set<string>;
}

export function LibraryIntegrityTable({
  books,
  selectedIds,
  onToggleSelect,
  filter,
  emptyCoverUrls = new Set(),
}: LibraryIntegrityTableProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const PAGE_SIZE = 50;

  useEffect(() => {
    setCurrentPage(1);
  }, [filter]);

  const sortedBooks = useMemo(() => {
    return [...books].sort((a, b) => a.title.localeCompare(b.title));
  }, [books]);

  const filteredBooks = useMemo(() => {
    if (filter === 'all') return sortedBooks;
    return sortedBooks.filter(b => {
      const isMissingGenre = !b.genres || b.genres.length === 0;
      const isMissingMetadata =
        !b.synopsis ||
        !b.publishedDate ||
        !b.coverUrl ||
        emptyCoverUrls.has(b.coverUrl);
      const isLowResCover = b.coverUrl && b.coverUrl.includes('zoom=1'); // Heuristic
      const isMissingCover = !b.coverUrl || emptyCoverUrls.has(b.coverUrl);

      if (filter === 'missing_metadata')
        return isMissingMetadata || isMissingGenre;
      if (filter === 'missing_genre') return isMissingGenre;
      if (filter === 'low_res_cover') return isLowResCover;
      if (filter === 'missing_cover') return isMissingCover;
      return true;
    });
  }, [sortedBooks, filter]);

  const paginatedBooks = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredBooks.slice(start, start + PAGE_SIZE);
  }, [filteredBooks, currentPage]);

  const allPageSelected =
    paginatedBooks.length > 0 &&
    paginatedBooks.every(b => selectedIds.has(b.id));
  const somePageSelected =
    paginatedBooks.some(b => selectedIds.has(b.id)) && !allPageSelected;

  const handleToggleSelectPage = () => {
    paginatedBooks.forEach(b => {
      const isSel = selectedIds.has(b.id);
      if (allPageSelected) {
        if (isSel) onToggleSelect(b.id);
      } else {
        if (!isSel) onToggleSelect(b.id);
      }
    });
  };

  return (
    <div className="bg-surface-container border border-outline-variant rounded-2xl overflow-hidden shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-surface-variant/50 border-b border-outline-variant">
              <th className="py-4 px-6 w-12">
                <Checkbox
                  checked={
                    allPageSelected ||
                    (somePageSelected ? 'indeterminate' : false)
                  }
                  onCheckedChange={handleToggleSelectPage}
                  aria-label="Select all on this page"
                />
              </th>
              <th className="py-4 px-6 text-sm font-bold text-on-surface uppercase tracking-wider uppercase">
                Book Info
              </th>
              <th className="py-4 px-6 text-sm font-bold text-on-surface uppercase tracking-wider uppercase">
                Current Genre
              </th>
              <th className="py-4 px-6 text-sm font-bold text-on-surface uppercase tracking-wider uppercase">
                Integrity Status
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30">
            {paginatedBooks.length === 0 ? (
              <tr>
                <td
                  colSpan={4}
                  className="py-20 text-center text-on-surface-variant font-medium"
                >
                  <div className="flex flex-col items-center gap-3">
                    <CheckCircle2 className="w-12 h-12 text-success/50" />
                    <p>No books matching the current filter.</p>
                  </div>
                </td>
              </tr>
            ) : (
              paginatedBooks.map(book => {
                const isSelected = selectedIds.has(book.id);
                const missingFields = [];
                if (!book.coverUrl || emptyCoverUrls.has(book.coverUrl))
                  missingFields.push('Cover');
                if (!book.synopsis) missingFields.push('Synopsis');
                if (!book.genres || book.genres.length === 0)
                  missingFields.push('Genre');
                if (!book.publishedDate) missingFields.push('Date');

                return (
                  <tr
                    key={book.id}
                    className={cn(
                      'group hover:bg-primary/5 transition-colors cursor-pointer',
                      isSelected && 'bg-primary/10',
                    )}
                    onClick={() => onToggleSelect(book.id)}
                  >
                    <td
                      className="py-4 px-6"
                      onClick={e => e.stopPropagation()}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => onToggleSelect(book.id)}
                        aria-label={`Select ${book.title}`}
                      />
                    </td>
                    <td className="py-4 px-6 max-w-md">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center text-primary flex-shrink-0">
                          <BookIcon className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-on-surface truncate leading-tight">
                            {book.title}
                          </p>
                          <div className="flex items-center gap-1.5 text-on-surface-variant mt-1">
                            <User size={14} className="flex-shrink-0" />
                            <p className="text-xs font-medium truncate">
                              {book.author}
                            </p>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      {book.genres && book.genres.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {book.genres.slice(0, 2).map((g, i) => (
                            <span
                              key={i}
                              className="text-[10px] px-2 py-0.5 bg-surface-variant text-on-surface-variant rounded-full font-medium border border-outline-variant/30"
                            >
                              {g}
                            </span>
                          ))}
                          {book.genres.length > 2 && (
                            <span className="text-[10px] px-2 py-0.5 bg-surface-variant text-on-surface-variant rounded-full font-medium">
                              +{book.genres.length - 2}
                            </span>
                          )}
                        </div>
                      ) : (
                        <p className="text-xs text-on-surface-variant/50 italic">
                          None
                        </p>
                      )}
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex flex-wrap gap-2">
                        {missingFields.length === 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-bold text-success">
                            <CheckCircle2 size={14} />
                            Complete
                          </span>
                        ) : (
                          missingFields.map(field => (
                            <span
                              key={field}
                              className="inline-flex items-center gap-1 px-2 py-1 bg-error/10 text-error rounded-md text-[10px] font-bold border border-error/20"
                            >
                              <AlertCircle size={10} />
                              Missing {field}
                            </span>
                          ))
                        )}
                        {book.coverUrl && book.coverUrl.includes('zoom=1') && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 bg-secondary/10 text-secondary rounded-md text-[10px] font-bold border border-secondary/20">
                            <HelpCircle size={10} />
                            Low Res Cover
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {filteredBooks.length > PAGE_SIZE && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 border-t border-outline-variant bg-surface-variant/20">
          <p className="text-xs font-medium text-on-surface-variant">
            Showing{' '}
            <span className="font-bold">
              {(currentPage - 1) * PAGE_SIZE + 1}
            </span>{' '}
            to{' '}
            <span className="font-bold">
              {Math.min(currentPage * PAGE_SIZE, filteredBooks.length)}
            </span>{' '}
            of <span className="font-bold">{filteredBooks.length}</span> books
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className={cn(
                'px-4 py-2 text-xs font-bold rounded-lg border transition-all select-none',
                currentPage === 1
                  ? 'bg-transparent text-on-surface-variant/30 border-outline-variant/30 cursor-not-allowed'
                  : 'bg-surface border-outline-variant text-on-surface hover:bg-surface-variant/50 cursor-pointer',
              )}
            >
              Previous
            </button>
            <button
              onClick={() =>
                setCurrentPage(prev =>
                  Math.min(
                    Math.ceil(filteredBooks.length / PAGE_SIZE),
                    prev + 1,
                  ),
                )
              }
              disabled={
                currentPage === Math.ceil(filteredBooks.length / PAGE_SIZE)
              }
              className={cn(
                'px-4 py-2 text-xs font-bold rounded-lg border transition-all select-none',
                currentPage === Math.ceil(filteredBooks.length / PAGE_SIZE)
                  ? 'bg-transparent text-on-surface-variant/30 border-outline-variant/30 cursor-not-allowed'
                  : 'bg-surface border-outline-variant text-on-surface hover:bg-surface-variant/50 cursor-pointer',
              )}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
