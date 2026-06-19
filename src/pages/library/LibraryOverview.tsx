import React, {useMemo} from 'react';
import {motion} from 'motion/react';
import {Book, Library} from '../../types';
import {Book as BookIcon, Sparkles, RefreshCw} from 'lucide-react';
import {toTitleCase, getFirestoreTime} from '../../lib/utils';
import {useNavigate, useLocation} from 'react-router-dom';
import {Button} from '@/components/ui/button';
import {BookLoader} from '../../components/BookLoader';
import {format} from 'date-fns';

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
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const topCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    books.forEach(b => {
      if (b.genres && Array.isArray(b.genres)) {
        const countedForBook = new Set<string>();
        b.genres.forEach(g => {
          if (!g) return;
          const segments = g.split('/');
          if (segments.length > 0) {
            const rootCategory = toTitleCase(segments[0].trim());
            if (rootCategory && !countedForBook.has(rootCategory)) {
              countedForBook.add(rootCategory);
              counts[rootCategory] = (counts[rootCategory] || 0) + 1;
            }
          }
        });
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 7)
      .map(([name, value]) => ({name, value}));
  }, [books]);

  const readingBooks = useMemo(() => {
    if (!user) return [];
    return books
      .filter(b => b.userStatuses?.[user.uid] === 'reading')
      .slice(0, 2);
  }, [books, user]);

  const lastCatalogedDate = useMemo(() => {
    if (books.length === 0) return 'Never';
    const latestTime = Math.max(...books.map(b => getFirestoreTime(b.addedAt)));
    if (latestTime <= 0) return 'Unknown';
    return format(new Date(latestTime), 'MMM d, yyyy');
  }, [books]);

  return (
    <motion.div
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.4, ease: 'easeOut'}}
      className="layout-page-content"
    >
      {books.length === 0 ? (
        <div className="max-w-xl mx-auto py-16 px-8 text-center flex flex-col items-center gap-8 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-elevation-3 mt-8">
          <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-secondary-container/10 text-secondary">
            <BookIcon className="w-9 h-9 text-secondary" />
            <motion.div
              animate={{rotate: 360}}
              transition={{repeat: Infinity, duration: 24, ease: 'linear'}}
              className="absolute inset-0 border border-dashed border-secondary/30 rounded-full"
            />
            <Sparkles className="absolute -top-1 -right-1 w-5 h-5 text-secondary animate-pulse" />
          </div>

          <div className="space-y-3">
            <h2 className="font-serif text-3xl font-bold tracking-tight text-primary">
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
              className="w-full sm:w-auto h-11 px-6 font-sans text-sm font-semibold tracking-wide"
              onClick={() => navigate(`/library/${library.id}/add`)}
            >
              Catalog Your First Book
            </Button>
            <Button
              variant="outline"
              className="w-full sm:w-auto h-11 px-6 font-sans text-sm font-semibold tracking-wide border-outline-variant/50 hover:bg-surface-container-low"
              onClick={() => setCurrentTab('collection')}
            >
              Browse Empty Shelves
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-4 flex flex-col gap-6">
            <div
              onClick={() => setCurrentTab('collection')}
              className="bg-surface-container-low p-6 shadow-elevation-2 overflow-hidden group cursor-pointer hover:bg-surface-container transition-colors flex flex-col"
            >
              <div className="flex items-center justify-between mb-2">
                <p className="font-label-caps text-label-caps text-secondary">
                  Total Volumes
                </p>
                <BookIcon className="w-6 h-6 text-primary/40 group-hover:text-primary/60 transition-colors" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-headline-2xl text-headline-2xl text-primary">
                  {books.length}
                </span>
                <span className="font-body-md text-on-surface-variant">
                  books
                </span>
              </div>
              <div className="mt-4 pt-4 border-t border-outline-variant/30 flex justify-between items-center">
                <span className="font-body-md text-sm text-on-surface-variant">
                  Last Cataloged
                </span>
                <span className="font-body-md text-sm font-medium text-primary">
                  {lastCatalogedDate}
                </span>
              </div>
            </div>
            <div className="bg-surface p-6 border border-surface-variant relative shadow-sm flex flex-col min-w-0">
              <p className="font-label-caps text-label-caps text-secondary mb-6 text-left">
                Top Categories
              </p>
              <div
                className="w-full flex-grow flex flex-col"
                style={{minHeight: '320px'}}
              >
                {topCategories.length > 0 ? (
                  <div className="flex flex-col gap-4 justify-center h-full pt-2">
                    {topCategories.map(category => {
                      const maxCount = Math.max(
                        ...topCategories.map(c => c.value),
                      );
                      const widthPercent = Math.max(
                        2,
                        (category.value / maxCount) * 100,
                      );

                      return (
                        <div
                          key={category.name}
                          className="group flex flex-col gap-2 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm p-1 -m-1"
                          onClick={() => {
                            if (selectGenreAndGoToCollection) {
                              selectGenreAndGoToCollection(category.name);
                            } else {
                              setFilterGenre(category.name);
                              setCurrentTab('collection');
                              setIsFiltersOpen(true);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              if (selectGenreAndGoToCollection) {
                                selectGenreAndGoToCollection(category.name);
                              } else {
                                setFilterGenre(category.name);
                                setCurrentTab('collection');
                                setIsFiltersOpen(true);
                              }
                            }
                          }}
                        >
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-sans text-sm font-semibold text-primary group-hover:text-secondary group-focus-visible:text-secondary transition-colors">
                              {category.name || 'Uncategorized'}
                            </span>
                            <span className="font-sans text-xs font-bold text-on-surface-variant group-hover:text-secondary group-focus-visible:text-secondary transition-colors uppercase tracking-wider">
                              {category.value}{' '}
                              {category.value === 1 ? 'vol' : 'vols'}
                            </span>
                          </div>
                          <div className="w-full h-1.5 bg-outline-variant/20 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-secondary/40 group-hover:bg-secondary group-focus-visible:bg-secondary transition-colors duration-300"
                              style={{width: `${widthPercent}%`}}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center">
                    <p className="font-body-md text-on-surface-variant italic">
                      No categories found yet.
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="md:col-span-8 flex flex-col gap-6">
            {readingBooks.length > 0 ? (
              readingBooks.map(book => (
                <div
                  key={`reading-${book.id}`}
                  className="bg-surface-container-lowest p-8 shadow-elevation-3 border border-surface-variant flex flex-col md:flex-row gap-8 items-center"
                >
                  <div
                    className="w-32 md:w-40 flex-shrink-0 relative group cursor-pointer"
                    onClick={() =>
                      navigate(`/library/${library.id}/book/${book.id}`, {
                        state: {
                          from: location.pathname + location.search,
                          bookList: readingBooks.map(b => b.id),
                        },
                      })
                    }
                  >
                    <div className="absolute inset-0 bg-primary/10 -rotate-3 transform rounded-sm shadow-md"></div>
                    {book.coverUrl ? (
                      <img
                        alt={book.title}
                        className="relative w-full h-auto object-cover rounded-sm shadow-lg border border-outline-variant/20 z-10 aspect-[2/3]"
                        src={book.coverUrl}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="relative w-full h-48 sm:h-56 bg-surface-variant rounded-sm shadow-lg border border-outline-variant/20 z-10 flex items-center justify-center p-4 text-center">
                        <span className="font-serif text-sm font-bold text-on-surface-variant font-headline-md">
                          {book.title}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex-grow w-full">
                    <span className="font-label-caps text-label-caps text-secondary block">
                      Currently Reading
                    </span>
                    <h3 className="font-headline-lg text-headline-lg text-primary mt-2 mb-1 line-clamp-2">
                      {toTitleCase(book.title)}
                    </h3>
                    <p className="font-sans text-sm text-on-surface-variant mb-6">
                      {toTitleCase(book.author)}
                    </p>
                    <div className="mt-auto flex justify-end">
                      <Button
                        onClick={() =>
                          navigate(`/library/${library.id}/book/${book.id}`, {
                            state: {
                              from: location.pathname + location.search,
                              bookList: readingBooks.map(b => b.id),
                            },
                          })
                        }
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <div className="bg-surface-container-lowest p-8 shadow-elevation-3 border border-surface-variant flex flex-col gap-4 justify-center items-center text-center">
                <BookIcon className="w-12 h-12 text-on-surface-variant opacity-70" />
                <p className="font-body-lg text-on-surface-variant">
                  No active reads in this library. Found something good on your
                  shelf? Mark it as "Reading" to get cozy and start tracking!
                </p>
                <Button onClick={() => setCurrentTab('collection')}>
                  Explore My Books
                </Button>
              </div>
            )}
            <div className="bg-gradient-to-br from-surface-container-low to-surface border border-outline-variant/30 p-8 relative overflow-hidden min-h-[220px] flex items-center">
              <div className="absolute top-6 right-6 text-secondary/30">
                <Sparkles size={32} />
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => generateNewPick()}
                className="absolute top-4 left-4 z-20 hover:bg-surface-container text-on-surface-variant hover:text-primary"
                title="Get another recommendation"
              >
                <RefreshCw size={20} />
              </Button>
              {isGeneratingPick ? (
                <div className="w-full flex flex-col items-center justify-center gap-4 py-8">
                  <BookLoader size="md" />
                  <p className="font-body-md text-on-surface-variant animate-pulse">
                    Curating your pick of the day...
                  </p>
                </div>
              ) : pickOfTheDay ? (
                <div className="flex flex-col md:flex-row gap-8 w-full z-10 relative">
                  <div className="w-24 md:w-32 flex-shrink-0 mt-10 md:mt-8 z-0">
                    {pickOfTheDay.coverUrl ? (
                      <img
                        alt="Book Cover"
                        className="w-full h-auto object-cover rounded-sm shadow-md border border-outline-variant/20 aspect-[2/3]"
                        src={pickOfTheDay.coverUrl}
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-36 bg-surface-variant rounded-sm shadow-md border border-outline-variant/20 flex items-center justify-center p-2 text-center text-xs font-serif text-on-surface-variant">
                        {pickOfTheDay.title}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col justify-center flex-1">
                    <span className="font-label-caps text-label-caps text-secondary flex items-center gap-1.5 mb-2">
                      <Sparkles size={14} className="text-secondary/80" />
                      Curator's Pick
                    </span>
                    <h3 className="font-headline-md text-headline-md text-primary mt-1 mb-1">
                      {toTitleCase(pickOfTheDay.title)}
                    </h3>
                    <p className="font-sans text-sm text-on-surface-variant mb-4">
                      {toTitleCase(pickOfTheDay.author)}
                    </p>
                    <div className="border-l-2 border-secondary/30 pl-4 py-1 pr-8">
                      <p className="font-body-md text-body-md text-on-surface leading-relaxed">
                        "{pickOfTheDay.reason}"
                      </p>
                    </div>
                  </div>
                </div>
              ) : pickError ? (
                <div className="w-full flex flex-col items-center justify-center gap-4 py-8 text-center z-10 relative px-6">
                  <div className="space-y-1">
                    <p className="font-serif text-lg font-bold text-accent">
                      AI Curator Snoozing
                    </p>
                    <p className="font-body-md text-on-surface-variant max-w-md">
                      {pickError.includes('GEMINI_API_KEY') ||
                      pickError.includes('API key') ||
                      pickError.includes('key not valid') ||
                      pickError.includes('API_KEY_INVALID')
                        ? 'AI recommendations need a GEMINI_API_KEY. Set it in Settings > Secrets (top-right corner) to get started!'
                        : `Something went wrong: ${pickError}`}
                    </p>
                  </div>
                  <Button
                    onClick={() => generateNewPick()}
                    variant="outline"
                    size="sm"
                    className="gap-2 bg-surface hover:bg-surface-container border-outline/30"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Try Again
                  </Button>
                </div>
              ) : (
                <div className="w-full flex flex-col items-center justify-center gap-4 py-8 text-center z-10 relative px-6">
                  <div className="space-y-1">
                    <p className="font-serif text-lg font-bold text-primary">
                      Discover Your Next Read
                    </p>
                    <p className="font-body-md text-on-surface-variant max-w-md">
                      Need inspiration? Ensure your GEMINI_API_KEY is configured
                      in Settings &gt; Secrets, then click below to let our AI
                      curator pick a book for you.
                    </p>
                  </div>
                  <Button
                    onClick={() => generateNewPick()}
                    variant="outline"
                    size="sm"
                    className="gap-2 bg-surface hover:bg-surface-container"
                  >
                    <RefreshCw className="w-4 h-4 animate-spin-slow" />
                    Surprise Me
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
};
