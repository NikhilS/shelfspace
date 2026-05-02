import {motion, AnimatePresence} from 'motion/react';
import React, {useState} from 'react';
import {useParams, Link, useNavigate, useLocation} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {doc, updateDoc, serverTimestamp} from 'firebase/firestore';
import {toast} from 'sonner';
import Markdown from 'react-markdown';
import {toTitleCase} from '../lib/utils';
import {
  ArrowLeft,
  Edit2,
  Loader2,
  Book as BookIcon,
  User,
  Trash2,
} from 'lucide-react';
import SidebarActions from '../components/SidebarActions';
import {ReviewSection} from './book-details/ReviewSection';
import {EditBookForm} from './book-details/EditBookForm';
import {useBook} from './book-details/useBook';
import {useBookInsights} from './book-details/useBookInsights';

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
  } = useBook(libraryId, bookId);

  const {
    activeInsight,
    insightContent,
    isGeneratingInsight,
    handleGenerateInsight,
  } = useBookInsights(libraryId, book, canEdit);

  const [isEditingDetails, setIsEditingDetails] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteBook = async () => {
    if (!book || !libraryId || !canEdit) return;
    try {
      // Optimistic navigation
      toast.success('Book deleted');
      void navigate(backUrl, {replace: true});

      await deleteBook();
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `libraries/${libraryId}/books/${book.id}`,
      );
      toast.error('Failed to delete book');
    }
  };

  const startEditing = () => {
    setIsEditingDetails(true);
  };

  if (isLoading) {
    return (
      <>
        <SidebarActions>
          <></>
        </SidebarActions>
        <div className="flex-1 w-full bg-background px-4 sm:px-8 lg:px-12 py-6 sm:py-8 max-w-[1200px] mx-auto relative overflow-hidden">
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
      <SidebarActions>
        <Link
          to={backUrl}
          className="flex items-center gap-3 text-on-surface hover:text-primary px-4 py-3 rounded-xl hover:bg-surface-container transition-all duration-200 w-full text-left font-serif text-lg tracking-tight cursor-pointer"
        >
          <ArrowLeft className="w-5 h-5 text-on-surface-variant flex-shrink-0" />
          <span>Back to Library</span>
        </Link>
      </SidebarActions>
      <motion.div
        initial={{opacity: 0, y: 10}}
        animate={{opacity: 1, y: 0}}
        transition={{duration: 0.4}}
        className="flex-1 overflow-y-auto px-4 sm:px-8 lg:px-12 py-6 sm:py-8 max-w-[1200px] mx-auto w-full"
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
                {book.genres && book.genres.length > 0 && (
                  <span className="bg-tertiary-container/10 text-tertiary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                    {book.genres[0].toUpperCase()}
                  </span>
                )}
                {book.series && book.series !== 'Standalone' && (
                  <span className="bg-secondary-container/10 text-secondary-container font-label-caps text-label-caps px-3 py-1 rounded-[0.125rem]">
                    {book.series.toUpperCase()}
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
                  <div className="flex flex-col sm:flex-row items-center gap-2 flex-shrink-0">
                    <button
                      onClick={startEditing}
                      className="flex items-center gap-2 px-4 py-2 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-md transition-colors text-sm font-label-caps uppercase tracking-wider border border-outline-variant/30"
                    >
                      <Edit2 size={16} /> Edit
                    </button>
                    <button
                      onClick={() => setIsDeleting(true)}
                      className="flex items-center gap-2 px-4 py-2 text-error hover:bg-error/10 rounded-md transition-colors text-sm font-label-caps uppercase tracking-wider border border-error/30"
                    >
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-6 text-on-surface-variant text-[14px] font-body-md border-b border-surface-dim pb-6">
                <div className="flex flex-col">
                  <span className="text-on-surface-variant uppercase text-xs tracking-wider mb-1">
                    Published
                  </span>
                  <span>{book.publishedDate || 'Unknown'}</span>
                </div>
                <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
                <div className="flex flex-col">
                  <span className="text-on-surface-variant uppercase text-xs tracking-wider mb-1">
                    Format
                  </span>
                  <span className="capitalize">
                    {book.format || 'Physical'}
                  </span>
                </div>
                <div className="w-px h-8 bg-surface-variant hidden sm:block"></div>
                <div className="flex flex-col">
                  <span className="text-on-surface-variant uppercase text-xs tracking-wider mb-1">
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
                className="font-label-caps text-label-caps text-on-surface-variant uppercase tracking-wider"
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
                    await updateDoc(
                      doc(db, 'libraries', libraryId, 'books', bookId),
                      {
                        [`userStatuses.${user.uid}`]: newStatus,
                        addedBy: book.addedBy || user.uid,
                        addedAt: book.addedAt || serverTimestamp(),
                      },
                    );
                    toast.success('Reading status updated');
                  } catch (e) {
                    setBookBase(originalBookBase);
                    handleFirestoreError(
                      e,
                      OperationType.UPDATE,
                      `libraries/${libraryId}/books/${bookId}`,
                    );
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
              <h3 className="font-headline-md text-[24px] text-primary mb-4">
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
                  <span className="font-label-caps text-on-surface-variant uppercase text-[10px] tracking-wider mr-2">
                    All Categories:
                  </span>
                  {book.genres.map((g, idx) => (
                    <span
                      key={idx}
                      className="text-xs text-on-surface-variant px-2 py-0.5 border border-outline-variant/30 rounded-sm bg-surface-variant/30"
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
                  <h3 className="font-headline-md text-[24px] text-primary mb-1">
                    About {toTitleCase(book.author)}
                  </h3>
                  <div className="font-body-md text-[16px] text-on-surface leading-relaxed mt-4">
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
              <div className="flex flex-wrap gap-4 mb-6">
                <button
                  onClick={() => handleGenerateInsight('catchup')}
                  className={`px-6 py-2 rounded-full font-label-caps text-label-caps transition-all border ${
                    activeInsight === 'catchup'
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-transparent text-primary border-primary hover:bg-primary/5'
                  }`}
                >
                  CATCH ME UP (SPOILERS)
                </button>
                <button
                  onClick={() => handleGenerateInsight('similar')}
                  className={`px-6 py-2 rounded-full font-label-caps text-label-caps transition-all border ${
                    activeInsight === 'similar'
                      ? 'bg-primary text-on-primary border-primary'
                      : 'bg-transparent text-primary border-primary hover:bg-primary/5'
                  }`}
                >
                  OTHER BOOKS LIKE THIS
                </button>
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
            />
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {isDeleting && (
          <motion.div
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4 font-sans text-left"
          >
            <motion.div
              initial={{scale: 0.95, opacity: 0}}
              animate={{scale: 1, opacity: 1}}
              exit={{scale: 0.95, opacity: 0}}
              className="bg-surface rounded-[32px] p-8 max-w-sm w-full shadow-[0px_10px_40px_rgba(0,0,0,0.1)] border border-surface-variant"
            >
              <div className="w-12 h-12 bg-error-container rounded-full flex items-center justify-center text-on-error-container mb-5 border border-error-container/50">
                <Trash2 size={24} strokeWidth={1.5} />
              </div>
              <h3 className="text-2xl font-serif font-medium text-on-surface mb-3 tracking-tight">
                Delete Book
              </h3>
              <p className="text-on-surface-variant mb-8 text-sm leading-relaxed">
                Are you sure you want to delete this book? This action cannot be
                undone.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setIsDeleting(false)}
                  className="px-5 py-3 text-on-surface font-medium hover:bg-surface-container border border-surface-variant rounded-xl transition-colors text-sm"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteBook}
                  className="px-5 py-3 bg-error text-on-error hover:bg-error/90 rounded-xl transition-colors font-medium text-sm shadow-sm"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isEditingDetails && (
          <EditBookForm
            libraryId={libraryId!}
            book={book}
            bookBase={bookBase}
            bookDetails={bookDetails}
            setBookBase={setBookBase}
            setBookDetails={setBookDetails}
            onClose={() => setIsEditingDetails(false)}
          />
        )}
      </AnimatePresence>
    </>
  );
}
