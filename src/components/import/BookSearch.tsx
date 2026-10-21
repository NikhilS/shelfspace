import React, {useState, useRef, useEffect} from 'react';
import {
  Loader2,
  BookPlus,
  Library as LibraryIcon,
  Globe,
  Check,
  Book as BookIcon,
  Search,
} from 'lucide-react';
import {BookDetails} from '../../types';
import {trpcVanilla} from '../../lib/trpc';
import {toast} from 'sonner';
import {
  toTitleCase,
  isDuplicateBook,
  normalizeBookDetails,
} from '../../lib/utils';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Badge} from '@/components/ui/badge';
import type {
  TrackedShelfStatus,
  UnifiedLibrarySearchMatch,
  UnifiedExternalSearchMatch,
} from '../../server/services/readingTracker';

const STATUS_LABELS: Record<TrackedShelfStatus | 'unset', string> = {
  want_to_read: 'Want to Read',
  reading: 'Currently Reading',
  finished: 'Read',
  abandoned: 'Abandoned',
  unset: 'Library',
};

export interface BookSearchProps {
  existingBooks: BookDetails[];
  allowDuplicates: boolean;
  onAdd: (book: BookDetails) => Promise<void>;
  mode?: 'library' | 'reading';
  targetStatus?: TrackedShelfStatus | 'unset';
  onTrackExisting?: (match: {
    libraryId: string;
    bookId: string;
    title: string;
  }) => Promise<void>;
  autoFocus?: boolean;
}

