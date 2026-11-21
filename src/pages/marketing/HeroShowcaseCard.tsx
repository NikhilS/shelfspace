import React, {useState} from 'react';
import {motion} from 'motion/react';
import {
  BookOpen,
  Library,
  Sparkles,
  Plus,
  Compass,
  Globe,
  Clock,
  Check,
  Search,
  BarChart3,
} from 'lucide-react';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';

type PreviewTab = 'reading' | 'shelf';

const CURRENTLY_READING_BOOKS = [
  {
    title: 'Piranesi',
    author: 'Susanna Clarke',
    year: '2020',
    context: 'Personal Reading Shelf',
    isOwned: false,
  },
  {
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    year: '1969',
    context: 'Owned · Living Room',
    isOwned: true,
  },
];

const STACK_SPINES = [
  {
    title: 'Invisible Cities',
    author: 'I. Calvino',
    color: 'bg-[#292524] text-[#faf7f2]',
    width: 'w-[88%]',
  },
  {
    title: 'Project Hail Mary',
    author: 'A. Weir',
    color: 'bg-[#7c2d12] text-[#ffedd5]',
    width: 'w-[94%]',
  },
  {
    title: 'Station Eleven',
    author: 'E. St. John Mandel',
    color: 'bg-[#44403c] text-[#f5f2eb]',
    width: 'w-[84%]',
  },
  {
    title: 'Dune',
    author: 'F. Herbert',
    color: 'bg-[#1c1917] text-[#faf7f2]',
    width: 'w-[96%]',
  },
  {
    title: 'The Overstory',
    author: 'R. Powers',
    color: 'bg-[#ece5d8] text-[#1c1917] border border-outline-variant/60',
    width: 'w-[91%]',
  },
];

const SHELF_BOOKS = [
  {
    title: 'Dune',
    author: 'Frank Herbert',
    year: '1965',
    genre: 'Sci-Fi',
    status: 'Read',
  },
  {
    title: 'Invisible Cities',
    author: 'Italo Calvino',
    year: '1972',
    genre: 'Literary',
    status: 'Read',
  },
  {
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    year: '1969',
    genre: 'Sci-Fi',
    status: 'Reading',
  },
  {
    title: 'Pachinko',
    author: 'Min Jin Lee',
    year: '2017',
    genre: 'Historical',
    status: 'Want to Read',
  },
];

const TAB_SPRING = {
  type: 'spring' as const,
  stiffness: 480,
  damping: 36,
};

