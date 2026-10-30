import React, {useMemo, useCallback} from 'react';
import {motion} from 'motion/react';
import {Book, Library} from '../../types';
import {Plus, ArrowRight} from 'lucide-react';
import {toTitleCase, getFirestoreTime} from '../../lib/utils';
import {useNavigate, useLocation} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {BookshelfBookendsIllustration} from '@/components/ui/empty-state-illustrations';
import {GenreBreakdownCard} from '../../components/book/GenreBreakdownCard';
import {CuratorPickCard} from '../../components/book/CuratorPickCard';
import {ExplorePerspectivesStrip} from '../../components/book/ExplorePerspectivesStrip';
import {ArchivalCoverImage} from '../../components/book/ArchivalCoverImage';
import {CurrentlyReadingCard} from '../../components/book/CurrentlyReadingCard';
import {preloadRouteChunk} from '../../lib/routePreload';
import {useOnlineStatus} from '../../hooks/useOnlineStatus';
import {formatShortDate} from '../../lib/date';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {
  applyOptimisticReadingStatusPatch,
  invalidateReadingStatusQueries,
  type ReadingStatusCacheUtils,
} from '../../lib/readingStatusCache';
import {toast} from 'sonner';
import type {TrackedShelfStatus} from '../../server/services/readingTracker';
import {User} from 'firebase/auth';

interface LibraryOverviewProps {
  books: Book[];
  library: Library;
  user: User | null;
  pickOfTheDay: {
    title: string;
    author: string;
    coverUrl?: string;
    reason: string;
  } | null;
  isGeneratingPick: boolean;
  generateNewPick: () => void;
  setCurrentTab: (tab: 'overview' | 'collection') => void;
  setFilterGenre: (genre: string) => void;
  setIsFiltersOpen: (open: boolean) => void;
  selectGenreAndGoToCollection?: (genre: string) => void;
  pickError?: string | null;
  onAddBook?: () => void;
}

