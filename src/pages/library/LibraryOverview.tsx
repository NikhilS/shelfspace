import React, {useMemo} from 'react';
import {motion} from 'motion/react';
import {Book, Library} from '../../types';
import {Book as BookIcon, Sparkles, RefreshCw, Loader2} from 'lucide-react';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import {toTitleCase, getFirestoreTime} from '../../lib/utils';
import {useNavigate, useLocation} from 'react-router-dom';

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
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const topCategories = useMemo(() => {
    const counts: Record<string, number> = {};
    books.forEach(b => {
      if (b.genres && Array.isArray(b.genres)) {
        b.genres.forEach(g => {
          counts[g] = (counts[g] || 0) + 1;
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
    return new Date(latestTime).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [books]);

  return (
    <motion.div
      initial={{opacity: 0, y: 10}}
      animate={{opacity: 1, y: 0}}
      transition={{duration: 0.4, ease: 'easeOut'}}
      className="flex-grow p-4 sm:p-8 lg:p-12 w-full max-w-screen-2xl mx-auto"
    >
      <header className="mb-12 relative">
        <div className="absolute -top-6 left-0 w-16 h-[2px] bg-primary/20"></div>
        <h2 className="font-serif text-[48px] sm:text-[64px] font-medium leading-[0.95] tracking-tight text-primary mb-4 italic">
          Library Overview
        </h2>
        <p className="font-body-lg text-[18px] sm:text-[20px] text-on-surface-variant max-w-2xl text-balance">
          Your personal catalog of wisdom and narratives.
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        <div className="md:col-span-4 flex flex-col gap-6">
          <div
            onClick={() => setCurrentTab('collection')}
            className="bg-surface-container-low p-6 shadow-[0_4px_24px_rgba(26,47,75,0.04)] overflow-hidden group cursor-pointer hover:bg-surface-container transition-colors flex flex-col"
          >
            <div className="flex items-center justify-between mb-2">
              <p className="font-label-caps text-label-caps text-secondary uppercase tracking-widest">
                Total Volumes
              </p>
              <BookIcon className="w-6 h-6 text-primary/40 group-hover:text-primary/60 transition-colors" />
            </div>
            <div className="flex items-baseline gap-2">
              <span className="font-headline-xl text-[56px] leading-none text-primary">
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
            <p className="font-label-caps text-label-caps text-secondary uppercase tracking-widest mb-6 text-left">
              Top Categories
            </p>
            <div
              className="w-full flex-grow flex items-center justify-center"
              style={{minHeight: '320px', height: '320px'}}
            >
              {topCategories.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={topCategories}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      isAnimationActive={false}
                      onClick={data => {
                        if (data?.name) {
                          setFilterGenre(data.name);
                          setCurrentTab('collection');
                          setIsFiltersOpen(true);
                        }
                      }}
                      className="cursor-pointer outline-none"
                    >
                      {topCategories.map((_, index) => (
                        <Cell
                          key={`cell-${index}`}
                          fill={
                            [
                              '#2f4d40',
                              '#7d5633',
                              '#021a35',
                              '#8397b8',
                              '#a3a099',
                              '#8a7122',
                              '#82312a',
                            ][index % 7]
                          }
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor:
                          'var(--color-surface-container-high, #fff)',
                        border: '1px solid var(--color-surface-variant, #ccc)',
                        borderRadius: '4px',
                        color: 'var(--color-on-surface, #000)',
                      }}
                      itemStyle={{color: 'var(--color-on-surface, #000)'}}
                    />
                    <Legend
                      verticalAlign="bottom"
                      wrapperStyle={{fontSize: '12px', paddingTop: '10px'}}
                      iconType="circle"
                    />
                  </PieChart>
                </ResponsiveContainer>
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
                className="bg-surface-container-lowest p-8 shadow-[0_8px_32px_rgba(26,47,75,0.06)] border border-surface-variant flex flex-col md:flex-row gap-8 items-center"
              >
                <div
                  className="w-32 md:w-40 flex-shrink-0 relative group cursor-pointer"
                  onClick={() =>
                    navigate(`/library/${library.id}/book/${book.id}`, {
                      state: {from: location.pathname + location.search},
                    })
                  }
                >
                  <div className="absolute inset-0 bg-primary/10 -rotate-3 transform rounded-sm shadow-md"></div>
                  {book.coverUrl ? (
                    <img
                      alt={book.title}
                      className="relative w-full h-auto object-cover rounded-sm shadow-lg border border-outline-variant/20 z-10 aspect-[2/3]"
                      src={book.coverUrl}
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
                  <h4 className="font-label-caps text-label-caps text-primary border border-primary/20 uppercase tracking-widest bg-primary/5 px-3 py-1.5 rounded-sm inline-block shadow-sm">
                    Currently Reading
                  </h4>
                  <h3 className="font-headline-lg text-headline-lg text-primary mt-3 mb-1 line-clamp-2">
                    {toTitleCase(book.title)}
                  </h3>
                  <p className="font-body-lg text-body-lg text-on-surface-variant italic mb-6">
                    {toTitleCase(book.author)}
                  </p>
                  <div className="mt-auto flex justify-end">
                    <button
                      onClick={() =>
                        navigate(`/library/${library.id}/book/${book.id}`, {
                          state: {from: location.pathname + location.search},
                        })
                      }
                      className="px-6 py-2 bg-primary text-on-primary font-body-md font-medium rounded hover:bg-primary/90 transition-colors shadow-sm"
                    >
                      View Details
                    </button>
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="bg-surface-container-lowest p-8 shadow-[0_8px_32px_rgba(26,47,75,0.06)] border border-surface-variant flex flex-col gap-4 justify-center items-center text-center">
              <BookIcon className="w-12 h-12 text-on-surface-variant opacity-70" />
              <p className="font-body-lg text-on-surface-variant">
                You aren't currently reading any books in this library.
              </p>
              <button
                onClick={() => setCurrentTab('collection')}
                className="px-6 py-2 bg-primary text-on-primary font-body-md font-medium rounded hover:bg-primary/90 transition-colors shadow-sm"
              >
                Browse Collection
              </button>
            </div>
          )}
          <div className="bg-gradient-to-br from-surface-container-low to-surface border border-outline-variant/30 p-8 relative overflow-hidden min-h-[220px] flex items-center">
            <div className="absolute top-6 right-6 text-[#A8C7FA] opacity-50">
              <Sparkles size={32} />
            </div>
            <button
              onClick={() => generateNewPick()}
              className="absolute top-4 left-4 p-2 text-on-surface-variant hover:text-primary hover:bg-surface-container rounded-full transition-colors z-20"
              title="Get another recommendation"
            >
              <RefreshCw size={20} />
            </button>
            {isGeneratingPick ? (
              <div className="w-full flex flex-col items-center justify-center gap-4 py-8">
                <Loader2 className="animate-spin text-primary" size={32} />
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
                    />
                  ) : (
                    <div className="w-full h-36 bg-surface-variant rounded-sm shadow-md border border-outline-variant/20 flex items-center justify-center p-2 text-center text-xs font-serif text-on-surface-variant">
                      {pickOfTheDay.title}
                    </div>
                  )}
                </div>
                <div className="flex flex-col justify-center flex-1">
                  <h4 className="font-label-caps text-label-caps text-primary border border-primary/20 uppercase tracking-widest flex items-center gap-2 bg-primary/5 px-3 py-1.5 rounded-sm shadow-sm w-fit">
                    <Sparkles size={16} />
                    Curator's Pick
                  </h4>
                  <h3 className="font-headline-md text-headline-md text-primary mt-4 mb-1">
                    {toTitleCase(pickOfTheDay.title)}
                  </h3>
                  <p className="font-body-md text-on-surface-variant italic mb-4">
                    {toTitleCase(pickOfTheDay.author)}
                  </p>
                  <div className="border-l-2 border-secondary/30 pl-4 py-1 pr-8">
                    <p className="font-body-md text-body-md text-on-surface leading-relaxed">
                      "{pickOfTheDay.reason}"
                    </p>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