export function HeroShowcaseCard() {
  const [activeTab, setActiveTab] = useState<PreviewTab>('reading');

  return (
    <div
      className="w-full max-w-5xl mx-auto mt-10 sm:mt-12 text-left"
      data-testid="hero-bento-showcase"
    >
      {/* Window Chrome & Fluid Mode Switcher */}
      <div className="rounded-2xl bg-surface border border-outline-variant/70 shadow-elevation-3 overflow-hidden">
        <div className="bg-surface-container-low px-4 sm:px-6 py-3 border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-brand italic text-lg font-bold text-primary leading-none select-none">
              book(ish)
            </span>
            <span className="h-3.5 w-px bg-outline-variant/70 hidden sm:inline-block" />
            <span className="text-xs font-sans text-on-surface-variant hidden sm:inline-block">
              Interactive Studio Preview
            </span>
          </div>

          {/* Fluid Sliding Toggle between Personal Reading Room and Physical Shelf */}
          <div
            className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/55"
            role="tablist"
            aria-label="Preview mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reading'}
              onClick={() => setActiveTab('reading')}
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-sans font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'reading'
                  ? 'text-primary'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {activeTab === 'reading' && (
                <motion.span
                  layoutId="hero-showcase-tab-pill"
                  transition={TAB_SPRING}
                  className="absolute inset-0 rounded-md bg-surface shadow-2xs border border-outline-variant/55"
                  aria-hidden="true"
                />
              )}
              <BookOpen className="relative z-10 w-3.5 h-3.5" />
              <span className="relative z-10">Personal Reading Room</span>
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'shelf'}
              onClick={() => setActiveTab('shelf')}
              className={`relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-sans font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                activeTab === 'shelf'
                  ? 'text-primary'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {activeTab === 'shelf' && (
                <motion.span
                  layoutId="hero-showcase-tab-pill"
                  transition={TAB_SPRING}
                  className="absolute inset-0 rounded-md bg-surface shadow-2xs border border-outline-variant/55"
                  aria-hidden="true"
                />
              )}
              <Library className="relative z-10 w-3.5 h-3.5" />
              <span className="relative z-10">Living Room Shelf</span>
            </button>
          </div>
        </div>

        {/* Interactive Body */}
        <div className="p-4 sm:p-6 bg-background/75">
          {activeTab === 'reading' ? (
            <motion.div
              key="reading-bento"
              initial={{opacity: 0, y: 4}}
              animate={{opacity: 1, y: 0}}
              transition={{duration: 0.16, ease: [0.22, 1, 0.36, 1]}}
              className="space-y-4"
            >
              {/* Row 1: Currently Reading (7 cols) + 3D Read Stack (5 cols) */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Currently Reading Card — Hairline Divided (No Nested Boxes) */}
                <div className="lg:col-span-7 bento-card p-4 sm:p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-2 pb-3 mb-3 border-b border-outline-variant/50">
                    <div>
                      <span className="metadata-eyebrow">Active Reads</span>
                      <h3 className="font-serif text-lg font-semibold text-on-surface leading-tight mt-0.5">
                        Currently Reading
                      </h3>
                    </div>
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container-low text-primary text-xs font-sans font-semibold border border-outline-variant/60 whitespace-nowrap shrink-0">
                      <Plus className="w-3.5 h-3.5" />
                      Find a Book
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:divide-x sm:divide-outline-variant/45">
                    {CURRENTLY_READING_BOOKS.map((book, idx) => (
                      <div
                        key={book.title}
                        className={`flex items-center gap-3 ${idx > 0 ? 'sm:pl-4' : ''}`}
                      >
                        <MonographCoverFallback
                          title={book.title}
                          author={book.author}
                          publishedYear={book.year}
                          variant="micro"
                          className="w-12 h-[72px] rounded-md book-cover-shadow shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="font-serif text-sm sm:text-base font-semibold text-on-surface truncate">
                            {book.title}
                          </div>
                          <div className="font-sans text-xs text-on-surface-variant truncate">
                            {book.author} ·{' '}
                            <span className="font-mono tabular-nums">
                              {book.year}
                            </span>
                          </div>
                          <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-sans font-medium text-on-surface-variant">
                            {book.isOwned ? (
                              <Library className="w-3 h-3 text-tertiary shrink-0" />
                            ) : (
                              <BookOpen className="w-3 h-3 text-tertiary shrink-0" />
                            )}
                            <span className="truncate">{book.context}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3D Read Stack Card */}
                <div className="lg:col-span-5 bento-card p-4 sm:p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <div>
                      <span className="metadata-eyebrow">3D Reading Stack</span>
                      <h3 className="font-serif tabular-nums text-lg font-semibold text-on-surface leading-tight mt-0.5">
                        14 Books Read
                      </h3>
                    </div>
                    <span className="font-mono tabular-nums text-xs font-medium text-on-surface-variant">
                      +6 Want to Read
                    </span>
                  </div>

                  {/* Tactile Stacked Spines */}
                  <div className="flex flex-col items-center justify-end py-2 space-y-1">
                    {STACK_SPINES.map((spine, idx) => (
                      <div
                        key={spine.title}
                        style={{
                          transform: `translateX(${idx % 2 === 0 ? '-4px' : '5px'})`,
                        }}
                        className={`${spine.width} ${spine.color} h-6 rounded-xs px-3 flex items-center justify-between text-[11px] font-serif font-medium shadow-2xs transition-transform`}
                      >
                        <span className="truncate">{spine.title}</span>
                        <span className="opacity-75 text-[10px] font-mono shrink-0 ml-2">
                          {spine.author}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 2: Pick of the Day (6 cols) + Genre Breakdown (6 cols) */}
              <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                {/* Pick of the Day */}
                <div className="md:col-span-6 bento-card p-4 sm:p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="inline-flex items-center gap-1.5 metadata-eyebrow text-tertiary">
                      <Sparkles className="w-3.5 h-3.5" />
                      Pick of the Day
                    </span>
                    <span className="text-[11px] font-sans text-on-surface-variant">
                      From your Study Shelf
                    </span>
                  </div>
                  <div>
                    <h4 className="font-serif text-base sm:text-lg font-semibold text-on-surface">
                      Invisible Cities{' '}
                      <span className="font-sans text-xs font-normal text-on-surface-variant">
                        · Italo Calvino
                      </span>
                    </h4>
                    <p className="font-sans text-xs sm:text-sm text-on-surface/90 leading-relaxed mt-2 pt-2 border-t border-outline-variant/45">
                      &ldquo;Short, dreamy chapters about memory and imagined
                      places—a resonant next read after Piranesi.&rdquo;
                    </p>
                  </div>
                </div>

                {/* Books Read by Genre */}
                <div className="md:col-span-6 bento-card p-4 sm:p-5 flex flex-col justify-between">
                  <div className="flex items-center justify-between gap-2 mb-2.5">
                    <span className="inline-flex items-center gap-1.5 metadata-eyebrow">
                      <BarChart3 className="w-3.5 h-3.5 text-tertiary" />
                      Books Read by Genre
                    </span>
                    <span className="font-mono tabular-nums text-[11px] text-on-surface-variant">
                      Top 3
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {[
                      {label: 'Sci-Fi & Speculative', count: 6, pct: 'w-4/5'},
                      {label: 'Literary Fiction', count: 5, pct: 'w-2/3'},
                      {label: 'History & Essays', count: 3, pct: 'w-2/5'},
                    ].map(g => (
                      <div key={g.label} className="space-y-1">
                        <div className="flex justify-between text-xs font-sans">
                          <span className="font-medium text-on-surface">
                            {g.label}
                          </span>
                          <span className="text-on-surface-variant font-mono tabular-nums">
                            {g.count}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">
                          <div
                            className={`h-full ${g.pct} bg-primary/75 rounded-full`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Row 3: Explore Perspectives Strip */}
              <div className="rounded-xl bg-surface-container-low border border-outline-variant/55 p-3 sm:px-4 flex flex-wrap items-center justify-between gap-3">
                <span className="text-xs font-sans font-medium text-on-surface-variant">
                  Explore your books across three visual perspectives:
                </span>
                <div className="flex flex-wrap items-center gap-4 text-xs font-sans font-semibold text-on-surface">
                  <span className="inline-flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-tertiary" />
                    Constellations
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-outline-variant hidden sm:inline"
                  >
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Globe className="w-3.5 h-3.5 text-tertiary" />
                    World Map
                  </span>
                  <span
                    aria-hidden="true"
                    className="text-outline-variant hidden sm:inline"
                  >
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-tertiary" />
                    Timeline
                  </span>
                </div>
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="shelf-bento"
              initial={{opacity: 0, y: 4}}
              animate={{opacity: 1, y: 0}}
              transition={{duration: 0.16, ease: [0.22, 1, 0.36, 1]}}
              className="space-y-4"
            >
              {/* Shelf Header Bar */}
              <div className="bento-card p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex items-baseline gap-2.5">
                    <h3 className="font-serif text-lg sm:text-xl font-semibold text-on-surface">
                      Living Room Bookshelf
                    </h3>
                    <span className="font-mono tabular-nums text-xs text-on-surface-variant">
                      142 Owned Volumes
                    </span>
                  </div>
                  <p className="font-sans text-xs text-on-surface-variant mt-0.5">
                    Shared with household · Covers, settings &amp; themes
                    auto-enriched
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low border border-outline-variant/55 text-xs text-on-surface-variant font-sans">
                    <Search className="w-3.5 h-3.5" />
                    <span>Filter shelf...</span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-sans font-semibold whitespace-nowrap shrink-0">
                    <Plus className="w-3.5 h-3.5" />
                    Add Book
                  </span>
                </div>
              </div>

              {/* 4 Book Cards Grid — Clean Unobstructed Covers */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                {SHELF_BOOKS.map(book => (
                  <div
                    key={book.title}
                    className="bento-card p-3 flex flex-col justify-between"
                  >
                    <div>
                      <div className="aspect-[2/3] w-full rounded-lg overflow-hidden bg-surface-container mb-2.5 border border-outline-variant/45 book-cover-shadow relative">
                        <MonographCoverFallback
                          title={book.title}
                          author={book.author}
                          publishedYear={book.year}
                          variant="card"
                          showTitleText={false}
                          className="absolute inset-0 p-3"
                        />
                      </div>
                      <div className="font-serif text-sm font-semibold text-on-surface truncate">
                        {book.title}
                      </div>
                      <div className="font-sans text-xs text-on-surface-variant truncate mt-0.5">
                        {book.author} ·{' '}
                        <span className="font-mono tabular-nums text-[11px]">
                          {book.year}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 pt-2 border-t border-outline-variant/45 flex items-center justify-between text-[11px] font-sans text-on-surface-variant">
                      <span>{book.genre}</span>
                      <span className="inline-flex items-center gap-0.5 text-tertiary font-medium">
                        <Check className="w-3 h-3" /> {book.status}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