export function LibraryOverview({
  books,
  library,
  user,
  pickOfTheDay,
  isGeneratingPick,
  generateNewPick,
  setCurrentTab,
  setFilterGenre,
  setIsFiltersOpen,
  selectGenreAndGoToCollection,
  pickError,
  onAddBook,
}: LibraryOverviewProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const isOnline = useOnlineStatus();

  let utils: ReturnType<typeof trpc.useUtils> | undefined;
  try {
    if (typeof trpc !== 'undefined' && typeof trpc.useUtils === 'function') {
      utils = trpc.useUtils();
    }
  } catch {
    utils = undefined;
  }

  const handlePrewarmBookDetails = useCallback(() => {
    preloadRouteChunk('bookDetails');
  }, []);

  const readingBooks = useMemo<Book[]>(() => {
    if (!user) {
      return [];
    }
    return books.filter(b => b.readingStatus === 'reading');
  }, [books, user]);

  const handleReadingStatusChange = useCallback(
    async (
      targetLibraryId: string,
      bookId: string,
      nextStatus: TrackedShelfStatus | 'unset',
    ) => {
      if (!user) {
        return;
      }
      const existingBook = books.find(b => b.id === bookId);
      const rollback = applyOptimisticReadingStatusPatch(
        utils as unknown as ReadingStatusCacheUtils | undefined,
        {
          libraryId: targetLibraryId,
          bookId,
          status: nextStatus,
          bookHint: existingBook
            ? {...existingBook, libraryName: library.name}
            : undefined,
        },
      );
      try {
        if (trpcVanilla?.book?.updateStatus?.mutate) {
          await trpcVanilla.book.updateStatus.mutate({
            libraryId: targetLibraryId,
            bookId,
            status: nextStatus,
          });
        }
        toast.success(
          nextStatus === 'unset'
            ? 'Removed from reading list'
            : 'Reading status updated',
        );
        await invalidateReadingStatusQueries(
          utils as unknown as ReadingStatusCacheUtils | undefined,
          {
            libraryId: targetLibraryId,
            bookId,
          },
        );
      } catch (err) {
        rollback();
        console.error('Failed to update reading status:', err);
        toast.error('Failed to update reading status');
      }
    },
    [books, library.name, user, utils],
  );

  const {recentBooks, lastCatalogedDate, orderedBookIds} = useMemo(() => {
    if (books.length === 0) {
      return {
        recentBooks: [] as Book[],
        lastCatalogedDate: 'Never',
        orderedBookIds: [] as string[],
      };
    }

    let latestTime = 0;
    const withTimestamps = books.map(book => {
      const addedAtMs = getFirestoreTime(book.addedAt) || 0;
      if (addedAtMs > latestTime) {
        latestTime = addedAtMs;
      }
      return {book, addedAtMs};
    });

    withTimestamps.sort((a, b) => b.addedAtMs - a.addedAtMs);

    return {
      recentBooks: withTimestamps.slice(0, 6).map(entry => entry.book),
      lastCatalogedDate:
        latestTime > 0 ? formatShortDate(latestTime) : 'Unknown',
      orderedBookIds: books.map(b => b.id),
    };
  }, [books]);

  return (
    <motion.div
      initial={{opacity: 0, y: 6}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.2, ease: 'easeOut'}}
      className="layout-page-content space-y-10"
    >
      {books.length === 0 ? (
        /* Empty State */
        <div className="max-w-xl mx-auto py-14 px-8 text-center flex flex-col items-center gap-6 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-elevation-2 mt-4">
          <BookshelfBookendsIllustration className="w-24 h-20" />

          <div className="space-y-2.5">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold tracking-tight text-primary">
              Ready for Its First Book
            </h2>
            <p className="font-sans text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">
              Add a book by photo, search, or bulk import—we&apos;ll fill in
              covers, historical eras, and map locations automatically.
            </p>
          </div>

          <div className="flex justify-center pt-1 w-full">
            <Button
              disabled={!isOnline}
              title={!isOnline ? 'Unavailable while offline' : undefined}
              className="w-full sm:w-auto h-11 px-6 font-sans text-sm font-semibold tracking-wide rounded-lg shadow-xs disabled:opacity-50"
              onClick={() =>
                onAddBook ? onAddBook() : navigate(`/library/${library.id}/add`)
              }
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Add Your First Book
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-10">
          {/* Tier 1: Personal & Active (The "Now") - Reading Pulse & Curator Spotlight */}
          <section aria-label="Reading Pulse and Categories">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="section-heading">
                  {readingBooks.length > 0
                    ? 'Reading Pulse'
                    : "Curator's Spotlight"}
                </h2>
                <p className="section-subheading">
                  {readingBooks.length > 0
                    ? "What you're reading now and a daily pick from your shelves"
                    : 'A daily recommendation and the genre mix on your shelves'}
                </p>
              </div>
            </div>

            <div className="space-y-5 sm:space-y-6">
              {readingBooks.length > 0 && (
                <CurrentlyReadingCard
                  readingBooks={readingBooks}
                  defaultLibrary={{id: library.id, name: library.name}}
                  showLibraryProvenance={false}
                  onStatusChange={handleReadingStatusChange}
                  onOpenReadingLists={() => setCurrentTab('collection')}
                  fromPath={location.pathname + location.search}
                />
              )}

              <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6 items-stretch">
                {/* Left Column: Metrics & Categories */}
                <div className="md:col-span-4 flex flex-col">
                  <GenreBreakdownCard
                    books={books}
                    eyebrow="Top Categories"
                    headerRight={`Last added: ${lastCatalogedDate}`}
                    onSelectGenre={genreName => {
                      if (selectGenreAndGoToCollection) {
                        selectGenreAndGoToCollection(genreName);
                      } else {
                        setFilterGenre(genreName);
                        setCurrentTab('collection');
                        setIsFiltersOpen(true);
                      }
                    }}
                  />
                </div>

                {/* Right Column: AI Curator's Pick */}
                <div className="md:col-span-8 flex flex-col">
                  <CuratorPickCard
                    pickOfTheDay={pickOfTheDay}
                    isGeneratingPick={isGeneratingPick}
                    generateNewPick={generateNewPick}
                    pickError={pickError}
                    className="w-full h-full"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* Tier 2: The Physical Shelves (The "Collection") - Recent Additions */}
          {recentBooks.length > 0 && (
            <section aria-label="Recent Acquisitions">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="section-heading">On the Shelves</h2>
                  <p className="section-subheading">
                    Recently added to this library
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentTab('collection')}
                  className="text-xs font-sans font-semibold text-primary hover:text-primary/80 flex items-center gap-1 group h-auto px-2.5 py-1.5"
                >
                  <span>
                    Browse All{' '}
                    {typeof library.bookCount === 'number'
                      ? Math.max(books.length, library.bookCount)
                      : books.length}{' '}
                    Books
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                {recentBooks.map(book => (
                  <div
                    key={book.id}
                    onMouseEnter={handlePrewarmBookDetails}
                    onFocus={handlePrewarmBookDetails}
                    onTouchStart={handlePrewarmBookDetails}
                    onClick={() =>
                      navigate(`/library/${library.id}/book/${book.id}`, {
                        state: {
                          from: location.pathname + location.search,
                          bookList: orderedBookIds,
                        },
                      })
                    }
                    className="group flex flex-col p-3 bento-card-interactive cursor-pointer"
                  >
                    <ArchivalCoverImage
                      src={book.coverUrl}
                      alt={book.title}
                      author={book.author}
                      variant="compact"
                      className="relative aspect-[2/3] w-full rounded-lg overflow-hidden bg-surface-container mb-2.5 border border-outline-variant/50 book-cover-shadow group-hover:scale-[1.02] transition-transform"
                    />
                    <h4 className="card-title-editorial truncate group-hover:text-primary transition-colors">
                      {toTitleCase(book.title)}
                    </h4>
                    <p className="font-sans text-xs text-on-surface-variant truncate mt-0.5">
                      {toTitleCase(book.author)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tier 3: Spatial & Thematic Perspectives (The "Exploration") */}
          <ExplorePerspectivesStrip
            books={books}
            basePath={`/library/${library.id}`}
            heading="Explore The Collection"
            subtitle="Explore your books across history, geography, and theme"
            ariaLabel="Explore Collection Visualizers"
            showReadSwipe={true}
            currentUserId={user?.uid}
          />
        </div>
      )}
    </motion.div>
  );
}
