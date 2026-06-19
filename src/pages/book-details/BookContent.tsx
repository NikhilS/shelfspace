import {AnimatePresence} from 'motion/react';
import React, {useState, useEffect, useMemo} from 'react';
import {useAuth} from '../../stores/authStore';
import {toast} from 'sonner';
import Markdown from 'react-markdown';
import {toTitleCase} from '../../lib/utils';
import {
  Loader2,
  Book as BookIcon,
  User,
  Globe,
  Compass,
  MapPin,
  History,
  Clock,
} from 'lucide-react';
import {ReviewSection} from './ReviewSection';
import {EditBookForm} from './EditBookForm';
import {useBook} from './useBook';
import {BookHeader} from './BookHeader';
import {ReadingStatusSelect} from './ReadingStatusSelect';
import {AiInsightsPanel} from './AiInsightsPanel';
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
  } = useBook(libraryId, bookId, passedCanEdit);

  const [isEditingDetails, setIsEditingDetails] = useState(false);

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

  useEffect(() => {
    if (debugData) {
      setDebugData(debugData, 'Book Docs');
    }
  }, [debugData, setDebugData]);

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
        <div className="md:col-span-4 flex flex-col gap-6">
          <div className="aspect-[2/3] w-full bg-surface-container rounded-lg overflow-hidden architectural-shadow relative">
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
                <div
                  className={`absolute top-4 right-4 font-label-caps text-label-caps px-3 py-1 rounded shadow-sm ${
                    book.userStatuses[user?.uid || ''] === 'reading'
                      ? 'bg-primary text-on-primary'
                      : book.userStatuses[user?.uid || ''] === 'finished'
                        ? 'bg-on-tertiary-fixed-variant text-white'
                        : 'bg-error text-on-error'
                  }`}
                >
                  {book.userStatuses[user?.uid || ''] === 'reading'
                    ? 'READING'
                    : book.userStatuses[user?.uid || ''] === 'finished'
                      ? 'FINISHED'
                      : 'ABANDONED'}
                </div>
              )}
          </div>
        </div>

        {/* Right Column */}
        <div className="md:col-span-8 flex flex-col gap-10">
          <BookHeader book={book} canEdit={canEdit} onEdit={startEditing} />

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
            <h3 className="font-headline-md text-headline-md text-primary mb-4">
              Synopsis
            </h3>
            <div className="font-body-lg text-body-lg text-on-surface space-y-4 leading-relaxed">
              {book.synopsis ? (
                <div className="markdown-body">
                  <Markdown>{book.synopsis}</Markdown>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-on-surface-variant">
                  <Loader2 className="animate-spin" size={20} /> Fetching
                  synopsis...
                </div>
              )}
            </div>

            {book.genres && book.genres.length > 0 && (
              <div className="mt-8 pt-4 border-t border-surface-variant flex items-center flex-wrap gap-2">
                <span className="font-label-caps text-label-caps text-on-surface-variant mr-2">
                  All Categories:
                </span>
                {book.genres.map((g, idx) => (
                  <span
                    key={idx}
                    className="font-label-caps text-label-caps text-on-surface-variant px-2 py-0.5 border border-outline-variant/30 rounded-sm bg-surface-variant/30"
                  >
                    {g}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Literary Setting Section */}
          {book.geoMetadata && (
            <section className="bg-surface-container-lowest rounded-lg border border-surface-variant p-8 architectural-shadow">
              <div className="flex items-center gap-3 mb-6">
                <Globe className="w-6 h-6 text-primary shrink-0" />
                <h3 className="font-headline-md text-headline-md text-primary">
                  Literary Setting
                </h3>
              </div>

              {book.geoMetadata.isNonEarth ? (
                <div className="flex items-start gap-4 p-5 rounded-lg bg-surface-variant/20 border border-outline-variant/30">
                  <Compass className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-title-md text-title-md font-bold text-on-surface">
                      Fictional / Non-Earth Realm
                    </h4>
                    <p className="font-body-md text-body-md text-on-surface-variant mt-2 leading-relaxed">
                      The setting of this work is identified as being located in
                      a fictional, fantasy, or non-earth universe (such as space
                      or an imagined world).
                    </p>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {book.geoMetadata.locations &&
                  book.geoMetadata.locations.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {book.geoMetadata.locations.map((loc, idx) => {
                        const getAdminLevelBadgeClass = (level: string) => {
                          switch (level?.toLowerCase()) {
                            case 'city':
                              return 'bg-primary/10 text-primary border-primary/20';
                            case 'state':
                              return 'bg-secondary/10 text-secondary border-secondary/20';
                            case 'country':
                              return 'bg-tertiary/10 text-tertiary border-tertiary/20';
                            default:
                              return 'bg-outline/10 text-on-surface-variant border-outline/20';
                          }
                        };
                        return (
                          <div
                            key={idx}
                            className="p-5 rounded-lg border border-outline-variant/30 bg-surface/50 hover:bg-surface-variant/5 transition-all flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-start justify-between gap-2 mb-3">
                                <span className="font-serif font-bold text-lg text-on-surface flex items-center gap-1.5 leading-snug">
                                  <MapPin className="w-5 h-5 text-primary shrink-0" />
                                  {loc.name}
                                </span>
                                <span
                                  className={`text-[10px] font-bold tracking-wider uppercase px-2 py-0.5 rounded-sm border shrink-0 ${getAdminLevelBadgeClass(
                                    loc.adminLevel,
                                  )}`}
                                >
                                  {loc.adminLevel}
                                </span>
                              </div>
                              {loc.rationale && (
                                <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed">
                                  {loc.rationale}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="font-body-md text-body-md text-on-surface-variant italic">
                      No specific geographical locations have been mapped for
                      this book yet.
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Temporal Setting Section */}
          {book.temporalMetadata && (
            <section
              id="book-temporal-setting-section"
              className="bg-surface-container-lowest rounded-lg border border-surface-variant p-8 architectural-shadow"
            >
              <div className="flex items-center gap-3 mb-6">
                <History className="w-6 h-6 text-primary shrink-0" />
                <h3 className="font-headline-md text-headline-md text-primary">
                  Temporal Setting & Historical Era
                </h3>
              </div>

              {book.temporalMetadata.isNonHistorical ? (
                <div
                  id="temporal-non-historical-badge"
                  className="flex items-start gap-4 p-5 rounded-lg bg-surface-variant/20 border border-outline-variant/30"
                >
                  <Clock className="w-6 h-6 text-primary shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-title-md text-title-md font-bold text-on-surface">
                      Non-Historical / Contemporary
                    </h4>
                    <p className="font-body-md text-body-md text-on-surface-variant mt-2 leading-relaxed">
                      This work is set in contemporary/modern times, or has no
                      specific historical/epoch setting.
                    </p>
                    {book.temporalMetadata.rationale && (
                      <p className="font-body-sm text-body-sm text-on-surface-variant italic mt-3 border-l-2 border-outline-variant/30 pl-3 leading-relaxed">
                        &ldquo;{book.temporalMetadata.rationale}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div id="temporal-historical-details" className="space-y-6">
                  <div className="p-5 rounded-lg border border-outline-variant/30 bg-surface/50 hover:bg-surface-variant/5 transition-all">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                      <div>
                        {book.temporalMetadata.eraName && (
                          <h4 className="font-serif font-bold text-lg text-on-surface leading-snug mb-1">
                            {book.temporalMetadata.eraName}
                          </h4>
                        )}
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono font-bold tracking-wider uppercase text-primary bg-primary/10 border border-primary/20 px-2.5 py-0.5 rounded">
                            {book.temporalMetadata.startYear !== undefined &&
                            book.temporalMetadata.endYear !== undefined
                              ? `${formatYear(book.temporalMetadata.startYear)} – ${formatYear(book.temporalMetadata.endYear)}`
                              : book.temporalMetadata.startYear !== undefined
                                ? `Circa ${formatYear(book.temporalMetadata.startYear)}`
                                : 'Historical Epoch'}
                          </span>
                        </div>
                      </div>
                    </div>
                    {book.temporalMetadata.rationale && (
                      <div className="mt-4 pt-4 border-t border-outline-variant/20">
                        <h5 className="text-[11px] font-bold tracking-wider uppercase text-on-surface-variant mb-2">
                          Historical Evidence & Rationale
                        </h5>
                        <p className="font-body-sm text-body-sm text-on-surface-variant leading-relaxed italic">
                          &ldquo;{book.temporalMetadata.rationale}&rdquo;
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Author Bio Bento Box */}
          <section className="bg-surface-container-lowest rounded-lg border border-surface-variant p-8 architectural-shadow">
            <div className="flex flex-col sm:flex-row gap-6 items-start">
              <div className="w-24 h-24 rounded-full overflow-hidden shrink-0 border-2 border-surface-container bg-surface flex items-center justify-center">
                <User className="w-12 h-12 text-on-surface-variant" />
              </div>
              <div>
                <h3 className="font-headline-md text-headline-md text-primary mb-1">
                  About {toTitleCase(book.author)}
                </h3>
                <div className="font-body-md text-body-md text-on-surface leading-relaxed mt-4">
                  {book.authorBio ? (
                    <div className="markdown-body">
                      <Markdown>{book.authorBio}</Markdown>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-on-surface-variant">
                      <Loader2 className="animate-spin" size={20} /> Fetching
                      bio...
                    </div>
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
