import React from 'react';
import {MapPin, ChevronRight, BookOpen, X} from 'lucide-react';
import {Badge} from '@/components/ui/badge';
import {CartographyCompassIllustration} from '@/components/ui/empty-state-illustrations';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';
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
  return (
    <div className="lg:col-span-4 space-y-4">
      {/* Context/Selected Location info Panel */}
      <div
        className="bg-surface-container border border-outline-variant rounded-3xl p-5 shadow-sm min-h-[300px] flex flex-col justify-between"
        id="literary-context-panel"
      >
        {selectedCluster ? (
          <div className="space-y-4 flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-on-surface flex items-center gap-2">
                  <MapPin className="text-primary w-5 h-5 flex-shrink-0" />
                  {selectedSinglePin
                    ? selectedSinglePin.name
                    : 'Geographical Cluster'}
                </h3>
                <p className="text-xs text-on-surface-variant font-medium mt-1">
                  Contains{' '}
                  {new Set(selectedCluster.pins.map(p => p.book.id)).size}{' '}
                  unique book
                  {new Set(selectedCluster.pins.map(p => p.book.id)).size !== 1
                    ? 's'
                    : ''}{' '}
                  ({selectedCluster.pins.length} distinct setting reference
                  {selectedCluster.pins.length !== 1 ? 's' : ''})
                </p>
              </div>
              <button
                onClick={onClearSelection}
                className="p-1 hover:bg-surface-variant/50 rounded-full transition"
              >
                <X size={16} />
              </button>
            </div>

            {/* List of book settings within this cluster */}
            <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-1">
              {selectedCluster.pins.map((pin, i) => (
                <div
                  key={i}
                  className="bg-surface/50 border border-outline-variant/60 rounded-2xl p-3.5 space-y-3 hover:border-primary/50 transition cursor-pointer"
                  onClick={() =>
                    onNavigateToBook(pin.book.id, pin.book.libraryId)
                  }
                >
                  <div className="flex gap-3">
                    {pin.book.coverUrl ? (
                      <img
                        src={pin.book.coverUrl}
                        alt={pin.book.title}
                        className="w-12 h-16 object-cover rounded-lg shadow-sm bg-surface-container flex-shrink-0"
                        referrerPolicy="no-referrer"
                        loading="lazy"
                      />
                    ) : (
                      <MonographCoverFallback
                        title={pin.book.title}
                        author={pin.book.author}
                        variant="micro"
                        className="w-12 h-16 rounded-lg flex-shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <h4 className="text-sm font-bold text-on-surface leading-tight truncate">
                        {pin.book.title}
                      </h4>
                      <p className="text-xs text-on-surface-variant truncate mt-0.5">
                        by {pin.book.author || 'Unknown'}
                      </p>
                      <div className="mt-2">
                        <Badge
                          variant="status-read"
                          size="sm"
                          className="uppercase tracking-wider font-label-caps-xs text-label-caps-xs"
                        >
                          {pin.adminLevel}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  {pin.rationale && (
                    <div className="bg-neutral-50/70 border-l-2 border-stone-300 pl-2.5 py-1 text-xs text-stone-600 italic leading-relaxed">
                      &ldquo;{pin.rationale}&rdquo;
                    </div>
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
              <p className="text-xs text-on-surface-variant max-w-xs mx-auto leading-relaxed mt-1">
                Select any pin or cluster on the map to see the books set there
                and why that place matters to the story.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Non-Earth Archive accordion block */}
      <div
        className="bg-surface-container border border-outline-variant rounded-2xl overflow-hidden shadow-sm"
        id="non-earth-archive"
      >
        <button
          onClick={onToggleNonEarthExpanded}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-surface-variant/20 transition"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="text-amber-600 w-5 h-5" />
            <span className="text-sm font-bold text-on-surface">
              Non-Earth Archive ({nonEarthBooks.length})
            </span>
          </div>
          <ChevronRight
            size={16}
            className={`text-on-surface-variant transition-transform duration-300 ${isNonEarthExpanded ? 'rotate-90' : ''}`}
          />
        </button>

        {isNonEarthExpanded && (
          <div className="px-5 pb-5 border-t border-outline-variant bg-surface/30">
            {nonEarthBooks.length === 0 ? (
              <p className="text-xs text-on-surface-variant py-3 italic">
                No fictional or otherworldly settings on this shelf yet.
              </p>
            ) : (
              <div className="space-y-2 mt-3.5 max-h-[220px] overflow-y-auto pr-1">
                {nonEarthBooks.map(b => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between text-xs py-2 px-3 bg-surface/50 border rounded-xl hover:border-primary/50 cursor-pointer transition"
                    onClick={() => onNavigateToBook(b.id, b.libraryId)}
                  >
                    <div className="min-w-0 pr-2">
                      <p className="font-bold text-on-surface truncate leading-tight">
                        {b.title}
                      </p>
                      <p className="text-on-surface-variant truncate mt-0.5">
                        by {b.author || 'Unknown'}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      size="sm"
                      className="font-label-caps-xs text-label-caps-xs font-semibold tracking-wide whitespace-nowrap bg-stone-100 text-stone-600 border-stone-200"
                    >
                      Fictional / Sci-Fi
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
