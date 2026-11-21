import React, {useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {Plus, ArrowRight, Play} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {MonographCoverFallback} from './MonographCoverFallback';
import {SharedCoverFrame} from './SharedCoverFrame';
import {navigateWithCoverTransition} from '../../lib/bookCoverTransition';
import {Button} from '@/components/ui/button';
import type {ShelfFilterTab} from '../../pages/dashboard/useReadingShelf';
import type {
  Book,
  TrackedBookItem,
  TrackedShelfStatus,
  UnreadLibraryBookItem,
} from '../../types';

export interface ComputeEligibleUnreadBooksParams {
  isLibraryScoped: boolean;
  scopedItems: TrackedBookItem[];
  rawUnreadLibraryBooks: UnreadLibraryBookItem[];
  sourceList: Array<Book | TrackedBookItem>;
}

export function computeEligibleUnreadLibraryBooks(
  params: ComputeEligibleUnreadBooksParams,
): UnreadLibraryBookItem[] {
  const {isLibraryScoped, scopedItems, rawUnreadLibraryBooks, sourceList} =
    params;
  if (isLibraryScoped) {
    return [];
  }

  const excludedIds = new Set<string>();
  const excludedTitleAuthorKeys = new Set<string>();

  for (const item of scopedItems) {
    if (
      item.readingStatus === 'reading' ||
      item.readingStatus === 'finished' ||
      item.readingStatus === 'abandoned'
    ) {
      excludedIds.add(`${item.libraryId}::${item.id}`);
      excludedTitleAuthorKeys.add(
        `${item.title.toLowerCase().trim()}::${item.author.toLowerCase().trim()}`,
      );
    }
  }

  const rawCandidates: UnreadLibraryBookItem[] = [...rawUnreadLibraryBooks];

  for (const item of sourceList) {
    const resolvedLibId = item.libraryId || '';
    const isVirtual =
      ('isVirtual' in item && Boolean(item.isVirtual)) ||
      resolvedLibId.startsWith('virtual_') ||
      item.ownershipStatus === 'unowned';
    if (!resolvedLibId || isVirtual) {
      continue;
    }

    const rawStatus = item.readingStatus || 'unset';

    if (
      rawStatus === 'reading' ||
      rawStatus === 'finished' ||
      rawStatus === 'abandoned'
    ) {
      continue;
    }

    rawCandidates.push({
      ...item,
      id: item.id,
      libraryId: resolvedLibId,
      libraryName: ('libraryName' in item && item.libraryName) || 'Library',
      title: item.title,
      author: item.author,
      coverUrl: item.coverUrl,
      primaryGenre: item.primaryGenre,
      synopsis: item.synopsis,
      readingStatus: rawStatus === 'want_to_read' ? 'want_to_read' : 'unset',
    });
  }

  const seenKeys = new Set<string>();
  const filtered: UnreadLibraryBookItem[] = [];

  for (const candidate of rawCandidates) {
    const idKey = `${candidate.libraryId}::${candidate.id}`;
    const titleAuthorKey = `${candidate.title.toLowerCase().trim()}::${candidate.author.toLowerCase().trim()}`;

    if (
      excludedIds.has(idKey) ||
      excludedTitleAuthorKeys.has(titleAuthorKey) ||
      seenKeys.has(titleAuthorKey)
    ) {
      continue;
    }

    seenKeys.add(titleAuthorKey);
    filtered.push(candidate);
  }

  return filtered;
}

export interface ReadingBentoWantToReadCardProps {
  wantToReadBooks: TrackedBookItem[];
  compactRow?: boolean;
  isLibraryScoped: boolean;
  libraryId?: string;
  onTrackBook: (
    defaultShelf: 'want_to_read' | 'reading' | 'finished' | 'abandoned',
  ) => void;
  onOpenShelf: (tab: ShelfFilterTab, genre?: string | null) => void;
  onStatusChange: (
    libraryId: string,
    bookId: string,
    newStatus: TrackedShelfStatus | 'unset',
  ) => Promise<void>;
}

export function ReadingBentoWantToReadCard({
  wantToReadBooks,
  compactRow = false,
  isLibraryScoped,
  libraryId,
  onTrackBook,
  onOpenShelf,
  onStatusChange,
}: ReadingBentoWantToReadCardProps) {
  const navigate = useNavigate();
  const isOnline = useOnlineStatus();
  const [failedCovers, setFailedCovers] = useState<Set<string>>(new Set());

  return (
    <div
      className={`bento-card p-4 sm:p-5 ${
        compactRow ? 'w-full flex flex-col justify-between' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-3 mb-3.5">
        <div className="flex items-center gap-2">
          <span className="metadata-eyebrow">Up Next · Want to Read</span>
          <span className="font-mono tabular-nums text-xs text-on-surface-variant">
            ({wantToReadBooks.length})
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            onClick={() => onTrackBook('want_to_read')}
            className="h-7 px-2.5 text-xs font-sans font-semibold text-on-surface-variant hover:text-primary gap-1 disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </Button>
          {wantToReadBooks.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenShelf('want_to_read')}
              className="h-7 px-2.5 text-xs font-sans font-semibold text-primary hover:text-primary/80 gap-1"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {wantToReadBooks.length === 0 ? (
        <div
          className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 px-1 text-xs text-on-surface-variant ${
            compactRow ? 'my-auto' : ''
          }`}
        >
          <p>
            Your reading list is wide open. Save a few books you&apos;d love to
            pick up next.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!isOnline}
            title={!isOnline ? 'Unavailable while offline' : undefined}
            onClick={() => onTrackBook('want_to_read')}
            className="h-8 px-3 text-xs font-semibold shrink-0 self-start sm:self-auto disabled:opacity-50"
          >
            Add to Want to Read
          </Button>
        </div>
      ) : (
        <div
          className={
            compactRow
              ? 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5'
              : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3.5'
          }
        >
          {wantToReadBooks.slice(0, compactRow ? 4 : 6).map(item => (
            <div
              key={`${item.libraryId}-${item.id}`}
              onClick={() =>
                navigateWithCoverTransition({
                  navigate,
                  libraryId: item.libraryId,
                  bookId: item.id,
                  originSurface: 'want-to-read',
                  fromRouteKey:
                    isLibraryScoped && libraryId
                      ? `/library/${libraryId}`
                      : '/',
                  coverPreview: {
                    title: item.title,
                    author: item.author,
                    coverUrl: item.coverUrl,
                    publishedDate: item.publishedDate,
                    primaryGenre: item.primaryGenre,
                    subgenres: item.subgenres,
                    series: item.series,
                    synopsis: item.synopsis,
                    readingStatus: item.readingStatus,
                    ownershipStatus: item.ownershipStatus,
                    format: item.format,
                    isbn: item.isbn,
                  },
                })
              }
              className="group flex flex-col p-2.5 rounded-lg bg-surface hover:bg-surface-container-low border border-outline-variant/40 transition-colors cursor-pointer"
            >
              <SharedCoverFrame
                surface="want-to-read"
                libraryId={item.libraryId}
                bookId={item.id}
                className="relative aspect-[2/3] w-full rounded overflow-hidden bg-surface-container mb-2 border border-outline-variant/40 book-cover-shadow"
              >
                {item.coverUrl && !failedCovers.has(item.id) ? (
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    onError={() =>
                      setFailedCovers(prev => new Set(prev).add(item.id))
                    }
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform"
                    loading="lazy"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <MonographCoverFallback
                    title={item.title}
                    author={item.author}
                    variant="compact"
                    className="w-full h-full"
                  />
                )}
                <button
                  type="button"
                  disabled={!isOnline}
                  title={
                    !isOnline ? 'Unavailable while offline' : 'Start Reading'
                  }
                  onClick={e => {
                    e.stopPropagation();
                    if (!isOnline) {
                      return;
                    }
                    void onStatusChange(item.libraryId, item.id, 'reading');
                  }}
                  className="absolute bottom-1.5 right-1.5 opacity-0 group-hover:opacity-100 transition-opacity bg-primary text-on-primary text-[10px] font-sans font-semibold px-2 py-1 rounded shadow-xs inline-flex items-center gap-1 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Play className="w-2.5 h-2.5 fill-current" />
                  <span>Read</span>
                </button>
              </SharedCoverFrame>
              <h4 className="font-serif text-xs font-semibold text-on-surface group-hover:text-primary truncate">
                {toTitleCase(item.title)}
              </h4>
              <p className="font-sans text-[11px] text-on-surface-variant truncate">
                {toTitleCase(item.author)}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
