import React from 'react';
import {MapPin, ChevronRight, BookOpen, X} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {CartographyCompassIllustration} from '@/components/ui/empty-state-illustrations';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';
import {toTitleCase} from '../../lib/utils';
import {Book} from '../../types';
import {FlattenedLocationPin, MapCluster} from './types';

interface WorldMapInspectorProps {
  selectedCluster: MapCluster | null;
  selectedSinglePin: FlattenedLocationPin | null;
  nonEarthBooks: Book[];
  isNonEarthExpanded: boolean;
  onToggleNonEarthExpanded: () => void;
  onClearSelection: () => void;
  onNavigateToBook: (bookId: string, bookLibraryId?: string) => void;
}

export function WorldMapInspector({
  selectedCluster,
  selectedSinglePin,
  nonEarthBooks,
  isNonEarthExpanded,
  onToggleNonEarthExpanded,
  onClearSelection,
  onNavigateToBook,
}: WorldMapInspectorProps) {
  const uniqueBookCount = selectedCluster
    ? new Set(selectedCluster.pins.map(p => p.book.id)).size
    : 0;

  return (
    <div className="lg:col-span-4 space-y-4">
      {/* Context / Selected Location Inspector Panel */}
      <div
        className="bento-card p-5 min-h-[300px] flex flex-col justify-between"
        id="literary-context-panel"
      >
        {selectedCluster ? (
          <div className="space-y-4 flex-1">
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-outline-variant/50">
              <div className="min-w-0">
                <span className="metadata-eyebrow block mb-1">
                  Selected Place
                </span>
                <h3 className="font-serif text-lg font-semibold text-on-surface flex items-center gap-2">
                  <MapPin className="text-tertiary w-4 h-4 flex-shrink-0" />
                  <span className="truncate">
                    {selectedSinglePin
                      ? selectedSinglePin.name
                      : 'Geographical Cluster'}
                  </span>
                </h3>
                <p className="text-xs text-on-surface-variant font-sans mt-1">
                  <span className="font-mono tabular-nums font-semibold text-on-surface">
                    {uniqueBookCount}
                  </span>{' '}
                  {uniqueBookCount === 1 ? 'book' : 'books'} &middot;{' '}
                  <span className="font-mono tabular-nums">
                    {selectedCluster.pins.length}
                  </span>{' '}
                  setting{' '}
                  {selectedCluster.pins.length === 1
                    ? 'reference'
                    : 'references'}
                </p>
              </div>
              <button
                type="button"
                aria-label="Clear selected location"
                onClick={onClearSelection}
                className="p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors cursor-pointer shrink-0"
              >
                <X size={16} />
              </button>
            </div>

            {/* List of book settings within this cluster */}
            <div className="divide-y divide-outline-variant/50 max-h-[360px] overflow-y-auto pr-1">
              {selectedCluster.pins.map((pin, i) => (
                <div
                  key={`${pin.book.id}-${pin.name}-${i}`}
                  className="py-3.5 first:pt-0 last:pb-0 space-y-2.5 group cursor-pointer"
                  onClick={() =>
                    onNavigateToBook(pin.book.id, pin.book.libraryId)
                  }
                >
                  <div className="flex gap-3 items-start">
                    {pin.book.coverUrl ? (
                      <img
                        src={pin.book.coverUrl}
                        alt={pin.book.title}
                        className="w-12 h-18 object-cover rounded-md book-cover-shadow border border-outline-variant/50 bg-surface-container flex-shrink-0"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    ) : (
                      <MonographCoverFallback
                        title={pin.book.title}
                        author={pin.book.author}
                        variant="micro"
                        className="w-12 h-18 rounded-md flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <h4 className="font-serif text-sm font-semibold text-on-surface group-hover:text-primary leading-snug truncate transition-colors">
                        {toTitleCase(pin.book.title)}
                      </h4>
                      <p className="font-sans text-xs text-on-surface-variant truncate mt-0.5">
                        by {toTitleCase(pin.book.author || 'Unknown')}
                      </p>
                      <div className="mt-2 flex items-center gap-1.5">
                        <Badge
                          variant="outline"
                          size="sm"
                          className="uppercase tracking-wider text-[10px] font-semibold bg-tertiary/10 text-tertiary border-tertiary/25"
                        >
                          {pin.adminLevel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {pin.rationale && (
                    <p className="pt-2 border-t border-outline-variant/40 font-sans text-xs text-on-surface-variant leading-relaxed">
                      &ldquo;{pin.rationale}&rdquo;
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="text-center py-12 px-4 my-auto space-y-3"
            id="map-selection-placeholder"
          >
            <CartographyCompassIllustration className="mx-auto" />
            <div>
              <h3 className="font-serif text-base font-semibold text-on-surface">
                Explore a Place on the Map
              </h3>
              <p className="font-sans text-xs text-on-surface-variant max-w-xs mx-auto leading-relaxed mt-1">
                Select any pin or cluster on the map to see the books set there
                and why that place matters to the story.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Non-Earth Archive accordion block */}
      <div className="bento-card overflow-hidden" id="non-earth-archive">
        <button
          type="button"
          onClick={onToggleNonEarthExpanded}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-container-low transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <BookOpen className="text-tertiary w-4 h-4 shrink-0" />
            <span className="font-serif text-sm font-semibold text-on-surface">
              Non-Earth Archive
            </span>
            <span className="font-mono tabular-nums text-xs text-on-surface-variant">
              ({nonEarthBooks.length})
            </span>
          </div>
          <ChevronRight
            size={16}
            className={`text-on-surface-variant transition-transform duration-200 ${isNonEarthExpanded ? 'rotate-90' : ''}`}
          />
        </button>

        {isNonEarthExpanded && (
          <div className="px-5 pb-4 border-t border-outline-variant/50 bg-surface-container-low/40">
            {nonEarthBooks.length === 0 ? (
              <p className="font-sans text-xs text-on-surface-variant py-3 italic">
                No fictional or otherworldly settings on this shelf yet.
              </p>
            ) : (
              <div className="divide-y divide-outline-variant/45 pt-1 max-h-[220px] overflow-y-auto pr-1">
                {nonEarthBooks.map(b => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between gap-3 text-xs py-2.5 cursor-pointer group"
                    onClick={() => onNavigateToBook(b.id, b.libraryId)}
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-serif font-semibold text-sm text-on-surface group-hover:text-primary truncate leading-tight transition-colors">
                        {toTitleCase(b.title)}
                      </p>
                      <p className="font-sans text-on-surface-variant truncate mt-0.5">
                        by {toTitleCase(b.author || 'Unknown')}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      size="sm"
                      className="text-[10px] font-semibold tracking-wider uppercase whitespace-nowrap bg-surface-container text-on-surface-variant border-outline-variant/60 shrink-0"
                    >
                      Fictional
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
