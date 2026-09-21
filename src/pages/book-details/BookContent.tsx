import {AnimatePresence} from 'motion/react';
import React, {useState, useEffect, useMemo} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {useAuth} from '../../stores/authStore';
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
      <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12">
        {/* Left Column */}
        <div className="md:col-span-4 flex flex-col gap-6 items-center md:items-stretch">
          <div className="aspect-[2/3] w-3/4 max-w-[240px] md:w-full md:max-w-none mx-auto bg-surface-container rounded-lg overflow-hidden architectural-shadow relative flex-shrink-0">
            {book.coverUrl ? (
              <img
                src={book.coverUrl}
                alt={book.title}
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                <BookIcon className="w-16 h-16 text-primary opacity-50" />
              </div>
            )}
            {/* Status Badge */}
            {book.userStatuses?.[user?.uid || ''] &&
              book.userStatuses?.[user?.uid || ''] !== 'unset' && (
                <div className="absolute top-4 right-4 shadow-sm swiper-no-swiping">
                  <Badge
                    variant={
                      book.userStatuses[user?.uid || ''] === 'reading'
                        ? 'status-reading'
                        : book.userStatuses[user?.uid || ''] === 'finished'
                          ? 'status-read'
                          : 'status-abandoned'
                    }
                  >
                    {book.userStatuses[user?.uid || ''] === 'reading'
                      ? 'READING'
                      : book.userStatuses[user?.uid || ''] === 'finished'
                        ? 'FINISHED'
                        : 'ABANDONED'}
                  </Badge>
                </div>
              )}
          </div>
        </div>

        {/* Right Column */}
        <div className="md:col-span-8 flex flex-col gap-6 sm:gap-8">
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

          {/* Synopsis */}
          <section>
            <div className="flex items-center justify-between gap-4 mb-3">
              <h3 className="font-title-lg sm:font-headline-md text-primary">
                Synopsis
              </h3>
              {!book.synopsis && canEdit && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isEnrichingSynopsis}
                  onClick={() => void triggerManualEnrichment('synopsis')}
                  className="gap-1.5 swiper-no-swiping text-xs h-7 px-2.5"
                >
                  {isEnrichingSynopsis ? (
                    <>
                      <Loader2 className="animate-spin w-3.5 h-3.5" />
                      <span>Fetching...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 text-primary" />
                      <span>Generate Synopsis</span>
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
                      'text-sm sm:text-[15px] text-on-surface/90 font-sans leading-relaxed transition-all duration-200',
                      book.synopsis.length > 400 &&
                        !isSynopsisExpanded &&
                        'max-h-48 overflow-hidden',
                    )}
                  >
                    <div className="markdown-body">
                      <Markdown>{book.synopsis}</Markdown>
                    </div>
                  </div>
                  {book.synopsis.length > 400 && !isSynopsisExpanded && (
                    <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-background via-background/80 to-transparent pointer-events-none" />
                  )}
                  {book.synopsis.length > 400 && (
                    <button
                      type="button"
                      onClick={() => setIsSynopsisExpanded(!isSynopsisExpanded)}
                      className="mt-2 text-xs font-semibold text-primary hover:text-primary/80 flex items-center gap-1.5 transition-colors cursor-pointer py-1"
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
              <div className="mt-5 pt-3.5 border-t border-outline-variant/30 flex items-center flex-wrap gap-2 swiper-no-swiping">
                <span className="font-label-caps text-label-caps text-on-surface-variant mr-1">
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
                <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/40 p-4 sm:p-5 architectural-shadow flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Globe className="w-4 h-4 text-primary" />
                        </div>
                        <h3 className="font-sans font-bold text-base sm:text-lg text-primary truncate">
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
                      <div className="flex items-start gap-2.5 p-3 rounded-lg bg-surface-variant/20 border border-outline-variant/30">
                        <Compass className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-bold text-xs sm:text-sm text-on-surface">
                            Fictional / Non-Earth Realm
                          </h4>
                          <p className="font-body-xs text-xs text-on-surface-variant mt-1 leading-relaxed">
                            Set in an imagined, fantasy, or non-earth universe.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
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
                                  return 'bg-surface-container text-on-surface border-outline-variant/40';
                              }
                            };
                            return (
                              <div
                                key={idx}
                                className="p-2.5 sm:p-3 rounded-lg border border-outline-variant/30 bg-surface/50 hover:bg-surface-variant/5 transition-all flex flex-col justify-between"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-sans font-bold text-xs sm:text-sm text-on-surface flex items-center gap-1.5 truncate">
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
                  className="bg-surface-container-lowest rounded-xl border border-outline-variant/40 p-4 sm:p-5 architectural-shadow flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                          <Clock className="w-4 h-4 text-primary" />
                        </div>
                        <h3 className="font-sans font-bold text-base sm:text-lg text-primary truncate">
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
                        className="flex items-start gap-2.5 p-3 rounded-lg bg-surface-variant/20 border border-outline-variant/30"
                      >
                        <Clock className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                        <div>
                          <h4 className="font-bold text-xs sm:text-sm text-on-surface">
                            Contemporary Era
                          </h4>
                          <p className="font-body-xs text-xs text-on-surface-variant mt-1 leading-relaxed">
                            Set in contemporary/modern times without a specific
                            historical era.
                          </p>
                          {book.temporalMetadata.rationale && (
                            <p className="font-body-xs text-xs text-on-surface-variant/80 italic mt-2 border-l-2 border-outline-variant/40 pl-2 leading-relaxed line-clamp-2">
                              &ldquo;{book.temporalMetadata.rationale}&rdquo;
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div
                        id="temporal-historical-details"
                        className="p-3 rounded-lg border border-outline-variant/30 bg-surface/50 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          {book.temporalMetadata.eraName && (
                            <h4 className="font-sans font-bold text-xs sm:text-sm text-on-surface">
                              {book.temporalMetadata.eraName}
                            </h4>
                          )}
                          <div className="swiper-no-swiping">
                            <Badge
                              variant="temporal"
                              size="sm"
                              className="text-[11px] font-mono"
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
                          <div className="pt-2 border-t border-outline-variant/20">
                            <p className="font-body-xs text-xs text-on-surface-variant leading-relaxed italic border-l-2 border-outline-variant/40 pl-2">
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
          <section className="bg-surface-container-lowest rounded-xl border border-outline-variant/40 p-4 sm:p-5 architectural-shadow">
            <div className="flex items-start gap-3.5 sm:gap-4">
              <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full overflow-hidden shrink-0 border border-outline-variant/50 bg-surface-container flex items-center justify-center">
                <User className="w-5 h-5 text-on-surface-variant" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="font-sans text-base sm:text-lg font-bold text-primary">
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
                            <span>Generate Bio</span>
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
