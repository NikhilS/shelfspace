import React, {useMemo} from 'react';
import {motion} from 'motion/react';
import {Book, Library} from '../../types';
import {
  Book as BookIcon,
  Sparkles,
  RefreshCw,
  Plus,
  BookOpen,
  Clock,
  Globe,
  Compass,
  ArrowRight,
} from 'lucide-react';
import {toTitleCase, getFirestoreTime} from '../../lib/utils';
import {useNavigate, useLocation, Link} from 'react-router-dom';
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
      if (b.primaryGenre) {
        counts[b.primaryGenre] = (counts[b.primaryGenre] || 0) + 1;
      }
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({name, value}));
  }, [books]);

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

  const missingMetadataCount = useMemo(() => {
    return books.filter(b => !b.coverUrl || !b.primaryGenre).length;
  }, [books]);

  const temporalBooksCount = useMemo(() => {
    return books.filter(
      b =>
        b.temporalMetadata?.startYear !== undefined ||
        (b.publishedDate && b.publishedDate.length >= 4),
    ).length;
  }, [books]);

  const geoLocationsCount = useMemo(() => {
    let count = 0;
    books.forEach(b => {
      if (b.geoMetadata?.locations?.length) {
        count += b.geoMetadata.locations.length;
      }
    });
    return count;
  }, [books]);

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
      transition={{duration: 0.35, ease: 'easeOut'}}
      className="layout-page-content space-y-10"
    >
      {books.length === 0 ? (
        /* Empty State */
        <div className="max-w-xl mx-auto py-16 px-8 text-center flex flex-col items-center gap-8 bg-surface-container-lowest border border-outline-variant/30 rounded-2xl shadow-elevation-2 mt-4">
          <div className="relative flex items-center justify-center w-20 h-20 rounded-full bg-secondary-container/15 text-secondary">
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
              className="w-full sm:w-auto h-11 px-6 font-sans text-sm font-semibold tracking-wide rounded-xl shadow-xs"
              onClick={() => navigate(`/library/${library.id}/add`)}
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
          {/* Library Digest Ribbon */}
          <section aria-label="Library Overview Digest">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-surface-container-low/70 border border-outline-variant/30 text-xs font-sans text-on-surface-variant">
              <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                <span className="flex items-center gap-1.5 text-on-surface">
                  <BookOpen className="w-3.5 h-3.5 text-primary" />
                  <span>
                    <strong className="font-semibold text-primary">
                      {books.length}
                    </strong>{' '}
                    {books.length === 1 ? 'Volume' : 'Volumes'} Cataloged
                  </span>
                </span>
                {topCategories.length > 0 && (
                  <>
                    <span className="hidden sm:inline text-outline-variant/60">
                      •
                    </span>
                    <span className="hidden sm:flex items-center gap-1">
                      <span>Primary Genre:</span>
                      <strong className="font-semibold text-on-surface">
                        {topCategories[0].name}
                      </strong>
                    </span>
                  </>
                )}
                {readingBooks.length > 0 && (
                  <>
                    <span className="text-outline-variant/60">•</span>
                    <span className="flex items-center gap-1 text-secondary font-medium">
                      <span>
                        {readingBooks.length} Active Read
                        {readingBooks.length === 1 ? '' : 's'}
                      </span>
                    </span>
                  </>
                )}
              </div>

              <div className="flex items-center gap-3 ml-auto sm:ml-0 text-[11px]">
                {missingMetadataCount > 0 ? (
                  <Link
                    to={`/library/${library.id}/spruce-up`}
                    className="flex items-center gap-1 text-accent hover:underline font-medium"
                    title="Audit metadata and cover health"
                  >
                    <span>{missingMetadataCount} need cover/genre care</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                ) : (
                  <span className="text-secondary font-medium flex items-center gap-1">
                    <span>Shelf metadata complete</span>
                  </span>
                )}
              </div>
            </div>
          </section>

          {/* Tier 1: Personal & Active (The "Now") - Reading Pulse & Curator Spotlight */}
          <section aria-label="Reading Pulse and Categories">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-on-surface">
                  {readingBooks.length > 0
                    ? 'Reading Pulse'
                    : "Curator's Spotlight"}
                </h2>
                <p className="font-sans text-xs sm:text-sm text-on-surface-variant">
                  {readingBooks.length > 0
                    ? 'Active volumes in progress and daily literary curation'
                    : 'Personalized recommendations and category balance across your shelves'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5 sm:gap-6">
              {/* Left Column: Metrics & Categories */}
              <div className="md:col-span-4 flex flex-col gap-5">
                <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-outline-variant/30 shadow-xs flex flex-col min-w-0">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-xs font-sans font-semibold tracking-wider uppercase text-secondary/90">
                      Top Categories
                    </p>
                    <span className="text-[11px] font-sans text-on-surface-variant">
                      Last added: {lastCatalogedDate}
                    </span>
                  </div>

                  <div className="w-full flex-grow flex flex-col min-h-[160px]">
                    {topCategories.length > 0 ? (
                      <div className="flex flex-col gap-3 justify-center h-full pt-1">
                        {topCategories.map(category => {
                          const maxCount = Math.max(
                            ...topCategories.map(c => c.value),
                          );
                          const widthPercent = Math.max(
                            4,
                            (category.value / maxCount) * 100,
                          );

                          return (
                            <div
                              key={category.name}
                              className="group flex flex-col gap-1 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm p-1 -m-1"
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
                              <div className="flex items-center justify-between text-xs">
                                <span className="font-sans font-semibold text-primary group-hover:text-secondary transition-colors truncate pr-2">
                                  {category.name || 'Uncategorized'}
                                </span>
                                <span className="font-sans font-bold text-on-surface-variant group-hover:text-secondary transition-colors uppercase tracking-wider flex-shrink-0 text-[10px]">
                                  {category.value}{' '}
                                  {category.value === 1 ? 'vol' : 'vols'}
                                </span>
                              </div>
                              <div className="w-full h-1.5 bg-outline-variant/20 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-secondary/40 group-hover:bg-secondary transition-colors duration-300"
                                  style={{width: `${widthPercent}%`}}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="flex h-full items-center justify-center py-6">
                        <p className="font-sans text-xs text-on-surface-variant italic">
                          No categories categorized yet.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Currently Reading & AI Pick */}
              <div className="md:col-span-8 flex flex-col gap-5">
                {readingBooks.length > 0 &&
                  readingBooks.map(book => (
                    <div
                      key={`reading-${book.id}`}
                      className="bg-surface-container-lowest p-5 sm:p-6 rounded-2xl shadow-xs border border-outline-variant/30 flex flex-col sm:flex-row gap-5 items-center sm:items-start"
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
                        <div className="absolute inset-0 bg-primary/10 -rotate-2 transform rounded-sm shadow-xs"></div>
                        {book.coverUrl ? (
                          <img
                            alt={book.title}
                            className="relative w-full h-auto object-cover rounded-sm shadow-md border border-outline-variant/20 z-10 aspect-[2/3]"
                            src={book.coverUrl}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <div className="relative w-full h-36 bg-surface-variant rounded-sm shadow-md border border-outline-variant/20 z-10 flex items-center justify-center p-2 text-center">
                            <span className="font-serif text-xs font-bold text-on-surface-variant">
                              {book.title}
                            </span>
                          </div>
                        )}
                      </div>
                      <div className="flex-grow min-w-0 w-full text-center sm:text-left break-words">
                        <span className="text-[11px] font-sans font-semibold tracking-wider uppercase text-secondary/90 block">
                          Currently Reading
                        </span>
                        <h3 className="font-serif text-lg sm:text-xl font-bold tracking-tight text-primary mt-1 mb-0.5 line-clamp-2">
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
                <div className="bg-gradient-to-br from-surface-container-low to-surface border border-outline-variant/30 p-5 sm:p-6 rounded-2xl relative overflow-hidden min-h-[160px] flex items-center shadow-xs">
                  <div className="absolute top-4 right-4 text-secondary/30 pointer-events-none">
                    <Sparkles size={24} />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => generateNewPick()}
                    className="absolute top-3 left-3 z-20 hover:bg-surface-container text-on-surface-variant hover:text-primary w-8 h-8 rounded-lg"
                    title="Get another recommendation"
                  >
                    <RefreshCw size={15} />
                  </Button>
                  {isGeneratingPick ? (
                    <div className="w-full flex flex-col items-center justify-center gap-3 py-6">
                      <BookLoader size="sm" />
                      <p className="font-sans text-xs text-on-surface-variant animate-pulse">
                        Curating your pick of the day...
                      </p>
                    </div>
                  ) : pickOfTheDay ? (
                    <div className="flex flex-col sm:flex-row gap-4 sm:gap-5 w-full z-10 relative items-center sm:items-start pt-6 sm:pt-0">
                      <div className="w-20 sm:w-24 mx-auto sm:mx-0 flex-shrink-0 mt-1">
                        {pickOfTheDay.coverUrl ? (
                          <img
                            alt="Book Cover"
                            className="w-full h-auto object-cover rounded-sm shadow-md border border-outline-variant/20 aspect-[2/3]"
                            src={pickOfTheDay.coverUrl}
                            referrerPolicy="no-referrer"
                            loading="lazy"
                          />
                        ) : (
                          <div className="w-full h-28 bg-surface-variant rounded-sm shadow-md border border-outline-variant/20 flex items-center justify-center p-2 text-center text-[10px] font-serif text-on-surface-variant">
                            {pickOfTheDay.title}
                          </div>
                        )}
                      </div>
                      <div className="flex flex-col justify-center flex-1 min-w-0 text-center sm:text-left break-words">
                        <span className="text-[10px] font-sans font-semibold tracking-wider uppercase text-secondary/90 flex items-center justify-center sm:justify-start gap-1 mb-1">
                          <Sparkles size={13} className="text-secondary/80" />
                          Curator's Recommendation
                        </span>
                        <h3 className="font-serif text-base sm:text-lg font-bold tracking-tight text-primary line-clamp-1">
                          {toTitleCase(pickOfTheDay.title)}
                        </h3>
                        <p className="font-sans text-xs text-on-surface-variant mb-2">
                          {toTitleCase(pickOfTheDay.author)}
                        </p>
                        <div className="border-l-2 border-secondary/30 pl-3 py-0.5 text-left">
                          <p className="font-sans text-xs text-on-surface leading-relaxed italic">
                            "{pickOfTheDay.reason}"
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : pickError ? (
                    <div className="w-full flex flex-col items-center justify-center gap-3 py-6 text-center z-10 relative px-4">
                      <p className="font-serif text-sm font-bold text-accent">
                        AI Curator Unavailable
                      </p>
                      <p className="font-sans text-xs text-on-surface-variant max-w-sm">
                        {pickError.includes('GEMINI_API_KEY') ||
                        pickError.includes('API key') ||
                        pickError.includes('key not valid')
                          ? 'AI recommendations require a GEMINI_API_KEY set in server environment.'
                          : `Error: ${pickError}`}
                      </p>
                      <Button
                        onClick={() => generateNewPick()}
                        variant="outline"
                        size="sm"
                        className="gap-1.5 bg-surface text-xs min-h-[36px] px-3.5 rounded-lg"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Try Again
                      </Button>
                    </div>
                  ) : (
                    <div className="w-full flex flex-col items-center justify-center gap-2.5 py-6 text-center z-10 relative px-4">
                      <p className="font-serif text-base font-bold text-primary">
                        Curator's Pick
                      </p>
                      <p className="font-sans text-xs text-on-surface-variant max-w-sm">
                        Looking for something to read next? Let our AI curator
                        pick a volume from your shelf.
                      </p>
                      <Button
                        onClick={() => generateNewPick()}
                        variant="outline"
                        size="sm"
                        className="gap-2 bg-surface hover:bg-surface-container min-h-[38px] px-4 rounded-xl text-xs font-semibold"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-secondary" />
                        Surprise Me
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* Tier 2: The Physical Shelves (The "Collection") - Recent Additions */}
          {recentBooks.length > 0 && (
            <section aria-label="Recent Acquisitions">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="font-serif text-xl sm:text-2xl font-bold tracking-tight text-on-surface">
                    On the Shelves
                  </h2>
                  <p className="font-sans text-xs sm:text-sm text-on-surface-variant">
                    Recent acquisitions and cataloged editions
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentTab('collection')}
                  className="text-xs font-sans font-semibold text-primary hover:text-primary/80 flex items-center gap-1 group cursor-pointer"
                >
                  <span>Browse All {books.length} Books</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3.5">
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
                    className="group flex flex-col p-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/25 hover:border-primary/40 shadow-xs hover:shadow-elevation-1 transition-all cursor-pointer"
                  >
                    <div className="relative aspect-[2/3] w-full rounded-lg overflow-hidden bg-surface-container mb-2 border border-outline-variant/20 shadow-2xs group-hover:scale-[1.02] transition-transform">
                      {book.coverUrl ? (
                        <img
                          src={book.coverUrl}
                          alt={book.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="w-full h-full p-2 flex flex-col justify-between text-center bg-surface-variant">
                          <span className="text-[10px] font-serif font-bold text-on-surface-variant line-clamp-3">
                            {book.title}
                          </span>
                          <span className="text-[9px] font-sans text-on-surface-variant/70 truncate">
                            {book.author}
                          </span>
                        </div>
                      )}
                    </div>
                    <h4 className="font-serif text-xs font-bold text-on-surface truncate group-hover:text-primary transition-colors">
                      {toTitleCase(book.title)}
                    </h4>
                    <p className="font-sans text-[11px] text-on-surface-variant truncate mt-0.5">
                      {toTitleCase(book.author)}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Tier 3: Spatial & Thematic Perspectives (The "Exploration") */}
          <section aria-label="Explore Collection Visualizers">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-3.5">
              <div className="flex items-center gap-2">
                <Compass className="w-4 h-4 text-secondary stroke-[2.2]" />
                <h2 className="font-serif text-lg sm:text-xl font-bold tracking-tight text-on-surface">
                  Explore The Collection
                </h2>
                <span className="hidden sm:inline-flex text-[10px] font-sans font-semibold tracking-wider uppercase text-on-surface-variant/70 bg-surface-container-high/60 px-2 py-0.5 rounded-full border border-outline-variant/20">
                  3 Perspectives
                </span>
              </div>
              <p className="hidden md:block font-sans text-xs text-on-surface-variant">
                Immersive perspectives across history, geography, and theme
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* Option 1: Timeline */}
              <Link
                to={`/library/${library.id}/timeline`}
                className="group relative flex flex-col justify-between p-4 rounded-xl bg-gradient-to-br from-surface-container-lowest to-[#fbf8f2] dark:from-surface-container-low dark:to-[#221e17] border border-outline-variant/30 hover:border-secondary/50 shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden"
              >
                {/* Visual Watermark: Chronological axis with milestone ticks */}
                <svg
                  className="absolute -right-2 -bottom-2 w-36 h-20 text-secondary/10 dark:text-secondary/15 pointer-events-none group-hover:text-secondary/20 transition-colors"
                  viewBox="0 0 144 80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  aria-hidden="true"
                >
                  <line x1="8" y1="52" x2="136" y2="52" strokeDasharray="3 3" />
                  <circle cx="28" cy="52" r="3" fill="currentColor" />
                  <line x1="28" y1="42" x2="28" y2="62" />
                  <circle cx="76" cy="52" r="3.5" fill="currentColor" />
                  <line x1="76" y1="38" x2="76" y2="66" />
                  <circle cx="120" cy="52" r="3" fill="currentColor" />
                  <line x1="120" y1="42" x2="120" y2="62" />
                  <text
                    x="28"
                    y="74"
                    fontSize="7.5"
                    textAnchor="middle"
                    fill="currentColor"
                    fontFamily="serif"
                  >
                    1850
                  </text>
                  <text
                    x="76"
                    y="75"
                    fontSize="8"
                    textAnchor="middle"
                    fontWeight="bold"
                    fill="currentColor"
                    fontFamily="serif"
                  >
                    1920
                  </text>
                  <text
                    x="120"
                    y="74"
                    fontSize="7.5"
                    textAnchor="middle"
                    fill="currentColor"
                    fontFamily="serif"
                  >
                    2026
                  </text>
                </svg>

                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-secondary/15 text-secondary flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                        <Clock className="w-4 h-4" />
                      </div>
                      <h3 className="font-serif text-sm sm:text-base font-bold text-on-surface group-hover:text-secondary transition-colors truncate">
                        Historical Timeline
                      </h3>
                    </div>
                    <span className="text-[10px] font-sans font-medium text-secondary/90 bg-secondary/10 px-2 py-0.5 rounded-full border border-secondary/20 flex-shrink-0 whitespace-nowrap">
                      {temporalBooksCount > 0
                        ? `${temporalBooksCount} Charted`
                        : 'Chronology'}
                    </span>
                  </div>
                  <p className="font-sans text-xs text-on-surface-variant line-clamp-1 leading-snug">
                    Chronological epochs & publication eras
                  </p>
                </div>

                <div className="relative z-10 mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-xs font-sans font-medium text-secondary">
                  <span className="group-hover:underline">Launch Timeline</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>

              {/* Option 2: World Map */}
              <Link
                to={`/library/${library.id}/map`}
                className="group relative flex flex-col justify-between p-4 rounded-xl bg-gradient-to-br from-surface-container-lowest to-[#f3f7f5] dark:from-surface-container-low dark:to-[#17241e] border border-outline-variant/30 hover:border-tertiary-container-on/50 shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden"
              >
                {/* Visual Watermark: Cartographic coordinate arcs and globe curves */}
                <svg
                  className="absolute -right-2 -bottom-2 w-36 h-20 text-tertiary-container-on/15 dark:text-tertiary-fixed-base/15 pointer-events-none group-hover:text-tertiary-container-on/25 transition-colors"
                  viewBox="0 0 144 80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  aria-hidden="true"
                >
                  <circle
                    cx="108"
                    cy="46"
                    r="32"
                    strokeDasharray="2 3"
                    opacity="0.6"
                  />
                  <ellipse
                    cx="108"
                    cy="46"
                    rx="32"
                    ry="14"
                    strokeDasharray="3 3"
                    opacity="0.5"
                  />
                  <line
                    x1="108"
                    y1="14"
                    x2="108"
                    y2="78"
                    strokeDasharray="2 2"
                    opacity="0.5"
                  />
                  <circle cx="98" cy="40" r="2.5" fill="currentColor" />
                  <text
                    x="44"
                    y="68"
                    fontSize="7.5"
                    fill="currentColor"
                    fontFamily="monospace"
                    letterSpacing="0.05em"
                  >
                    41°N · 2°E
                  </text>
                </svg>

                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-tertiary-container/25 text-tertiary-container-on dark:text-tertiary-fixed-base flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                        <Globe className="w-4 h-4" />
                      </div>
                      <h3 className="font-serif text-sm sm:text-base font-bold text-on-surface group-hover:text-primary transition-colors truncate">
                        Literary World Map
                      </h3>
                    </div>
                    <span className="text-[10px] font-sans font-medium text-tertiary-fixed-variant-on dark:text-tertiary-fixed-base bg-tertiary-fixed-base/30 px-2 py-0.5 rounded-full border border-tertiary-fixed-dim-base/40 flex-shrink-0 whitespace-nowrap">
                      {geoLocationsCount > 0
                        ? `${geoLocationsCount} Places`
                        : 'Cartography'}
                    </span>
                  </div>
                  <p className="font-sans text-xs text-on-surface-variant line-clamp-1 leading-snug">
                    Story settings & global author origins
                  </p>
                </div>

                <div className="relative z-10 mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-xs font-sans font-medium text-primary">
                  <span className="group-hover:underline">Open World Map</span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>

              {/* Option 3: Constellation Map */}
              <Link
                to={`/library/${library.id}/constellation`}
                className="group relative flex flex-col justify-between p-4 rounded-xl bg-gradient-to-br from-surface-container-lowest to-[#f1f4fb] dark:from-surface-container-low dark:to-[#171f2b] border border-outline-variant/30 hover:border-primary/50 shadow-2xs hover:shadow-xs transition-all duration-200 overflow-hidden"
              >
                {/* Visual Watermark: Stellar cluster with connected nodes & orbital arc */}
                <svg
                  className="absolute -right-2 -bottom-2 w-36 h-20 text-primary/15 dark:text-primary-inverse/20 pointer-events-none group-hover:text-primary/25 transition-colors"
                  viewBox="0 0 144 80"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  aria-hidden="true"
                >
                  <line x1="48" y1="58" x2="78" y2="34" strokeDasharray="3 2" />
                  <line
                    x1="78"
                    y1="34"
                    x2="114"
                    y2="48"
                    strokeDasharray="3 2"
                  />
                  <line x1="78" y1="34" x2="96" y2="18" strokeDasharray="3 2" />
                  <line
                    x1="114"
                    y1="48"
                    x2="132"
                    y2="62"
                    strokeDasharray="3 2"
                  />
                  <circle cx="48" cy="58" r="2.5" fill="currentColor" />
                  <circle cx="78" cy="34" r="3.5" fill="currentColor" />
                  <circle cx="96" cy="18" r="2" fill="currentColor" />
                  <circle cx="114" cy="48" r="3" fill="currentColor" />
                  <circle cx="132" cy="62" r="2.5" fill="currentColor" />
                  <ellipse
                    cx="92"
                    cy="40"
                    rx="36"
                    ry="18"
                    strokeDasharray="2 4"
                    opacity="0.4"
                  />
                </svg>

                <div className="relative z-10">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:scale-105 transition-transform flex-shrink-0">
                        <Sparkles className="w-4 h-4" />
                      </div>
                      <h3 className="font-serif text-sm sm:text-base font-bold text-on-surface group-hover:text-primary transition-colors truncate">
                        Thematic Constellations
                      </h3>
                    </div>
                    <span className="text-[10px] font-sans font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20 flex-shrink-0 whitespace-nowrap">
                      {topCategories.length > 0
                        ? `${topCategories.length} Genres`
                        : '3D Galaxy'}
                    </span>
                  </div>
                  <p className="font-sans text-xs text-on-surface-variant line-clamp-1 leading-snug">
                    3D celestial cluster mapped by genre & theme
                  </p>
                </div>

                <div className="relative z-10 mt-3 pt-2.5 border-t border-outline-variant/15 flex items-center justify-between text-xs font-sans font-medium text-primary">
                  <span className="group-hover:underline">
                    Explore Constellation
                  </span>
                  <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                </div>
              </Link>
            </div>
          </section>
        </div>
      )}
    </motion.div>
  );
};
