import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
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

type PreviewTab = 'reading' | 'shelf';

const CURRENTLY_READING_BOOKS = [
  {
    title: 'Piranesi',
    author: 'Susanna Clarke',
    context: 'Personal Reading Shelf',
    isOwned: false,
    cover:
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=300&q=80',
  },
  {
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    context: 'Owned · Living Room',
    isOwned: true,
    cover:
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=300&q=80',
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
    setting: 'Arrakis',
    cover:
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=300&q=80',
  },
  {
    title: 'Invisible Cities',
    author: 'Italo Calvino',
    year: '1972',
    genre: 'Literary',
    status: 'Read',
    setting: 'Venice, Italy',
    cover:
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=300&q=80',
  },
  {
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    year: '1969',
    genre: 'Sci-Fi',
    status: 'Reading',
    setting: 'Gethen',
    cover:
      'https://images.unsplash.com/photo-1495446815901-a7297e633e8d?auto=format&fit=crop&w=300&q=80',
  },
  {
    title: 'Pachinko',
    author: 'Min Jin Lee',
    year: '2017',
    genre: 'Historical',
    status: 'Want to Read',
    setting: 'Busan & Osaka',
    cover:
      'https://images.unsplash.com/photo-1543002588-bfa74002ed7e?auto=format&fit=crop&w=300&q=80',
  },
];

