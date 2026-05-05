import {motion, AnimatePresence} from 'motion/react';
import React, {useState, useEffect} from 'react';
import {useParams, useNavigate, useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {toast} from 'sonner';
import Markdown from 'react-markdown';
import {toTitleCase} from '../lib/utils';
import {Edit2, Loader2, Book as BookIcon, User, Trash2, X} from 'lucide-react';
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import {ReviewSection} from './book-details/ReviewSection';
import {EditBookForm} from './book-details/EditBookForm';
import {useBook} from './book-details/useBook';
import {useBookInsights} from './book-details/useBookInsights';
import {useDebug} from '../contexts/DebugContext';
import {Button} from '@/components/ui/button';

export default function BookDetailsView() {
  const {libraryId, bookId} = useParams<{libraryId: string; bookId: string}>();
  const {user} = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const backUrl = location.state?.from || `/library/${libraryId}`;

  const {
    book,
    bookBase,
    bookDetails,
    setBookBase,
    setBookDetails,
    reviews,
    setReviews,
    isLoading,
    canEdit,
    deleteBook,
    updateReadingStatus,
    addReview,
    updateBook,
  } = useBook(libraryId, bookId);

  const {
    activeInsight,
    insightContent,
    isGeneratingInsight,
    handleGenerateInsight,
  } = useBookInsights(libraryId, book, canEdit);

  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter huge payloads for DebugOverlay
  const debugData = React.useMemo(() => {
    if (!bookBase) return null;
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
  }, [bookBase, bookDetails]);

  const {setDebugData} = useDebug();

  useEffect(() => {
    if (debugData) {
      setDebugData(debugData, 'Book Docs');
    }
  }, [debugData, setDebugData]);

  const handleDeleteBook = async () => {
    if (!book || !libraryId || !canEdit) return;
    try {
      // Optimistic navigation
      toast.success('Book deleted');
      void navigate(backUrl, {replace: true});

      await deleteBook();
    } catch {
      toast.error('Failed to delete book');
    }
  };

  const startEditing = () => {
    setIsEditingDetails(true);
  };

  if (isLoading) {
    return (
      <>
        <LibrarySidebarNav libraryId={libraryId} />
        <div className="layout-page-content">
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
      </>
    );
  }

  if (!book) return null;

  return (
    <>
      <LibrarySidebarNav libraryId={libraryId} />
      <motion.div
        initial={{opacity: 0, y: 10}}
        animate={{opacity: 1, y: 0}}
        transition={{duration: 0.4}}
        className="layout-page-content"
      >
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
            {/* Header Info */}
            <div>
              <div className="flex flex-wrap gap-2 mb-4">
                {book.genres && book.genres.length > 0 && book.genres[0] && (
                  <span className="bg-tertiary-container/10 text-tertiary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                    {book.genres[0].toUpperCase()}
                  </span>
                )}
                {book.series && book.series !== 'Standalone' && (
                  <span className="bg-secondary-container/10 text-secondary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                    {String(book.series).toUpperCase()}
                  </span>
                )}
              </div>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h1 className="font-headline-xl text-headline-xl text-primary mb-2">
                    {toTitleCase(book.title)}
                  </h1>
                  <h2 className="font-headline-md text-headline-md text-secondary mb-6">
                    by {toTitleCase(book.author)}
                  </h2>
                </div>
                {canEdit && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 flex-shrink-0">
                    <Button
                      variant="outline"
                      onClick={startEditing}
                      className="flex items-center justify-center gap-2 w-full sm:w-auto"
                    >
                      <Edit2 size={16} /> Edit
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={() => setIsDeleting(true)}
                      className="flex items-center justify-center gap-2 w-full sm:w-auto"
                    >
                      <Trash2 size={16} /> Delete
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-6 text-on-surface-variant text-sm font-body-md border-b border-surface-dim pb-6">
                <div className="flex flex-col">
                  <span className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                    Published
                  </span>
                  <span>{book.publishedDate || 'Unknown'}</span>
                </div>
                <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
                <div className="flex flex-col">
                  <span className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                    Format
                  </span>
                  <span className="capitalize">
                    {book.format || 'Physical'}
                  </span>
                </div>
                <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
                <div className="flex flex-col">
                  <span className="font-label-caps text-label-caps text-on-surface-variant mb-1">
                    ISBN
                  </span>
                  <span>{book.isbn || 'Unknown'}</span>
                </div>
              </div>
            </div>

            {/* Reading Status */}
            <section className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-surface-container p-4 rounded-lg border border-outline-variant/30 w-fit">
              <label
                htmlFor="readingStatus"
                className="font-label-caps text-label-caps text-on-surface-variant"
              >
                Reading Status
              </label>
              <select
                id="readingStatus"
                value={book.userStatuses?.[user?.uid || ''] || 'unset'}
                onChange={async e => {
                  if (!libraryId || !bookId || !user) return;
                  const newStatus = e.target.value as
                    | 'unset'
                    | 'reading'
                    | 'finished'
                    | 'abandoned';
                  const originalBookBase = bookBase ? {...bookBase} : null;

                  // Optimistic update
                  setBookBase(prev => {
                    if (!prev) return null;
                    return {
                      ...prev,
                      userStatuses: {
                        ...(prev.userStatuses || {}),
                        [user.uid]: newStatus,
                      },
                    };
                  });

                  try {
                    await updateReadingStatus(newStatus);
                    toast.success('Reading status updated');
                  } catch {
                    setBookBase(originalBookBase);
                    toast.error('Failed to update status');
                  }
                }}
                disabled={!canEdit}
                className="px-4 py-2 bg-surface text-on-surface border border-outline-variant/60 rounded focus:ring-1 focus:ring-primary focus:outline-none cursor-pointer disabled:opacity-50 appearance-none min-w-[180px] text-sm font-medium"
                style={{
                  backgroundImage:
                    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E\")",
                  backgroundPosition: 'right 0.75rem center',
                  backgroundRepeat: 'no-repeat',
                  backgroundSize: '1em',
                }}
              >
                <option value="unset">Not Started</option>
                <option value="reading">Currently Reading</option>
                <option value="finished">Finished</option>
                <option value="abandoned">Abandoned</option>
              </select>
            </section>

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
            <section className="mt-8">
              <div className="flex flex-wrap gap-2 mb-6">
                <Button
                  variant={activeInsight === 'catchup' ? 'default' : 'outline'}
                  onClick={() => handleGenerateInsight('catchup')}
                >
                  Catch Me Up (Spoilers)
                </Button>
                <Button
                  variant={activeInsight === 'similar' ? 'default' : 'outline'}
                  onClick={() => handleGenerateInsight('similar')}
                >
                  Other Books Like This
                </Button>
              </div>

              {activeInsight && (
                <div className="bg-surface-container-lowest rounded-lg p-6 sm:p-8 architectural-shadow border border-surface-variant">
                  {isGeneratingInsight ? (
                    <div className="flex items-center gap-3 text-on-surface-variant">
                      <Loader2 className="animate-spin" size={24} />
                      <p>Consulting the AI...</p>
                    </div>
                  ) : insightContent ? (
                    <div className="markdown-body">
                      <Markdown>{insightContent}</Markdown>
                    </div>
                  ) : null}
                </div>
              )}
            </section>

            {/* Reviews */}
            <ReviewSection
              libraryId={libraryId!}
              book={book}
              reviews={reviews}
              setReviews={setReviews}
              canEdit={canEdit}
              addReview={addReview}
            />
          </div>
        </div>
      </motion.div>

      <Dialog
        open={isDeleting}
        onOpenChange={open => !open && setIsDeleting(false)}
      >
        <DialogContent
          showCloseButton={false}
          className="bg-surface rounded-[32px] p-8 max-w-md w-full shadow-[0px_10px_40px_rgba(0,0,0,0.1)] border border-surface-variant gap-0"
        >
          <div className="flex items-center justify-between mb-8">
            <DialogTitle className="text-2xl font-serif font-medium flex items-center gap-3 text-on-surface tracking-tight">
              <div className="w-10 h-10 bg-error-container rounded-full flex items-center justify-center text-error border border-error-container/50">
                <Trash2 size={20} />
              </div>
              Delete Book
            </DialogTitle>
            <button
              onClick={() => setIsDeleting(false)}
              className="p-2.5 text-on-surface-variant hover:bg-surface-container rounded-full transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="mb-8">
            <p className="text-on-surface-variant text-sm leading-relaxed text-left">
              Are you sure you want to delete this book? This action cannot be
              undone.
            </p>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setIsDeleting(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteBook}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AnimatePresence>
        {isEditingDetails && (
          <EditBookForm
            libraryId={libraryId!}
            book={book}
            bookBase={bookBase}
            bookDetails={bookDetails}
            setBookBase={setBookBase}
            setBookDetails={setBookDetails}
            updateBook={updateBook}
            onClose={() => setIsEditingDetails(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
