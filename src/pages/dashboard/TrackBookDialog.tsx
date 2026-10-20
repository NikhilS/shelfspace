import React, {useState} from 'react';
import {
  Search,
  Book as BookIcon,
  Library as LibraryIcon,
  Globe,
  Loader2,
  Check,
  ArrowLeft,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Textarea} from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {StarRating} from '@/components/ui/star-rating';
import {trpcVanilla} from '../../lib/trpc';
import {toTitleCase} from '../../lib/utils';
import {toast} from 'sonner';
import type {Library} from '../../types';
import type {
  TrackedShelfStatus,
  UnifiedLibrarySearchMatch,
  UnifiedExternalSearchMatch,
  TrackBookInput,
} from '../../server/services/readingTracker';

interface TrackBookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  libraries: Library[];
  defaultShelf?: TrackedShelfStatus;
  onTrackBook: (input: TrackBookInput) => Promise<unknown>;
}

type SelectedCandidate =
  | {
      kind: 'library';
      match: UnifiedLibrarySearchMatch;
    }
  | {
      kind: 'external';
      match: UnifiedExternalSearchMatch;
    }
  | {
      kind: 'manual';
      title: string;
      author: string;
      isbn: string;
    };

export function TrackBookDialog({
  isOpen,
  onClose,
  libraries,
  defaultShelf = 'want_to_read',
  onTrackBook,
}: TrackBookDialogProps) {
  const [query, setQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [libraryMatches, setLibraryMatches] = useState<
    UnifiedLibrarySearchMatch[]
  >([]);
  const [externalMatches, setExternalMatches] = useState<
    UnifiedExternalSearchMatch[]
  >([]);

  const [selected, setSelected] = useState<SelectedCandidate | null>(null);
  const [targetStatus, setTargetStatus] =
    useState<TrackedShelfStatus>(defaultShelf);
  const [destinationLibraryId, setDestinationLibraryId] =
    useState<string>('virtual');
  const [rating, setRating] = useState<number>(0);
  const [reviewText, setReviewText] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const editableLibraries = libraries.filter(
    l =>
      !l.isVirtual &&
      !l.id.startsWith('virtual_') &&
      (l.isOwner ||
        l.canEdit ||
        l.callerRole === 'owner' ||
        l.callerRole === 'editor' ||
        l.callerRole === 'admin'),
  );

  const resetDialog = () => {
    setQuery('');
    setIsSearching(false);
    setHasSearched(false);
    setLibraryMatches([]);
    setExternalMatches([]);
    setSelected(null);
    setTargetStatus(defaultShelf);
    setDestinationLibraryId('virtual');
    setRating(0);
    setReviewText('');
    setIsSubmitting(false);
  };

  const handleClose = () => {
    resetDialog();
    onClose();
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) return;

    setIsSearching(true);
    setSelected(null);
    try {
      const res = await trpcVanilla.readingTracker.searchUnified.query({
        query: trimmed,
      });
      setLibraryMatches(res.libraryMatches || []);
      setExternalMatches(res.externalMatches || []);
      setHasSearched(true);
    } catch (err) {
      console.error('Unified book search failed:', err);
      toast.error('Failed to search catalogs');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSelectCandidate = (candidate: SelectedCandidate) => {
    setSelected(candidate);
    if (
      candidate.kind === 'library' &&
      candidate.match.readingStatus !== 'unset'
    ) {
      setTargetStatus(candidate.match.readingStatus);
    } else if (
      candidate.kind === 'external' &&
      candidate.match.existingMatch &&
      candidate.match.existingMatch.readingStatus !== 'unset'
    ) {
      setTargetStatus(candidate.match.existingMatch.readingStatus);
    } else {
      setTargetStatus(defaultShelf);
    }
    if (candidate.kind === 'library' && candidate.match.userRating) {
      setRating(candidate.match.userRating);
    } else {
      setRating(0);
    }
    setReviewText('');
  };

  const handleConfirmTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selected || isSubmitting) return;

    setIsSubmitting(true);
    try {
      if (selected.kind === 'library') {
        await onTrackBook({
          source: 'library',
          libraryId: selected.match.libraryId,
          bookId: selected.match.bookId,
          status: targetStatus,
          ...(rating > 0 ? {rating} : {}),
          ...(reviewText.trim() ? {reviewText: reviewText.trim()} : {}),
        });
      } else if (
        selected.kind === 'external' &&
        selected.match.existingMatch &&
        destinationLibraryId === 'virtual'
      ) {
        // Already exists in an accessible library or virtual shelf; update in place
        await onTrackBook({
          source: 'library',
          libraryId: selected.match.existingMatch.libraryId,
          bookId: selected.match.existingMatch.bookId,
          status: targetStatus,
          ...(rating > 0 ? {rating} : {}),
          ...(reviewText.trim() ? {reviewText: reviewText.trim()} : {}),
        });
      } else if (selected.kind === 'external') {
        await onTrackBook({
          source: 'external',
          status: targetStatus,
          ...(destinationLibraryId !== 'virtual'
            ? {targetLibraryId: destinationLibraryId}
            : {}),
          bookData: {
            title: selected.match.title,
            author: selected.match.author,
            isbn: selected.match.isbn,
            coverUrl: selected.match.coverUrl,
            publishedDate: selected.match.publishedDate,
            primaryGenre: selected.match.primaryGenre,
            subgenres: selected.match.subgenres,
            synopsis: selected.match.synopsis,
            authorBio: selected.match.authorBio,
            series: selected.match.series,
            format: selected.match.format || 'physical',
          },
          ...(rating > 0 ? {rating} : {}),
          ...(reviewText.trim() ? {reviewText: reviewText.trim()} : {}),
        });
      } else {
        await onTrackBook({
          source: 'external',
          status: targetStatus,
          ...(destinationLibraryId !== 'virtual'
            ? {targetLibraryId: destinationLibraryId}
            : {}),
          bookData: {
            title: selected.title.trim(),
            author: selected.author.trim() || 'Unknown Author',
            ...(selected.isbn.trim() ? {isbn: selected.isbn.trim()} : {}),
          },
          ...(rating > 0 ? {rating} : {}),
          ...(reviewText.trim() ? {reviewText: reviewText.trim()} : {}),
        });
      }

      toast.success('Added to your reading list');
      handleClose();
    } catch (err) {
      console.error('Failed to track book:', err);
      toast.error('Failed to save book to reading list');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={open => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl text-on-surface">
            Track a Book
          </DialogTitle>
          <DialogDescription className="font-sans text-sm text-on-surface-variant">
            Search across your accessible libraries and global literary catalogs
            to add a volume to your reading lists, or rate and review it.
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <div className="flex flex-col flex-1 min-h-0 space-y-4 pt-2">
            <form onSubmit={handleSearch} className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <Input
                  type="text"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Search by title, author, or ISBN..."
                  className="pl-10 h-11 bg-surface-container-low border-outline-variant/70"
                  autoFocus
                />
              </div>
              <Button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="h-11 px-5 whitespace-nowrap shrink-0"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span>Searching</span>
                  </>
                ) : (
                  <span>Search</span>
                )}
              </Button>
            </form>

            <div className="flex-1 overflow-y-auto space-y-6 pr-1 min-h-[240px]">
              {isSearching ? (
                <div className="py-16 flex flex-col items-center justify-center text-center text-on-surface-variant">
                  <Loader2 className="w-6 h-6 animate-spin text-primary mb-2.5" />
                  <p className="text-sm font-sans">
                    Searching your libraries and external catalogs...
                  </p>
                </div>
              ) : hasSearched ? (
                <>
                  {/* Section 1: Matches from Accessible Libraries */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="metadata-eyebrow flex items-center gap-1.5">
                        <LibraryIcon className="w-3.5 h-3.5 text-primary" />
                        From Your Accessible Libraries ({libraryMatches.length})
                      </span>
                    </div>
                    {libraryMatches.length === 0 ? (
                      <p className="text-xs text-on-surface-variant py-2">
                        No matching volumes found in your libraries.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {libraryMatches.map(match => (
                          <button
                            key={`${match.libraryId}-${match.bookId}`}
                            type="button"
                            onClick={() =>
                              handleSelectCandidate({kind: 'library', match})
                            }
                            className="w-full text-left p-3 rounded-lg border border-outline-variant/60 bg-surface hover:bg-surface-container-low transition-colors flex items-center justify-between gap-3 cursor-pointer"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-14 rounded bg-surface-container border border-outline-variant/50 overflow-hidden shrink-0 flex items-center justify-center">
                                {match.coverUrl ? (
                                  <img
                                    src={match.coverUrl}
                                    alt={match.title}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <BookIcon className="w-4 h-4 text-on-surface-variant/60" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="font-serif font-semibold text-sm text-on-surface truncate">
                                  {toTitleCase(match.title)}
                                </p>
                                <p className="text-xs text-on-surface-variant truncate">
                                  {toTitleCase(match.author)}
                                  {' · '}
                                  {match.ownershipStatus === 'unowned'
                                    ? 'Un-owned (Reading Shelf)'
                                    : `In ${toTitleCase(match.libraryName)}`}
                                </p>
                              </div>
                            </div>
                            <span className="text-xs font-sans font-semibold text-primary whitespace-nowrap shrink-0">
                              Select →
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Section 2: Matches from External Providers */}
                  <div className="pt-2 border-t border-outline-variant/50">
                    <div className="flex items-center justify-between mb-2.5">
                      <span className="metadata-eyebrow flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-primary" />
                        From Literary Catalogs ({externalMatches.length})
                      </span>
                    </div>
                    {externalMatches.length === 0 ? (
                      <p className="text-xs text-on-surface-variant py-2">
                        No catalog matches found for &ldquo;{query}&rdquo;.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {externalMatches.map((match, idx) => (
                          <button
                            key={`${match.isbn || match.title}-${idx}`}
                            type="button"
                            onClick={() =>
                              handleSelectCandidate({kind: 'external', match})
                            }
                            className="w-full text-left p-3 rounded-lg border border-outline-variant/60 bg-surface hover:bg-surface-container-low transition-colors flex items-center justify-between gap-3 cursor-pointer"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="w-10 h-14 rounded bg-surface-container border border-outline-variant/50 overflow-hidden shrink-0 flex items-center justify-center">
                                {match.coverUrl ? (
                                  <img
                                    src={match.coverUrl}
                                    alt={match.title}
                                    className="w-full h-full object-cover"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <BookIcon className="w-4 h-4 text-on-surface-variant/60" />
                                )}
                              </div>
                              <div className="min-w-0">
                                <p className="font-serif font-semibold text-sm text-on-surface truncate">
                                  {toTitleCase(match.title)}
                                </p>
                                <p className="text-xs text-on-surface-variant truncate">
                                  {toTitleCase(
                                    match.author || 'Unknown Author',
                                  )}
                                  {match.publishedDate
                                    ? ` · ${match.publishedDate.slice(0, 4)}`
                                    : ''}
                                  {match.existingMatch
                                    ? ` · Already in ${toTitleCase(match.existingMatch.libraryName)}`
                                    : ' · Un-owned'}
                                </p>
                              </div>
                            </div>
                            <span className="text-xs font-sans font-semibold text-primary whitespace-nowrap shrink-0">
                              Track →
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Manual Fallback */}
                  <div className="pt-3 border-t border-outline-variant/50 flex items-center justify-between gap-3">
                    <span className="text-xs text-on-surface-variant">
                      Can&apos;t find the exact edition?
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        handleSelectCandidate({
                          kind: 'manual',
                          title: query.trim(),
                          author: '',
                          isbn: '',
                        })
                      }
                    >
                      Track &ldquo;{query.trim()}&rdquo; Manually
                    </Button>
                  </div>
                </>
              ) : (
                <div className="py-12 text-center text-on-surface-variant">
                  <BookIcon className="w-8 h-8 mx-auto mb-3 text-on-surface-variant/50" />
                  <p className="text-sm font-sans max-w-md mx-auto">
                    Enter a title, author, or ISBN above to search across your
                    libraries and external book providers.
                  </p>
                </div>
              )}
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleConfirmTrack}
            className="flex flex-col flex-1 min-h-0 space-y-5 pt-2 overflow-y-auto pr-1"
          >
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="inline-flex items-center gap-1.5 text-xs font-sans font-semibold text-on-surface-variant hover:text-primary cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                Back to Search Results
              </button>
            </div>

            {selected.kind === 'manual' ? (
              <div className="space-y-3 p-4 rounded-xl border border-outline-variant/60 bg-surface-container-low">
                <div>
                  <label className="metadata-eyebrow block mb-1">Title</label>
                  <Input
                    value={selected.title}
                    onChange={e =>
                      setSelected({...selected, title: e.target.value})
                    }
                    required
                    placeholder="Book title"
                  />
                </div>
                <div>
                  <label className="metadata-eyebrow block mb-1">Author</label>
                  <Input
                    value={selected.author}
                    onChange={e =>
                      setSelected({...selected, author: e.target.value})
                    }
                    placeholder="Author name"
                  />
                </div>
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-outline-variant/60 bg-surface-container-low flex items-start gap-4">
                <div className="w-14 aspect-[2/3] rounded bg-surface-container border border-outline-variant/50 overflow-hidden shrink-0 flex items-center justify-center">
                  {selected.match.coverUrl ? (
                    <img
                      src={selected.match.coverUrl}
                      alt={selected.match.title}
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <BookIcon className="w-5 h-5 text-on-surface-variant/60" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="metadata-eyebrow block mb-0.5">
                    {selected.kind === 'library'
                      ? selected.match.ownershipStatus === 'unowned'
                        ? 'Un-owned Volume'
                        : `In Library: ${toTitleCase(selected.match.libraryName)}`
                      : selected.match.existingMatch
                        ? `Matched in ${toTitleCase(selected.match.existingMatch.libraryName)}`
                        : 'Catalog Volume · Un-owned'}
                  </span>
                  <h4 className="font-serif text-lg font-semibold text-on-surface leading-snug">
                    {toTitleCase(selected.match.title)}
                  </h4>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {toTitleCase(selected.match.author || 'Unknown Author')}
                  </p>
                </div>
              </div>
            )}

            {/* Reading Shelf Selector */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="metadata-eyebrow block mb-1.5">
                  Reading List
                </label>
                <Select
                  value={targetStatus}
                  onValueChange={v => setTargetStatus(v as TrackedShelfStatus)}
                >
                  <SelectTrigger className="w-full h-10 bg-surface">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="want_to_read">Want to Read</SelectItem>
                    <SelectItem value="reading">Currently Reading</SelectItem>
                    <SelectItem value="finished">Read (Finished)</SelectItem>
                    <SelectItem value="abandoned">Abandoned</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {(selected.kind === 'manual' ||
                (selected.kind === 'external' &&
                  !selected.match.existingMatch)) && (
                <div>
                  <label className="metadata-eyebrow block mb-1.5">
                    Ownership & Collection
                  </label>
                  <Select
                    value={destinationLibraryId}
                    onValueChange={setDestinationLibraryId}
                  >
                    <SelectTrigger className="w-full h-10 bg-surface">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="virtual">
                        Un-owned (Personal Reading Shelf)
                      </SelectItem>
                      {editableLibraries.map(lib => (
                        <SelectItem key={lib.id} value={lib.id}>
                          Add to Library: {toTitleCase(lib.name)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Optional Rating & Review */}
            <div className="p-4 rounded-xl border border-outline-variant/60 bg-surface space-y-3">
              <div className="flex items-center justify-between">
                <span className="metadata-eyebrow">
                  Rating & Review (Optional)
                </span>
                {rating > 0 && (
                  <button
                    type="button"
                    onClick={() => setRating(0)}
                    className="text-xs text-on-surface-variant hover:text-primary"
                  >
                    Clear rating
                  </button>
                )}
              </div>
              <StarRating
                interactive
                rating={rating}
                onRatingChange={setRating}
                size="md"
              />
              <Textarea
                value={reviewText}
                onChange={e => setReviewText(e.target.value)}
                placeholder="Write a brief review or reading note..."
                className="min-h-[84px] text-sm bg-surface-container-low border-outline-variant/60"
              />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  isSubmitting ||
                  (selected.kind === 'manual' && !selected.title.trim())
                }
                className="gap-2"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save to Reading List</span>
                  </>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
