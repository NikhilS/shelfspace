import React from 'react';
import {useNavigate} from 'react-router-dom';
import {Book as BookIcon, Star} from 'lucide-react';
import {toTitleCase} from '../../lib/utils';
import {Badge} from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type {
  TrackedBookItem,
  TrackedShelfStatus,
} from '../../server/services/readingTracker';

interface ReadingShelfCardProps {
  item: TrackedBookItem;
  onStatusChange: (
    libraryId: string,
    bookId: string,
    status: TrackedShelfStatus | 'unset',
  ) => Promise<void>;
}

const STATUS_BADGE_MAP: Record<
  TrackedShelfStatus,
  {
    variant:
      'status-to-read' | 'status-reading' | 'status-read' | 'status-abandoned';
    label: string;
  }
> = {
  want_to_read: {variant: 'status-to-read', label: 'WANT TO READ'},
  reading: {variant: 'status-reading', label: 'READING'},
  finished: {variant: 'status-read', label: 'READ'},
  abandoned: {variant: 'status-abandoned', label: 'ABANDONED'},
};

export function ReadingShelfCard({
  item,
  onStatusChange,
}: ReadingShelfCardProps) {
  const navigate = useNavigate();

  const pubYear =
    item.publishedDate && item.publishedDate.length >= 4
      ? item.publishedDate.slice(0, 4)
      : null;

  const badgeMeta =
    STATUS_BADGE_MAP[item.readingStatus] || STATUS_BADGE_MAP.want_to_read;

  const handleNavigate = () => {
    void navigate(
      `/library/${encodeURIComponent(item.libraryId)}/book/${encodeURIComponent(item.id)}`,
      {
        state: {from: '/'},
      },
    );
  };

  return (
    <article
      onClick={handleNavigate}
      className="group cursor-pointer flex flex-col justify-between h-full bento-card-interactive p-3.5"
    >
      <div>
        {/* Top Row: Cover Thumbnail + Editorial Details */}
        <div className="flex gap-3.5 items-start">
          <div className="w-16 sm:w-20 aspect-[2/3] shrink-0 bg-surface-container rounded-md book-cover-shadow overflow-hidden border border-outline-variant/50 relative">
            <div
              className="absolute inset-y-0 left-0 w-1.5 bg-gradient-to-r from-black/15 via-white/20 to-transparent z-10 pointer-events-none"
              aria-hidden="true"
            />
            {item.coverUrl ? (
              <img
                src={item.coverUrl}
                alt={item.title}
                className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                referrerPolicy="no-referrer"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full p-2 flex flex-col justify-between bg-gradient-to-b from-surface-container-low via-surface-container to-surface-container-high">
                <BookIcon className="w-3.5 h-3.5 text-on-surface-variant/60" />
                <span className="font-serif text-[10px] font-semibold text-primary line-clamp-2 leading-tight">
                  {toTitleCase(item.title)}
                </span>
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2 mb-1">
              <Badge variant={badgeMeta.variant} size="sm">
                {badgeMeta.label}
              </Badge>
              {typeof item.userRating === 'number' && item.userRating > 0 && (
                <span
                  className="inline-flex items-center gap-1 font-mono tabular-nums text-xs font-semibold text-amber-700 dark:text-amber-400 shrink-0"
                  title={`Your rating: ${item.userRating} / 5`}
                >
                  <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                  {item.userRating}/5
                </span>
              )}
            </div>

            <h3 className="font-serif font-semibold text-base leading-snug text-on-surface group-hover:text-primary transition-colors line-clamp-2 tracking-tight">
              {toTitleCase(item.title)}
            </h3>

            <div className="flex items-center gap-1.5 text-xs text-on-surface-variant mt-1 truncate">
              <span className="font-sans font-medium truncate">
                {toTitleCase(item.author || 'Unknown Author')}
              </span>
              {pubYear && (
                <>
                  <span aria-hidden="true" className="text-outline/60 shrink-0">
                    ·
                  </span>
                  <span className="font-mono tabular-nums text-[11px] shrink-0">
                    {pubYear}
                  </span>
                </>
              )}
            </div>

            {/* Unboxed Provenance Metadata */}
            <div className="flex items-center gap-1.5 text-[11px] text-on-surface-variant/85 mt-1.5 truncate">
              <span>
                {item.ownershipStatus === 'unowned' || item.isVirtual
                  ? 'Un-owned'
                  : `In ${toTitleCase(item.libraryName)}`}
              </span>
              {item.primaryGenre && (
                <>
                  <span aria-hidden="true" className="text-outline/60 shrink-0">
                    ·
                  </span>
                  <span className="truncate">{item.primaryGenre}</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Action Footer: Quick Shelf Switcher + View / Review link */}
      <div
        className="flex items-center justify-between gap-2 pt-3 mt-3.5 border-t border-outline-variant/50"
        onClick={e => e.stopPropagation()}
      >
        <Select
          value={item.readingStatus}
          onValueChange={val => {
            void onStatusChange(
              item.libraryId,
              item.id,
              val as TrackedShelfStatus | 'unset',
            );
          }}
        >
          <SelectTrigger
            aria-label={`Change reading status for ${item.title}`}
            className="h-8 text-xs bg-surface-container-low border-outline-variant/60 px-2.5 py-1 min-w-[140px] w-auto"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="want_to_read">Want to Read</SelectItem>
            <SelectItem value="reading">Currently Reading</SelectItem>
            <SelectItem value="finished">Read (Finished)</SelectItem>
            <SelectItem value="abandoned">Abandoned</SelectItem>
            <SelectItem value="unset">Remove from List</SelectItem>
          </SelectContent>
        </Select>

        <button
          type="button"
          onClick={handleNavigate}
          className="text-xs font-sans font-semibold text-primary hover:underline whitespace-nowrap shrink-0 px-2 py-1"
        >
          {item.userRating ? 'Details & Review' : 'Rate & Review'}
        </button>
      </div>
    </article>
  );
}