export function HeroShowcaseCard() {
  const [activeTab, setActiveTab] = useState<PreviewTab>('reading');

  return (
    <div
      className="w-full max-w-5xl mx-auto mt-10 sm:mt-12 text-left"
      data-testid="hero-bento-showcase"
    >
      {/* Window Chrome & Mode Switcher */}
      <div className="rounded-2xl bg-surface border border-outline-variant/70 shadow-elevation-3 overflow-hidden">
        <div className="bg-surface-container-low px-4 sm:px-6 py-3 border-b border-outline-variant/60 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="font-brand italic text-lg font-bold text-primary leading-none select-none">
              book(ish)
            </span>
            <span className="h-3.5 w-px bg-outline-variant/70 hidden sm:inline-block" />
            <span className="text-xs font-sans text-on-surface-variant hidden sm:inline-block">
              Interactive Preview
            </span>
          </div>

          {/* Toggle between Personal Reading Room and Physical Shelf */}
          <div
            className="flex items-center gap-1 p-1 bg-surface-container rounded-lg border border-outline-variant/50"
            role="tablist"
            aria-label="Preview mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'reading'}
              onClick={() => setActiveTab('reading')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-sans font-semibold transition-all cursor-pointer ${
                activeTab === 'reading'
                  ? 'bg-surface text-primary shadow-2xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <BookOpen className="w-3.5 h-3.5" />
              <span>Personal Reading Room</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'shelf'}
              onClick={() => setActiveTab('shelf')}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-sans font-semibold transition-all cursor-pointer ${
                activeTab === 'shelf'
                  ? 'bg-surface text-primary shadow-2xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Library className="w-3.5 h-3.5" />
              <span>Living Room Shelf</span>
            </button>
          </div>
        </div>

        {/* Interactive Body */}
        <div className="p-4 sm:p-6 bg-background/60">
          <AnimatePresence>
            {activeTab === 'reading' ? (
              <motion.div
                key="reading-bento"
                initial={{opacity: 0, y: 6}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -6}}
                transition={{duration: 0.2}}
                className="space-y-4"
              >
                {/* Row 1: Currently Reading (7 cols) + 3D Read Stack (5 cols) */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  {/* Currently Reading Card */}
                  <div className="lg:col-span-7 rounded-xl bg-surface border border-outline-variant/60 p-4 sm:p-5 flex flex-col justify-between shadow-elevation-1">
                    <div className="flex items-center justify-between gap-2 mb-3.5">
                      <div>
                        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                          Active Reads
                        </span>
                        <h3 className="font-serif text-lg font-bold text-on-surface leading-tight">
                          Currently Reading
                        </h3>
                      </div>
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-surface-container text-primary text-xs font-sans font-semibold border border-outline-variant/50">
                        <Plus className="w-3.5 h-3.5" />
                        Track a Book
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {CURRENTLY_READING_BOOKS.map(book => (
                        <div
                          key={book.title}
                          className="flex items-center gap-3 p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/50"
                        >
                          <img
                            src={book.cover}
                            alt={book.title}
                            className="w-11 h-16 object-cover rounded-md shadow-2xs shrink-0"
                            referrerPolicy="no-referrer"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="font-serif text-sm font-bold text-on-surface truncate">
                              {book.title}
                            </div>
                            <div className="font-sans text-xs text-on-surface-variant truncate">
                              {book.author}
                            </div>
                            <div className="mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-surface-container text-[10px] font-sans font-semibold text-on-surface-variant">
                              {book.isOwned ? (
                                <Library className="w-2.5 h-2.5 text-primary" />
                              ) : (
                                <BookOpen className="w-2.5 h-2.5 text-primary" />
                              )}
                              <span className="truncate">{book.context}</span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 3D Read Stack Card */}
                  <div className="lg:col-span-5 rounded-xl bg-surface border border-outline-variant/60 p-4 sm:p-5 flex flex-col justify-between shadow-elevation-1">
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div>
                        <span className="text-[10px] font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                          3D Reading Stack
                        </span>
                        <h3 className="font-serif text-lg font-bold text-on-surface leading-tight">
                          14 Books Read
                        </h3>
                      </div>
                      <span className="px-2 py-0.5 rounded-md bg-surface-container text-xs font-sans font-semibold text-on-surface-variant">
                        + 6 Want to Read
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
                          className={`${spine.width} ${spine.color} h-6 rounded-sm px-3 flex items-center justify-between text-[11px] font-sans font-semibold shadow-2xs transition-transform`}
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
                  <div className="md:col-span-6 rounded-xl bg-surface border border-outline-variant/60 p-4 sm:p-5 shadow-elevation-1 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-sans font-bold uppercase tracking-wider text-tertiary">
                        <Sparkles className="w-3.5 h-3.5" />
                        Pick of the Day
                      </span>
                      <span className="text-[11px] font-sans text-on-surface-variant">
                        From your Study Shelf
                      </span>
                    </div>
                    <div>
                      <h4 className="font-serif text-base font-bold text-on-surface">
                        Invisible Cities · Italo Calvino
                      </h4>
                      <p className="font-sans text-xs text-on-surface-variant leading-relaxed mt-1">
                        “Short, dreamy chapters about memory and imagined
                        places—a great next read after Piranesi.”
                      </p>
                    </div>
                  </div>

                  {/* Books Read by Genre */}
                  <div className="md:col-span-6 rounded-xl bg-surface border border-outline-variant/60 p-4 sm:p-5 shadow-elevation-1 flex flex-col justify-between">
                    <div className="flex items-center justify-between gap-2 mb-2.5">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                        <BarChart3 className="w-3.5 h-3.5 text-primary" />
                        Books Read by Genre
                      </span>
                      <span className="text-[11px] font-sans font-semibold text-primary">
                        Top 3
                      </span>
                    </div>
                    <div className="space-y-2">
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
                            <span className="text-on-surface-variant font-mono">
                              {g.count}
                            </span>
                          </div>
                          <div className="h-1.5 w-full rounded-sm bg-surface-container overflow-hidden">
                            <div
                              className={`h-full ${g.pct} bg-primary rounded-sm`}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Row 3: Explore Perspectives Strip */}
                <div className="rounded-xl bg-surface-container-low border border-outline-variant/60 p-3 sm:px-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-xs font-sans font-semibold text-on-surface-variant">
                    Explore your books across three visual perspectives:
                  </span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-outline-variant/50 text-xs font-sans font-semibold text-on-surface">
                      <Compass className="w-3.5 h-3.5 text-primary" />
                      3D Constellations
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-outline-variant/50 text-xs font-sans font-semibold text-on-surface">
                      <Globe className="w-3.5 h-3.5 text-primary" />
                      World Map
                    </span>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-surface border border-outline-variant/50 text-xs font-sans font-semibold text-on-surface">
                      <Clock className="w-3.5 h-3.5 text-primary" />
                      Timeline
                    </span>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="shelf-bento"
                initial={{opacity: 0, y: 6}}
                animate={{opacity: 1, y: 0}}
                exit={{opacity: 0, y: -6}}
                transition={{duration: 0.2}}
                className="space-y-4"
              >
                {/* Shelf Header Bar */}
                <div className="rounded-xl bg-surface border border-outline-variant/60 p-4 sm:p-5 flex flex-wrap items-center justify-between gap-3 shadow-elevation-1">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-serif text-lg font-bold text-on-surface">
                        Living Room Bookshelf
                      </h3>
                      <span className="px-2 py-0.5 rounded-md bg-surface-container text-[11px] font-sans font-semibold text-on-surface-variant">
                        142 Owned Volumes
                      </span>
                    </div>
                    <p className="font-sans text-xs text-on-surface-variant mt-0.5">
                      Shared with household · Covers, settings & themes
                      auto-enriched
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-container-low border border-outline-variant/50 text-xs text-on-surface-variant font-sans">
                      <Search className="w-3.5 h-3.5" />
                      <span>Filter shelf...</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-sans font-semibold">
                      <Plus className="w-3.5 h-3.5" />
                      Add Book
                    </span>
                  </div>
                </div>

                {/* 4 Book Cards Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
                  {SHELF_BOOKS.map(book => (
                    <div
                      key={book.title}
                      className="rounded-xl bg-surface border border-outline-variant/60 p-3 shadow-elevation-1 flex flex-col justify-between"
                    >
                      <div>
                        <div className="aspect-[2/3] w-full rounded-lg overflow-hidden bg-surface-container mb-2.5 border border-outline-variant/30 relative">
                          <img
                            src={book.cover}
                            alt={book.title}
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-surface/90 backdrop-blur-xs text-[10px] font-sans font-semibold text-on-surface">
                            {book.status}
                          </span>
                        </div>
                        <div className="font-serif text-sm font-bold text-on-surface truncate">
                          {book.title}
                        </div>
                        <div className="font-sans text-xs text-on-surface-variant truncate">
                          {book.author}
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-outline-variant/40 flex items-center justify-between text-[10px] font-sans text-on-surface-variant">
                        <span>{book.genre}</span>
                        <span className="inline-flex items-center gap-0.5 text-emerald-700 dark:text-emerald-400 font-semibold">
                          <Check className="w-3 h-3" /> Spruced
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
