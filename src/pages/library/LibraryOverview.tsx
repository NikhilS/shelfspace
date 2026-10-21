import React, {useMemo} from 'react';
import {motion} from 'motion/react';
import {Book, Library} from '../../types';
import {Book as BookIcon, Sparkles, Plus, ArrowRight} from 'lucide-react';
import {toTitleCase, getFirestoreTime} from '../../lib/utils';
import {useNavigate, useLocation} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {GenreBreakdownCard} from '../../components/book/GenreBreakdownCard';
import {CuratorPickCard} from '../../components/book/CuratorPickCard';
import {ExplorePerspectivesStrip} from '../../components/book/ExplorePerspectivesStrip';
import {formatShortDate} from '../../lib/date';
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

export const LibraryOverview: React.FC<LibraryOverviewProps> = ({
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
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const readingBooks = useMemo(() => {
    if (!user) return [];
    return books
      .filter(b => b.userStatuses?.[user.uid] === 'reading')
      .slice(0, 2);
  }, [books, user]);

  const recentBooks = useMemo(() => {
    return [...books]
      .sort(
        (a, b) =>
          (getFirestoreTime(b.addedAt) || 0) -
          (getFirestoreTime(a.addedAt) || 0),
      )
      .slice(0, 6);
  }, [books]);

  const lastCatalogedDate = useMemo(() => {
    if (books.length === 0) return 'Never';
    const latestTime = Math.max(...books.map(b => getFirestoreTime(b.addedAt)));
    if (latestTime <= 0) return 'Unknown';
    return formatShortDate(latestTime);
  }, [books]);

  return (
    <motion.div
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.35, ease: 'easeOut'}}
      className="layout-page-content space-y-10"
    >
      {books.length === 0 ? (
        /* Empty State */
        <div className="max-w-xl mx-auto py-16 px-8 text-center flex flex-col items-center gap-8 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-elevation-2 mt-4">
          <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-surface-container text-primary">
            <BookIcon className="w-9 h-9 text-primary" />
            <motion.div
              animate={{rotate: 360}}
              transition={{repeat: Infinity, duration: 24, ease: 'linear'}}
              className="absolute inset-0 border border-dashed border-outline-variant rounded-full"
            />
            <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-primary animate-pulse" />
          </div>

          <div className="space-y-3">
            <h2 className="font-sans text-3xl font-extrabold tracking-tight text-primary">
              Your Library is a Blank Page
            </h2>
            <p className="font-sans text-sm text-on-surface-variant max-w-md mx-auto leading-relaxed">
              Welcome to your digital sanctuary. Every great reader starts with
              a single volume. Let's start curating your personal collection of
              thoughts, stories, and insights.
            </p>
            <p className="font-sans text-xs text-on-surface-variant/80 max-w-sm mx-auto leading-relaxed">
              Once cataloged, your books are beautifully organized into thematic
              constellations, and you unlock cozy, personalized curator
              recommendations powered by AI.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full justify-center pt-2">
            <Button
              className="w-full sm:w-auto h-11 px-6 font-sans text-sm font-semibold tracking-wide rounded-xl shadow-xs"
              onClick={() =>
                onAddBook ? onAddBook() : navigate(`/library/${library.id}/add`)
              }
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Catalog Your First Book
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto h-11 px-6 font-sans text-sm font-semibold tracking-wide border-outline-variant/50 hover:bg-surface-container-low rounded-xl"
              onClick={() => setCurrentTab('collection')}
            >
              Browse Empty Shelves
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
                    ? 'Active volumes in progress and daily literary curation'
                    : 'Personalized recommendations and category balance across your shelves'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
              {/* Left Column: Metrics & Categories */}
              <div className="md:col-span-4 flex flex-col gap-5">
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

              {/* Right Column: Currently Reading & AI Pick */}
              <div className="md:col-span-8 flex flex-col gap-5">
                {readingBooks.length > 0 &&
                  readingBooks.map(book => (
                    <div
                      key={`reading-${book.id}`}
                      className="bento-card p-5 sm:p-6 flex flex-col sm:flex-row gap-5 items-center sm:items-start"
                    >
                      <div
                        className="w-24 sm:w-28 mx-auto sm:mx-0 flex-shrink-0 relative group cursor-pointer"
                        onClick={() =>
                          navigate(`/library/${library.id}/book/${book.id}`, {
                            state: {
                              from: location.pathname + location.search,
                              bookList: readingBooks.map(b => b.id),
                            },
                          })
                        }
                      >
                        {book.coverUrl ? (
                          <img
                            alt={book.title}
                            className="relative w-full h-auto object-cover rounded-lg book-cover-shadow border border-outline-variant/50 z-10 aspect-[2/3]"
                            src={book.coverUrl}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <div className="relative w-full h-36 bg-surface-container rounded-lg book-cover-shadow border border-outline-variant/50 z-10 flex items-center justify-center p-2 text-center">
                            <span className="font-serif text-xs font-semibold text-on-surface-variant">
                              {book.title}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex-grow min-w-0 w-full text-center sm:text-left break-words">
                        <span className="metadata-eyebrow block">
                          Currently Reading
                        </span>
                        <h3 className="font-serif text-xl sm:text-2xl font-semibold tracking-tight text-primary mt-1 mb-0.5 line-clamp-2">
                          {toTitleCase(book.title)}
                        </h3>
                        <p className="font-sans text-xs sm:text-sm text-on-surface-variant mb-4">
                          {toTitleCase(book.author)}
                        </p>
                        <div className="flex justify-center sm:justify-start">
                          <Button
                            size="sm"
                            className="min-h-[38px] px-4 rounded-lg font-sans text-xs"
                            onClick={() =>
                              navigate(
                                `/library/${library.id}/book/${book.id}`,
                                {
                                  state: {
                                    from: location.pathname + location.search,
                                    bookList: readingBooks.map(b => b.id),
                                  },
                                },
                              )
                            }
                          >
                            View Book Details
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}

                {/* AI Curator's Pick */}
                <CuratorPickCard
                  pickOfTheDay={pickOfTheDay}
                  isGeneratingPick={isGeneratingPick}
                  generateNewPick={generateNewPick}
                  pickError={pickError}
                />
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
                    Recent acquisitions and cataloged editions
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentTab('collection')}
                  className="text-xs font-sans font-semibold text-primary hover:text-primary/80 flex items-center gap-1 group h-auto px-2.5 py-1.5"
                >
                  <span>Browse All {books.length} Books</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </Button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-4">
                {recentBooks.map(book => (
                  <div
                    key={book.id}
                    onClick={() =>
                      navigate(`/library/${library.id}/book/${book.id}`, {
                        state: {
                          from: location.pathname + location.search,
                          bookList: books.map(b => b.id),
                        },
                      })
                    }
                    className="group flex flex-col p-3 bento-card-interactive cursor-pointer"
                  >
                    <div className="relative aspect-[2/3] w-full rounded-lg overflow-hidden bg-surface-container mb-2.5 border border-outline-variant/50 book-cover-shadow group-hover:scale-[1.02] transition-transform">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full p-2.5 flex flex-col justify-between text-center bg-surface-container">
                          <span className="font-serif text-xs font-semibold text-on-surface line-clamp-3">
                            {book.title}
                          </span>
                          <span className="font-label-caps-xs text-label-caps-xs text-on-surface-variant/80 truncate">
                            {book.author}
                          </span>
                        </div>
                      )}
                    </div>
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
            subtitle="Immersive perspectives across history, geography, and theme"
            ariaLabel="Explore Collection Visualizers"
          />
        </div>
      )}
    </motion.div>
  );
};
