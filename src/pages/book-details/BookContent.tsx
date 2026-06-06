import {AnimatePresence} from 'motion/react';
import React, {useState, useEffect, useMemo} from 'react';
import {useAuth} from '../../contexts/AuthContext';
import {toast} from 'sonner';
import Markdown from 'react-markdown';
import {toTitleCase} from '../../lib/utils';
import {Loader2, Book as BookIcon, User} from 'lucide-react';
import {ReviewSection} from './ReviewSection';
import {EditBookForm} from './EditBookForm';
import {useBook} from './useBook';
import {BookHeader} from './BookHeader';
import {ReadingStatusSelect} from './ReadingStatusSelect';
import {AiInsightsPanel} from './AiInsightsPanel';
import {useDebug} from '../../contexts/DebugContext';

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
                        ? 'bg-[#2f4d40] text-white'
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