export default function BookSearch({
  existingBooks,
  allowDuplicates,
  onAdd,
  mode = 'library',
  targetStatus = mode === 'reading' ? 'want_to_read' : 'unset',
  onTrackExisting,
  autoFocus = false,
}: BookSearchProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    UnifiedExternalSearchMatch[]
  >([]);
  const [libraryMatches, setLibraryMatches] = useState<
    UnifiedLibrarySearchMatch[]
  >([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isAdding, setIsAdding] = useState<string | null>(null);
  const [trackedIds, setTrackedIds] = useState<Set<string>>(new Set());
  const searchAbortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => searchAbortControllerRef.current?.abort();
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    if (searchAbortControllerRef.current) {
      searchAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    searchAbortControllerRef.current = abortController;

    setIsSearching(true);
    setHasSearched(false);
    try {
      const cleanQuery = searchQuery.trim();

      if (
        mode === 'reading' &&
        typeof trpcVanilla.readingTracker?.searchUnified?.query === 'function'
      ) {
        const res = await trpcVanilla.readingTracker.searchUnified.query({
          query: cleanQuery,
        });
        if (abortController.signal.aborted) return;
        setLibraryMatches(res.libraryMatches || []);
        setSearchResults(res.externalMatches || []);
      } else {
        const isIsbn = /^\d{10,13}$/.test(cleanQuery.replace(/[- ]/g, ''));
        let books: BookDetails[] = [];
        if (isIsbn) {
          const book = await trpcVanilla.metadata.searchByIsbn.mutate({
            isbn: cleanQuery.replace(/[- ]/g, ''),
            priority: 'INTERACTIVE',
          });
          if (book) books = [book];
        }
        if (books.length === 0) {
          books = await trpcVanilla.metadata.searchByTitle.mutate({
            query: cleanQuery,
            limit: 15,
          });
        }
        if (abortController.signal.aborted) return;
        setLibraryMatches([]);
        setSearchResults(books);
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      toast.error('Failed to search books. Please try again.');
      setLibraryMatches([]);
      setSearchResults([]);
    } finally {
      if (!abortController.signal.aborted) {
        setIsSearching(false);
        setHasSearched(true);
      }
    }
  };

  const handleTrackLibraryMatch = async (match: {
    libraryId: string;
    bookId: string;
    title: string;
  }) => {
    if (!onTrackExisting) return;
    const key = `${match.libraryId}:${match.bookId}`;
    setIsAdding(key);
    try {
      await onTrackExisting(match);
      setTrackedIds(prev => new Set(prev).add(key));
    } finally {
      setIsAdding(null);
    }
  };

  const handleAddClick = async (book: UnifiedExternalSearchMatch) => {
    if (mode === 'reading' && book.existingMatch && onTrackExisting) {
      await handleTrackLibraryMatch({
        libraryId: book.existingMatch.libraryId,
        bookId: book.existingMatch.bookId,
        title: book.title,
      });
      return;
    }

    const bookToAdd = normalizeBookDetails(book);

    if (!allowDuplicates && isDuplicateBook(bookToAdd, existingBooks)) {
      toast.info(`Skipped duplicate: ${bookToAdd.title}`);
      return;
    }

    const itemKey = book.isbn || book.title;
    setIsAdding(itemKey);
    try {
      await onAdd(bookToAdd);
      setTrackedIds(prev => new Set(prev).add(itemKey));
    } finally {
      setIsAdding(null);
    }
  };

  const statusActionLabel =
    mode === 'reading'
      ? `Add to ${STATUS_LABELS[targetStatus === 'unset' ? 'want_to_read' : targetStatus]}`
      : 'Add to Library';

  const totalMatches = libraryMatches.length + searchResults.length;

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-on-surface-variant absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
          <Input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Search by title, author, or ISBN..."
            autoFocus={autoFocus}
            className="w-full bg-surface-container/50 border-outline-variant/60 rounded-lg pl-11 pr-4 h-12 text-on-surface font-medium placeholder:text-on-surface-variant/60"
          />
        </div>
        <Button
          type="submit"
          disabled={isSearching}
          className="rounded-lg shadow-xs transition-all flex items-center justify-center sm:w-auto w-full font-semibold shrink-0 px-7 h-12 whitespace-nowrap"
        >
          {isSearching ? (
            <>
              <Loader2 className="animate-spin mr-2" size={18} />
              <span>Searching</span>
            </>
          ) : (
            <span>Search</span>
          )}
        </Button>
      </form>

      <div className="space-y-6">
        {isSearching ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map(i => (
              <div
                key={i}
                className="bg-surface-variant/40 p-4 rounded-xl flex gap-4 items-center border border-outline-variant/30"
              >
                <div className="w-14 h-20 sm:w-16 sm:h-24 bg-surface-variant/50 rounded-md shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-5 bg-surface-variant/50 rounded w-3/4" />
                  <div className="h-4 bg-surface-variant/50 rounded w-1/2" />
                </div>
                <div className="w-28 h-10 bg-surface-variant/50 rounded-lg shrink-0" />
              </div>
            ))}
          </div>
        ) : hasSearched && totalMatches === 0 ? (
          <div className="text-center py-12 bg-surface-container-low rounded-xl border border-outline-variant/40">
            <p className="text-on-surface font-medium">
              No matching books found. Try a different search term or switch to
              Manual Entry.
            </p>
          </div>
        ) : (
          <>
            {/* Reading Mode Section 1: Existing Matches in Accessible Libraries */}
            {mode === 'reading' && libraryMatches.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="metadata-eyebrow flex items-center gap-1.5">
                    <LibraryIcon className="w-3.5 h-3.5 text-primary" />
                    In Your Accessible Libraries ({libraryMatches.length})
                  </span>
                  <span className="text-xs text-on-surface-variant font-sans">
                    Tracks existing volume in place without duplicating
                  </span>
                </div>

                <div className="space-y-2.5">
                  {libraryMatches.map(match => {
                    const matchKey = `${match.libraryId}:${match.bookId}`;
                    const isTrackedNow =
                      trackedIds.has(matchKey) ||
                      (match.readingStatus !== 'unset' &&
                        match.readingStatus === targetStatus);
                    const isBusy = isAdding === matchKey;

                    return (
                      <div
                        key={matchKey}
                        className="bg-surface-container-low/70 p-3.5 sm:p-4 rounded-xl border border-outline-variant/50 flex flex-col sm:flex-row gap-3.5 sm:gap-5 items-start sm:items-center justify-between transition-colors hover:border-outline-variant/80"
                      >
                        <div className="flex items-center gap-3.5 min-w-0 w-full sm:w-auto">
                          <div className="w-12 h-18 sm:w-14 sm:h-20 rounded-md bg-surface-container border border-outline-variant/40 overflow-hidden shrink-0 flex items-center justify-center">
                            {match.coverUrl ? (
                              <img
                                src={match.coverUrl}
                                alt={match.title}
                                className="w-full h-full object-cover"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                              />
                            ) : (
                              <BookIcon className="w-5 h-5 text-on-surface-variant/50" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h3 className="font-serif font-semibold text-base sm:text-lg text-on-surface truncate">
                              {toTitleCase(match.title)}
                            </h3>
                            <p className="text-xs sm:text-sm text-on-surface-variant truncate mt-0.5">
                              {toTitleCase(match.author)}
                              {' · '}
                              {match.ownershipStatus === 'unowned'
                                ? 'Un-owned · Personal Reading Shelf'
                                : `Owned · In ${toTitleCase(match.libraryName)}`}
                            </p>
                            {match.readingStatus !== 'unset' && (
                              <div className="mt-1.5">
                                <Badge
                                  variant="outline"
                                  size="sm"
                                  className="text-[11px]"
                                >
                                  Current:{' '}
                                  {STATUS_LABELS[match.readingStatus] ||
                                    match.readingStatus}
                                </Badge>
                              </div>
                            )}
                          </div>
                        </div>

                        <Button
                          type="button"
                          variant={isTrackedNow ? 'outline' : 'default'}
                          onClick={() => void handleTrackLibraryMatch(match)}
                          disabled={isBusy || isTrackedNow}
                          className="w-full sm:w-auto rounded-lg flex items-center justify-center gap-2 font-semibold h-10 px-4 whitespace-nowrap shrink-0"
                        >
                          {isBusy ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : isTrackedNow ? (
                            <>
                              <Check size={16} />
                              <span>
                                Tracked ·{' '}
                                {
                                  STATUS_LABELS[
                                    targetStatus === 'unset'
                                      ? 'want_to_read'
                                      : targetStatus
                                  ]
                                }
                              </span>
                            </>
                          ) : (
                            <>
                              <BookPlus size={16} />
                              <span>
                                Track as{' '}
                                {
                                  STATUS_LABELS[
                                    targetStatus === 'unset'
                                      ? 'want_to_read'
                                      : targetStatus
                                  ]
                                }
                              </span>
                            </>
                          )}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Global Catalog Matches */}
            {searchResults.length > 0 && (
              <div className="space-y-3">
                {mode === 'reading' && (
                  <div className="flex items-center justify-between">
                    <span className="metadata-eyebrow flex items-center gap-1.5">
                      <Globe className="w-3.5 h-3.5 text-primary" />
                      Global Literary Catalog ({searchResults.length})
                    </span>
                    <span className="text-xs text-on-surface-variant font-sans">
                      Saves as un-owned to your Personal Reading Shelf
                    </span>
                  </div>
                )}

                <div className="space-y-3">
                  {searchResults.map((book, idx) => {
                    const existingMatch = book.existingMatch;
                    const itemKey = existingMatch
                      ? `${existingMatch.libraryId}:${existingMatch.bookId}`
                      : book.isbn || book.title;
                    const isBusy = isAdding === itemKey;
                    const isAdded = trackedIds.has(itemKey);

                    return (
                      <div
                        key={`${itemKey}-${idx}`}
                        className="bg-surface-container-low/60 p-3.5 sm:p-5 rounded-xl border border-outline-variant/40 flex flex-row gap-3.5 sm:gap-5 shadow-elevation-1 hover:border-outline-variant/80 transition-all items-start sm:items-center group"
                      >
                        {book.coverUrl ? (
                          <img
                            src={book.coverUrl}
                            alt={book.title}
                            className="w-16 h-24 sm:w-20 sm:h-28 object-cover rounded-lg shadow-2xs border border-outline-variant/20 shrink-0"
                            referrerPolicy="no-referrer"
                            loading="lazy"
                            onError={e => {
                              (e.target as HTMLImageElement).style.display =
                                'none';
                              (
                                e.target as HTMLImageElement
                              ).nextElementSibling?.classList.remove('hidden');
                            }}
                          />
                        ) : (
                          <div className="w-16 h-24 sm:w-20 sm:h-28 bg-surface-variant/60 rounded-lg flex items-center justify-center shrink-0 border border-outline-variant/30">
                            <span className="text-outline text-xs font-medium">
                              No cover
                            </span>
                          </div>
                        )}
                        <div className="hidden w-16 h-24 sm:w-20 sm:h-28 bg-surface-variant/60 rounded-lg flex items-center justify-center shrink-0 border border-outline-variant/30">
                          <span className="text-outline text-xs font-medium">
                            No cover
                          </span>
                        </div>
                        <div className="flex-1 min-w-0 py-0.5">
                          <h3 className="font-serif font-bold text-base sm:text-xl text-on-surface mb-0.5 truncate tracking-tight pr-4">
                            {toTitleCase(book.title)}
                          </h3>
                          {book.author && (
                            <p className="text-on-surface-variant text-sm mb-1.5 font-medium truncate">
                              {toTitleCase(book.author)}
                            </p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 text-xs text-outline font-mono tabular-nums">
                            {book.publishedDate && (
                              <span>Published: {book.publishedDate}</span>
                            )}
                            {existingMatch && (
                              <Badge
                                variant="outline"
                                size="sm"
                                className="font-sans text-[11px]"
                              >
                                {existingMatch.ownershipStatus === 'unowned'
                                  ? 'Already on Reading Shelf'
                                  : `In ${toTitleCase(existingMatch.libraryName)}`}
                              </Badge>
                            )}
                          </div>
                          <div className="mt-3 flex flex-col sm:hidden w-full">
                            <Button
                              type="button"
                              variant={isAdded ? 'outline' : 'default'}
                              onClick={() => void handleAddClick(book)}
                              disabled={isBusy || isAdded}
                              className="w-full rounded-lg flex items-center justify-center gap-2 font-semibold h-9 whitespace-nowrap"
                            >
                              {isBusy ? (
                                <Loader2 size={16} className="animate-spin" />
                              ) : isAdded ? (
                                <>
                                  <Check size={16} /> Added
                                </>
                              ) : (
                                <>
                                  <BookPlus size={16} strokeWidth={2.25} />{' '}
                                  {statusActionLabel}
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        <div className="hidden sm:flex flex-col items-end gap-2 shrink-0 ml-2">
                          <Button
                            type="button"
                            variant={isAdded ? 'outline' : 'default'}
                            onClick={() => void handleAddClick(book)}
                            disabled={isBusy || isAdded}
                            className="rounded-lg flex items-center gap-2 font-semibold px-4 h-10 whitespace-nowrap"
                            title={statusActionLabel}
                          >
                            {isBusy ? (
                              <Loader2 size={18} className="animate-spin" />
                            ) : isAdded ? (
                              <>
                                <Check size={18} /> Added
                              </>
                            ) : (
                              <>
                                <BookPlus size={18} strokeWidth={2.25} />
                                <span>
                                  {mode === 'reading'
                                    ? statusActionLabel
                                    : 'Add'}
                                </span>
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
