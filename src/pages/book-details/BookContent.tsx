import {AnimatePresence} from 'motion/react';
import React, {useState, useEffect, useMemo} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {useAuth} from '../../stores/authStore';
import {useAppPermissions} from '../../hooks/useAppPermissions';
import {toast} from 'sonner';
import Markdown from 'react-markdown';
import {cn, toTitleCase} from '../../lib/utils';
import {Badge} from '@/components/ui/badge';
import {Button} from '@/components/ui/button';
import {
  Loader2,
  Book as BookIcon,
  User,
  Sparkles,
  Globe,
  Compass,
  MapPin,
  Clock,
  ChevronDown,
} from 'lucide-react';
import {ReviewSection} from './ReviewSection';
import {EditBookForm} from './EditBookForm';
import {useBook} from './useBook';
import {BookHeader} from './BookHeader';
import {ReadingStatusSelect} from './ReadingStatusSelect';
import {AiInsightsPanel} from './AiInsightsPanel';
import {useBookInsights} from './useBookInsights';
import {useDebug} from '../../stores/debugStore';

const formatYear = (year: number) => {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
};

interface BookContentProps {
  libraryId: string;
  bookId: string;
  isActive: boolean;
  onNavigateBack: () => void;
  canEdit: boolean;
}

export function BookContent({
  libraryId,
  bookId,
  isActive,
  onNavigateBack,
  canEdit: passedCanEdit,
}: BookContentProps) {
  const navigate = useNavigate();
  const {user} = useAuth();
  const {hasAiPlan} = useAppPermissions();

  const {
    book,
    bookBase,
    bookDetails,
    reviews,
    isLoading,
    canEdit,
    deleteBook,
    updateReadingStatus,
    addReview,
    updateBook,
    updateBookOptimistically,
    setReviewsOptimistically,
  } = useBook(libraryId, bookId, passedCanEdit, isActive);

  const {
    activeInsight,
    insightContent,
    isGeneratingInsight,
    isEnrichingSynopsis,
    isEnrichingBio,
    triggerManualEnrichment,
    handleGenerateInsight,
  } = useBookInsights(libraryId, book, canEdit);

  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isSynopsisExpanded, setIsSynopsisExpanded] = useState(false);
  const [isBioExpanded, setIsBioExpanded] = useState(false);

  // Filter huge payloads for DebugOverlay (only if active)
  const debugData = useMemo(() => {
    if (!isActive || !bookBase) return null;
    const base = {...bookBase};
    const details: Record<string, unknown> = bookDetails
      ? {...bookDetails}
      : {};

    if (bookDetails?.embedding)
      details.embedding = `[Vector array - ${bookDetails.embedding.length} dimensions]`;
    if (bookDetails?.synopsis)
      details.synopsis = `[Present: ${bookDetails.synopsis.length} chars]`;
    if (bookDetails?.authorBio)
      details.authorBio = `[Present: ${bookDetails.authorBio.length} chars]`;

    return {bookBase: base, bookDetails: details};
  }, [isActive, bookBase, bookDetails]);

  const {setDebugData} = useDebug();
  const location = useLocation();

  useEffect(() => {
    if (isActive && debugData) {
      const timer = setTimeout(() => {
        setDebugData(debugData, 'Book Docs');
      }, 50);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [debugData, setDebugData, isActive, location.pathname]);

  const handleDeleteBook = async () => {
    if (!book || !libraryId || !canEdit) return;
    try {
      await deleteBook();
      toast.success('Book deleted');
      onNavigateBack();
    } catch {
      toast.error('Failed to delete book');
      throw new Error('Failed to delete book');
    }
  };

  const startEditing = () => {
    setIsEditingDetails(true);
  };

  if (isLoading) {
    return (
      <div className="layout-page-content h-full">
        <div className="absolute inset-0 bg-surface-variant/20 animate-pulse pointer-events-none" />
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 relative z-10">
          <div className="md:col-span-4 flex flex-col gap-6">
            <div className="aspect-[2/3] w-full bg-surface-variant/40 animate-pulse rounded-lg"></div>
            <div className="h-10 bg-surface-variant/40 animate-pulse rounded"></div>
            <div className="h-10 bg-surface-variant/40 animate-pulse rounded"></div>
          </div>
          <div className="md:col-span-8 flex flex-col gap-8">
            <div>
              <div className="h-12 bg-surface-variant/40 animate-pulse rounded w-3/4 mb-4"></div>
              <div className="h-6 bg-surface-variant/40 animate-pulse rounded w-1/2 mb-8"></div>
              <div className="flex gap-2">
                <div className="w-16 h-6 bg-surface-variant/40 animate-pulse rounded"></div>
                <div className="w-16 h-6 bg-surface-variant/40 animate-pulse rounded"></div>
              </div>
            </div>
            <div className="h-48 bg-surface-variant/40 animate-pulse rounded-lg"></div>
            <div className="h-32 bg-surface-variant/40 animate-pulse rounded-lg"></div>
          </div>
        </div>
      </div>
    );
  }

  if (!book)
    return <div className="layout-page-content h-full">Book not found</div>;

  return (
    <div className="layout-page-content h-full overflow-y-auto">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 items-start">
        {/* Left Column: Edition Showcase & Archival Accession Ledger */}
        <div className="md:col-span-4 md:sticky md:top-24 flex flex-col gap-5 items-center md:items-stretch">
          <div className="aspect-[2/3] w-3/4 max-w-[240px] md:w-full md:max-w-none mx-auto bg-surface-container rounded-xl overflow-hidden book-cover-shadow border border-outline-variant/60 relative flex-shrink-0">
            {/* Subtle book spine crease */}
            <div
              className="absolute inset-y-0 left-0 w-3 bg-gradient-to-r from-black/20 via-white/20 to-transparent z-10 pointer-events-none"
              aria-hidden="true"
            />
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="absolute inset-0 bg-gradient-to-b from-surface-container-low via-surface-container to-surface-container-high p-6 flex flex-col justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-on-surface-variant">
                  Archival Edition
                </span>
                <div className="my-auto space-y-2">
                  <p className="font-serif text-xl font-semibold text-primary leading-snug">
                    {toTitleCase(book.title)}
                  </p>
                  <p className="font-sans text-xs uppercase tracking-wider text-on-surface-variant">
                    {toTitleCase(book.author)}
                  </p>
                </div>
                <BookIcon className="w-6 h-6 text-primary/40" />
              </div>
            )}
            {/* Status Badge */}
            {book.userStatuses?.[user?.uid || ''] &&
              book.userStatuses?.[user?.uid || ''] !== 'unset' && (
                <div className="absolute top-3.5 right-3.5 shadow-xs swiper-no-swiping z-20">
                  <Badge
                    variant={
                      book.userStatuses[user?.uid || ''] === 'want_to_read'
                        ? 'status-to-read'
                        : book.userStatuses[user?.uid || ''] === 'reading'
                          ? 'status-reading'
                          : book.userStatuses[user?.uid || ''] === 'finished' ||
                              book.userStatuses[user?.uid || ''] === 'completed'
                            ? 'status-read'
                            : 'status-abandoned'
                    }
                  >
                    {book.userStatuses[user?.uid || ''] === 'want_to_read'
                      ? 'WANT TO READ'
                      : book.userStatuses[user?.uid || ''] === 'reading'
                        ? 'READING'
                        : book.userStatuses[user?.uid || ''] === 'finished' ||
                            book.userStatuses[user?.uid || ''] === 'completed'
                          ? 'FINISHED'
                          : 'ABANDONED'}
                  </Badge>
                </div>
              )}
          </div>

          {/* Archival Accession Ledger */}
          <dl className="bento-card p-4 w-full divide-y divide-outline-variant/50 text-xs font-sans">
            <div className="py-2 first:pt-0 flex items-center justify-between gap-3">
              <dt className="metadata-eyebrow">Collection</dt>
              <dd className="font-medium text-on-surface text-right">
                {libraryId.startsWith('virtual_') ||
                book.ownershipStatus === 'unowned'
                  ? 'Un-owned'
                  : 'Owned Library'}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="metadata-eyebrow">Publication</dt>
              <dd className="font-mono tabular-nums font-medium text-on-surface text-right">
                {book.publishedDate || 'Unknown'}
              </dd>
            </div>
            <div className="py-2 flex items-center justify-between gap-3">
              <dt className="metadata-eyebrow">Format</dt>
              <dd className="capitalize font-medium text-on-surface text-right">
                {book.format || 'Physical'}
              </dd>
            </div>
            <div className="py-2 last:pb-0 flex items-center justify-between gap-3">
              <dt className="metadata-eyebrow">ISBN</dt>
              <dd className="font-mono tabular-nums font-medium text-on-surface text-right truncate max-w-[160px]">
                {book.isbn || 'Unassigned'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Right Column: Magazine Literary Spread */}
        <div className="md:col-span-8 flex flex-col gap-6 sm:gap-8 min-w-0">
          <BookHeader
            book={book}
            canEdit={canEdit}
            onEdit={startEditing}
            libraryId={libraryId}
          />

          <ReadingStatusSelect
            libraryId={libraryId}
            bookId={bookId}
            book={book}
            bookBase={bookBase}
            bookDetails={bookDetails}
            canEdit={canEdit}
            updateBookOptimistically={updateBookOptimistically}
            updateReadingStatus={updateReadingStatus}
          />

          {/* Editorial Synopsis Spread */}
          <section className="bento-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-4 mb-3.5">
              <h3 className="font-serif text-xl font-semibold text-primary">
                Synopsis
              </h3>
              {!book.synopsis && canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isEnrichingSynopsis}
                  onClick={() => void triggerManualEnrichment('synopsis')}
                  className="gap-1.5 swiper-no-swiping text-xs h-8 px-3"
                >
                  {isEnrichingSynopsis ? (
                    <>
                      <Loader2 className="animate-spin w-3.5 h-3.5" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      <span>
                        {hasAiPlan ? 'Generate Synopsis' : 'Fetch Synopsis'}
                      </span>
                    </>
                  )}
                </Button>
              )}
            </div>
            <div>
              {book.synopsis ? (
                <div className="relative">
                  <div
                    className={cn(
                      'text-sm sm:text-[15.5px] text-on-surface/90 font-sans leading-relaxed max-w-[70ch] transition-all duration-200',
                      book.synopsis.length > 400 &&
                        !isSynopsisExpanded &&
                        'max-h-48 overflow-hidden',
                    )}
                  >
                    <div className="markdown-body editorial-dropcap">
                      <Markdown>{book.synopsis}</Markdown>
                    </div>
                  </div>
                  {book.synopsis.length > 400 && !isSynopsisExpanded && (
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-surface via-surface/85 to-transparent pointer-events-none" />
                  )}
                  {book.synopsis.length > 400 && (
                    <button
                      type="button"
                      onClick={() => setIsSynopsisExpanded(!isSynopsisExpanded)}
                      className="mt-2.5 text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1.5 transition-colors cursor-pointer py-1"
                    >
                      {isSynopsisExpanded ? 'Show less' : 'Read full synopsis'}
                      <ChevronDown
                        className={cn(
                          'w-3.5 h-3.5 transition-transform duration-200',
                          isSynopsisExpanded && 'rotate-180',
                        )}
                      />
                    </button>
                  )}
                </div>
              ) : isEnrichingSynopsis ||
                book.enrichmentStatus?.synopsis === 'in_progress' ? (
                <div className="flex items-center gap-2 text-on-surface-variant font-sans text-sm">
                  <Loader2 className="animate-spin" size={16} /> Fetching
                  synopsis...
                </div>
              ) : (
                <p className="text-on-surface-variant/80 font-sans text-sm italic">
                  No synopsis available for this title.
                </p>
              )}
            </div>

            {(book.primaryGenre ||
              (book.subgenres && book.subgenres.length > 0)) && (
              <div className="mt-5 pt-3.5 border-t border-outline-variant/50 flex items-center flex-wrap gap-2 swiper-no-swiping">
                <span className="metadata-eyebrow mr-1">
                  Genre & Subgenres:
                </span>
                {book.primaryGenre && (
                  <Badge
                    variant="genre"
                    onClick={() =>
                      void navigate(
                        `/library/${libraryId}/collection?genre=${encodeURIComponent(book.primaryGenre!)}`,
                      )
                    }
                    className="cursor-pointer swiper-no-swiping"
                    title={`Filter library by ${book.primaryGenre}`}
                  >
                    {book.primaryGenre}
                  </Badge>
                )}
                {book.subgenres?.map((sg, idx) => (
                  <Badge
                    key={idx}
                    variant="subgenre"
                    onClick={() =>
                      void navigate(
                        `/library/${libraryId}/collection?genre=${encodeURIComponent(book.primaryGenre || '')}&subgenre=${encodeURIComponent(sg)}`,
                      )
                    }
                    className="cursor-pointer swiper-no-swiping"
                    title={`Filter library by ${sg}`}
                  >
                    {sg}
                  </Badge>
                ))}
              </div>
            )}
          </section>

          {/* Narrative Setting Split-Row (Where & When) */}
          {(book.geoMetadata || book.temporalMetadata) && (
            <div
              className={cn(
                'grid gap-4',
                book.geoMetadata && book.temporalMetadata
                  ? 'grid-cols-1 lg:grid-cols-2'
                  : 'grid-cols-1',
              )}
            >
              {/* Literary Setting Card */}
              {book.geoMetadata && (
                <section className="bento-card p-5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center shrink-0 border border-outline-variant/50">
                          <Globe className="w-4 h-4 text-primary" />
                        </div>
                        <h3 className="font-serif font-semibold text-base sm:text-lg text-primary truncate">
                          Literary Setting
                        </h3>
                      </div>
                      {book.geoMetadata.isNonEarth && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="font-label-caps-xs text-[10px] uppercase tracking-wider shrink-0"
                        >
                          Fictional
                        </Badge>
                      )}
                    </div>

                    {book.geoMetadata.isNonEarth ? (
                      <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-surface-container-low border border-outline-variant/50">
                        <Compass className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-xs sm:text-sm text-on-surface">
                            Fictional / Non-Earth Realm
                          </h4>
                          <p className="font-body-xs text-xs text-on-surface-variant mt-1 leading-relaxed">
                            Set in an imagined, fantasy, or non-earth universe.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {book.geoMetadata.locations &&
                        book.geoMetadata.locations.length > 0 ? (
                          book.geoMetadata.locations.map((loc, idx) => {
                            const getAdminBadgeClass = (level: string) => {
                              switch (level?.toLowerCase()) {
                                case 'city':
                                  return 'bg-primary/10 text-primary border-primary/20';
                                case 'country':
                                  return 'bg-tertiary/10 text-tertiary border-tertiary/20';
                                default:
                                  return 'bg-surface-container text-on-surface border-outline-variant/50';
                              }
                            };
                            return (
                              <div
                                key={idx}
                                className="p-3 rounded-lg border border-outline-variant/50 bg-surface-container-low/60 flex flex-col justify-between"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-sans font-semibold text-xs sm:text-sm text-on-surface flex items-center gap-1.5 truncate">
                                    <MapPin className="w-3.5 h-3.5 text-primary shrink-0" />
                                    {loc.name}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    size="sm"
                                    className={`text-[10px] font-bold tracking-wider uppercase shrink-0 ${getAdminBadgeClass(
                                      loc.adminLevel,
                                    )}`}
                                  >
                                    {loc.adminLevel}
                                  </Badge>
                                </div>
                                {loc.rationale && (
                                  <p className="font-body-xs text-xs text-on-surface-variant mt-1.5 leading-relaxed line-clamp-2">
                                    {loc.rationale}
                                  </p>
                                )}
                              </div>
                            );
                          })
                        ) : (
                          <p className="font-body-xs text-xs text-on-surface-variant italic py-2">
                            No specific geographical locations mapped yet.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}

              {/* Temporal Setting Card */}
              {book.temporalMetadata && (
                <section
                  id="book-temporal-setting-section"
                  className="bento-card p-5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3.5">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-surface-container flex items-center justify-center shrink-0 border border-outline-variant/50">
                          <Clock className="w-4 h-4 text-primary" />
                        </div>
                        <h3 className="font-serif font-semibold text-base sm:text-lg text-primary truncate">
                          Temporal Setting
                        </h3>
                      </div>
                      {book.temporalMetadata.isNonHistorical && (
                        <Badge
                          variant="outline"
                          size="sm"
                          className="font-label-caps-xs text-[10px] uppercase tracking-wider shrink-0"
                        >
                          Contemporary
                        </Badge>
                      )}
                    </div>

                    {book.temporalMetadata.isNonHistorical ? (
                      <div
                        id="temporal-non-historical-badge"
                        className="flex items-start gap-2.5 p-3.5 rounded-lg bg-surface-container-low border border-outline-variant/50"
                      >
                        <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-semibold text-xs sm:text-sm text-on-surface">
                            Contemporary Era
                          </h4>
                          <p className="font-body-xs text-xs text-on-surface-variant mt-1 leading-relaxed">
                            Set in contemporary/modern times without a specific
                            historical era.
                          </p>
                          {book.temporalMetadata.rationale && (
                            <p className="font-body-xs text-xs text-on-surface-variant/85 italic mt-2 pt-2 border-t border-outline-variant/40 leading-relaxed line-clamp-2">
                              &ldquo;{book.temporalMetadata.rationale}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        id="temporal-historical-details"
                        className="p-3.5 rounded-lg border border-outline-variant/50 bg-surface-container-low/60 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {(book.temporalMetadata.eraName ||
                            book.temporalMetadata.eraLabel) && (
                            <h4 className="font-sans font-semibold text-xs sm:text-sm text-on-surface">
                              {book.temporalMetadata.eraName ||
                                book.temporalMetadata.eraLabel}
                            </h4>
                          )}
                          <div className="swiper-no-swiping">
                            <Badge
                              variant="temporal"
                              size="sm"
                              className="text-[11px] font-mono tabular-nums"
                            >
                              {book.temporalMetadata.startYear !== undefined &&
                              book.temporalMetadata.endYear !== undefined
                                ? `${formatYear(book.temporalMetadata.startYear)} – ${formatYear(book.temporalMetadata.endYear)}`
                                : book.temporalMetadata.startYear !== undefined
                                  ? `Circa ${formatYear(book.temporalMetadata.startYear)}`
                                  : 'Historical Epoch'}
                            </Badge>
                          </div>
                        </div>
                        {book.temporalMetadata.rationale && (
                          <div className="pt-2 border-t border-outline-variant/40">
                            <p className="font-body-xs text-xs text-on-surface-variant leading-relaxed italic">
                              &ldquo;{book.temporalMetadata.rationale}&rdquo;
                            </p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </section>
              )}
            </div>
          )}

          {/* Author Bio Bento Box */}
          <section className="bento-card p-5">
            <div className="flex items-start gap-3.5 sm:gap-4">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden shrink-0 border border-outline-variant/60 bg-surface-container flex items-center justify-center">
                <User className="w-5 h-5 text-on-surface-variant" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="font-serif text-base sm:text-lg font-semibold text-primary">
                    About {toTitleCase(book.author)}
                  </h3>
                  {!book.authorBio &&
                    canEdit &&
                    book.author &&
                    book.author !== 'Unknown Author' && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isEnrichingBio}
                        onClick={() =>
                          void triggerManualEnrichment('authorBio')
                        }
                        className="gap-1.5 swiper-no-swiping text-xs h-7 px-2.5"
                      >
                        {isEnrichingBio ? (
                          <>
                            <Loader2 className="animate-spin w-3 h-3" />
                            <span>Fetching...</span>
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3 text-primary" />
                            <span>
                              {hasAiPlan ? 'Generate Bio' : 'Fetch Bio'}
                            </span>
                          </>
                        )}
                      </Button>
                    )}
                </div>

                <div className="mt-2.5">
                  {book.authorBio ? (
                    <div className="relative">
                      <div
                        className={cn(
                          'text-xs sm:text-sm text-on-surface-variant leading-relaxed font-sans transition-all duration-200',
                          book.authorBio.length > 320 &&
                            !isBioExpanded &&
                            'max-h-24 sm:max-h-28 overflow-hidden',
                        )}
                      >
                        <div className="markdown-body">
                          <Markdown>{book.authorBio}</Markdown>
                        </div>
                      </div>
                      {book.authorBio.length > 320 && !isBioExpanded && (
                        <div className="absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-surface-container-lowest to-transparent pointer-events-none" />
                      )}
                      {book.authorBio.length > 320 && (
                        <button
                          type="button"
                          onClick={() => setIsBioExpanded(!isBioExpanded)}
                          className="mt-1.5 text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1 transition-colors cursor-pointer py-0.5"
                        >
                          {isBioExpanded ? 'Show less' : 'Read full biography'}
                          <ChevronDown
                            className={cn(
                              'w-3.5 h-3.5 transition-transform duration-200',
                              isBioExpanded && 'rotate-180',
                            )}
                          />
                        </button>
                      )}
                    </div>
                  ) : isEnrichingBio ||
                    book.enrichmentStatus?.authorBio === 'in_progress' ? (
                    <div className="flex items-center gap-2 text-on-surface-variant font-sans text-xs sm:text-sm">
                      <Loader2 className="animate-spin" size={16} /> Fetching
                      bio...
                    </div>
                  ) : (
                    <p className="text-on-surface-variant/80 font-sans text-xs sm:text-sm italic">
                      No author biography available.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* AI Features */}
          <AiInsightsPanel
            libraryId={libraryId}
            book={book}
            canEdit={canEdit}
            activeInsight={activeInsight}
            insightContent={insightContent}
            isGeneratingInsight={isGeneratingInsight}
            handleGenerateInsight={handleGenerateInsight}
          />

          {/* Reviews */}
          <ReviewSection
            libraryId={libraryId}
            book={book}
            reviews={reviews}
            setReviewsOptimistically={setReviewsOptimistically}
            canEdit={canEdit}
            addReview={addReview}
          />
        </div>
      </div>

      <AnimatePresence>
        {isEditingDetails && (
          <EditBookForm
            libraryId={libraryId}
            book={book}
            bookBase={bookBase}
            bookDetails={bookDetails}
            updateBook={updateBook}
            updateBookOptimistically={updateBookOptimistically}
            onClose={() => setIsEditingDetails(false)}
            onDelete={handleDeleteBook}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
