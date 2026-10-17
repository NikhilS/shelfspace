import React from 'react';
import {Link} from 'react-router-dom';
import {
  BookOpen,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from 'lucide-react';
import {motion, AnimatePresence} from 'motion/react';
import {Input} from '@/components/ui/input';
import {Book} from '../../types';
import {TimelineCluster, formatYear} from './TimelineControls';

export interface TimelineEpochDrawerProps {
  libraryId: string | undefined;
  selectedCluster: TimelineCluster | null;
  onClose: () => void;
}

export const TimelineDesktopEpochDrawer: React.FC<TimelineEpochDrawerProps> = ({
  libraryId,
  selectedCluster,
  onClose,
}) => {
  return (
    <AnimatePresence>
      {selectedCluster && (
        <motion.aside
          key="desktop-epoch-drawer"
          aria-label={`Selected epoch: ${selectedCluster.label}`}
          initial={{opacity: 0, x: 20}}
          animate={{opacity: 1, x: 0}}
          exit={{opacity: 0, x: 20}}
          className="hidden lg:flex lg:col-span-4 bg-surface-container-low rounded-3xl p-6 border border-outline-variant/60 sticky top-24 max-h-[calc(100vh-120px)] flex-col shadow-xs"
        >
          <div className="flex items-start justify-between gap-4 pb-4 mb-4 border-b border-outline-variant/50">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-[#215a6d] dark:text-[#6ab0c7] font-semibold">
                <span>{formatYear(selectedCluster.key)}</span>
                <span
                  aria-hidden="true"
                  className="text-outline-variant font-normal"
                >
                  ·
                </span>
                <span>
                  {selectedCluster.books.length}{' '}
                  {selectedCluster.books.length === 1 ? 'Volume' : 'Volumes'}
                </span>
              </div>
              <h2 className="text-xl font-serif font-bold text-on-surface mt-1">
                {selectedCluster.label}
              </h2>
              {selectedCluster.maxYear > selectedCluster.minYear && (
                <p className="text-xs font-mono tabular-nums text-on-surface-variant mt-0.5">
                  Chronological Range: {formatYear(selectedCluster.minYear)} –{' '}
                  {formatYear(selectedCluster.maxYear)}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-sans font-semibold text-on-surface-variant hover:text-on-surface px-2.5 py-1.5 rounded-lg border border-outline-variant/50 hover:bg-surface-container transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>

          <div className="overflow-y-auto space-y-3 pr-1 flex-1">
            {selectedCluster.books.map(book => {
              const startY = book.temporalMetadata?.startYear;
              const endY = book.temporalMetadata?.endYear;
              const hasMultiYearSpan =
                startY !== undefined && endY !== undefined && endY > startY;

              return (
                <Link
                  key={book.id}
                  to={`/library/${libraryId}/book/${book.id}`}
                  className="flex gap-3.5 p-3.5 rounded-2xl bg-background/70 hover:bg-surface-container transition-all border border-outline-variant/40 hover:border-[#2d6d82]/45 group"
                >
                  {book.coverUrl ? (
                    <img
                      src={book.coverUrl}
                      alt={book.title}
                      className="w-14 h-20 object-cover rounded-lg shadow-2xs shrink-0 bg-surface-container"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-14 h-20 rounded-lg bg-surface-container-high flex items-center justify-center text-outline shrink-0 border border-outline-variant/40">
                      <BookOpen className="w-5 h-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-sm font-serif font-semibold text-on-surface group-hover:text-[#215a6d] dark:group-hover:text-[#6ab0c7] transition-colors line-clamp-1">
                        {book.title}
                      </h4>
                      <ArrowUpRight className="w-3.5 h-3.5 text-on-surface-variant group-hover:text-[#215a6d] dark:group-hover:text-[#6ab0c7] shrink-0 mt-0.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </div>
                    <p className="text-xs text-on-surface-variant line-clamp-1 mt-0.5">
                      {book.author || 'Unknown Author'}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono tabular-nums text-on-surface-variant">
                      {startY !== undefined && (
                        <span className="font-semibold text-[#215a6d] dark:text-[#6ab0c7]">
                          {hasMultiYearSpan
                            ? `${formatYear(startY)} – ${formatYear(endY)}`
                            : formatYear(startY)}
                        </span>
                      )}
                      {hasMultiYearSpan && (
                        <>
                          <span
                            aria-hidden="true"
                            className="text-outline-variant"
                          >
                            ·
                          </span>
                          <span>{endY - startY} yr span</span>
                        </>
                      )}
                      {book.temporalMetadata?.eraName && (
                        <>
                          <span
                            aria-hidden="true"
                            className="text-outline-variant"
                          >
                            ·
                          </span>
                          <span className="font-sans truncate">
                            {book.temporalMetadata.eraName}
                          </span>
                        </>
                      )}
                    </div>

                    {book.temporalMetadata?.rationale && (
                      <p className="text-xs text-on-surface-variant/90 line-clamp-2 mt-2 leading-relaxed">
                        {book.temporalMetadata.rationale}
                      </p>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};

export const TimelineMobileEpochSheet: React.FC<TimelineEpochDrawerProps> = ({
  libraryId,
  selectedCluster,
  onClose,
}) => {
  return (
    <AnimatePresence>
      {selectedCluster && (
        <div className="lg:hidden fixed inset-0 z-50 flex flex-col justify-end">
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            onClick={onClose}
            className="absolute inset-0 bg-black/45 backdrop-blur-[1px]"
            aria-hidden="true"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`Epoch books: ${selectedCluster.label}`}
            initial={{y: '100%'}}
            animate={{y: 0}}
            exit={{y: '100%'}}
            transition={{type: 'spring', damping: 28, stiffness: 280}}
            className="relative z-10 w-full max-h-[80vh] bg-surface-container-low border-t border-outline-variant/60 rounded-t-3xl p-5 flex flex-col shadow-2xl"
          >
            <div className="w-10 h-1.5 rounded-full bg-outline-variant/60 mx-auto mb-3 shrink-0" />

            <div className="flex items-start justify-between gap-4 pb-3.5 mb-3.5 border-b border-outline-variant/50 shrink-0">
              <div>
                <div className="flex items-center gap-1.5 text-xs font-mono tabular-nums text-[#215a6d] dark:text-[#6ab0c7] font-semibold">
                  <span>{formatYear(selectedCluster.key)}</span>
                  <span
                    aria-hidden="true"
                    className="text-outline-variant font-normal"
                  >
                    ·
                  </span>
                  <span>
                    {selectedCluster.books.length}{' '}
                    {selectedCluster.books.length === 1 ? 'Volume' : 'Volumes'}
                  </span>
                </div>
                <h2 className="text-lg font-serif font-bold text-on-surface mt-0.5">
                  {selectedCluster.label}
                </h2>
                {selectedCluster.maxYear > selectedCluster.minYear && (
                  <p className="text-xs font-mono tabular-nums text-on-surface-variant mt-0.5">
                    Span: {formatYear(selectedCluster.minYear)} –{' '}
                    {formatYear(selectedCluster.maxYear)}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close epoch sheet"
                className="p-2 rounded-lg border border-outline-variant/50 text-on-surface-variant hover:text-on-surface hover:bg-surface-container cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto space-y-2.5 pr-1 flex-1 pb-4">
              {selectedCluster.books.map(book => {
                const startY = book.temporalMetadata?.startYear;
                const endY = book.temporalMetadata?.endYear;
                const hasMultiYearSpan =
                  startY !== undefined && endY !== undefined && endY > startY;

                return (
                  <Link
                    key={`sheet-${book.id}`}
                    to={`/library/${libraryId}/book/${book.id}`}
                    className="flex gap-3 p-3 rounded-2xl bg-background/80 hover:bg-surface-container transition-all border border-outline-variant/40 group"
                  >
                    {book.coverUrl ? (
                      <img
                        src={book.coverUrl}
                        alt={book.title}
                        className="w-12 h-18 object-cover rounded-lg shadow-2xs shrink-0 bg-surface-container"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-12 h-18 rounded-lg bg-surface-container-high flex items-center justify-center text-outline shrink-0 border border-outline-variant/40">
                        <BookOpen className="w-4 h-4" />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-serif font-semibold text-on-surface group-hover:text-[#215a6d] dark:group-hover:text-[#6ab0c7] transition-colors line-clamp-1">
                          {book.title}
                        </h4>
                        <ArrowUpRight className="w-3.5 h-3.5 text-on-surface-variant shrink-0 mt-0.5" />
                      </div>
                      <p className="text-xs text-on-surface-variant line-clamp-1 mt-0.5">
                        {book.author || 'Unknown Author'}
                      </p>
                      {startY !== undefined && (
                        <div className="mt-1.5 text-[11px] font-mono tabular-nums font-semibold text-[#215a6d] dark:text-[#6ab0c7]">
                          {hasMultiYearSpan
                            ? `${formatYear(startY)} – ${formatYear(endY)} (${endY - startY} yrs)`
                            : formatYear(startY)}
                        </div>
                      )}
                      {book.temporalMetadata?.rationale && (
                        <p className="text-xs text-on-surface-variant/90 line-clamp-2 mt-1 leading-relaxed">
                          {book.temporalMetadata.rationale}
                        </p>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};

export interface TimelineNonHistoricalAnnexProps {
  libraryId: string | undefined;
  nonHistoricalBooks: Book[];
  filteredNonHistorical: Book[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
}

export const TimelineNonHistoricalAnnex: React.FC<
  TimelineNonHistoricalAnnexProps
> = ({
  libraryId,
  nonHistoricalBooks,
  filteredNonHistorical,
  isCollapsed,
  onToggleCollapse,
  searchQuery,
  onSearchQueryChange,
}) => {
  if (nonHistoricalBooks.length === 0) return null;

  return (
    <div className="mt-10 bg-surface-container-low rounded-3xl p-6 border border-outline-variant/50">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="flex items-center gap-3 text-left cursor-pointer group"
        >
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-serif font-bold text-on-surface group-hover:text-[#215a6d] dark:group-hover:text-[#6ab0c7] transition-colors">
                Non-Historical &amp; Timeless Works Annex
              </h2>
              <span className="text-xs font-mono tabular-nums text-on-surface-variant">
                ({nonHistoricalBooks.length}{' '}
                {nonHistoricalBooks.length === 1 ? 'volume' : 'volumes'})
              </span>
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Philosophy, speculative fiction, theory, and works outside a fixed
              terrestrial era
            </p>
          </div>
          <span className="p-1.5 rounded-lg border border-outline-variant/40 text-on-surface-variant group-hover:text-on-surface">
            {isCollapsed ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </span>
        </button>

        {!isCollapsed && (
          <div className="relative w-full sm:w-72">
            <Search className="w-4 h-4 text-on-surface-variant absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none z-10" />
            <Input
              type="text"
              placeholder="Filter timeless works..."
              value={searchQuery}
              onChange={e => onSearchQueryChange(e.target.value)}
              className="pl-9 pr-4 text-xs h-9 bg-background border-outline-variant/60 rounded-xl"
            />
          </div>
        )}
      </div>

      {!isCollapsed && (
        <div className="mt-6 pt-5 border-t border-outline-variant/40">
          {filteredNonHistorical.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredNonHistorical.map(book => (
                <Link
                  key={book.id}
                  to={`/library/${libraryId}/book/${book.id}`}
                  className="flex gap-3 p-3 rounded-2xl bg-background/60 border border-outline-variant/40 hover:border-[#2d6d82]/40 hover:bg-surface-container transition-all group"
                >
                  {book.coverUrl ? (
                    <img
                      src={book.coverUrl}
                      alt={book.title}
                      className="w-12 h-16 object-cover rounded-lg shadow-2xs shrink-0 bg-surface-container"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-12 h-16 rounded-lg bg-surface-container-high flex items-center justify-center text-outline shrink-0">
                      <BookOpen className="w-4 h-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="text-xs font-serif font-semibold text-on-surface group-hover:text-[#215a6d] dark:group-hover:text-[#6ab0c7] transition-colors line-clamp-1">
                      {book.title}
                    </h4>
                    <p className="text-[11px] text-on-surface-variant line-clamp-1 mt-0.5">
                      {book.author || 'Unknown Author'}
                    </p>
                    {book.temporalMetadata?.rationale && (
                      <p className="text-[10px] text-on-surface-variant/80 line-clamp-2 mt-1.5 leading-relaxed">
                        {book.temporalMetadata.rationale}
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-center py-8 text-xs text-on-surface-variant">
              No timeless works match &ldquo;{searchQuery}&rdquo;.
            </p>
          )}
        </div>
      )}
    </div>
  );
};
