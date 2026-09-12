import React, {useState} from 'react';
import {motion, AnimatePresence} from 'motion/react';
import {
  Sparkles,
  MapPin,
  Calendar,
  Layers,
  Bookmark,
  CheckCircle2,
  ArrowUpRight,
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';

interface SampleBook {
  id: string;
  title: string;
  author: string;
  year: string;
  shelf: string;
  setting: string;
  settingEra: string;
  coverUrl: string;
  genres: string[];
  themes: string[];
  curatorNote: string;
  dimensionsScore: {
    constellationNodes: number;
    geoPlot: string;
    timelineYear: string;
  };
}

const SAMPLE_VOLUMES: SampleBook[] = [
  {
    id: 'dune',
    title: 'Dune',
    author: 'Frank Herbert',
    year: '1965',
    shelf: 'West Library • Section IV, Shelf 2',
    setting: 'Arrakis (Deep Desert)',
    settingEra: '10,191 AG (Far Future)',
    coverUrl:
      'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80',
    genres: ['Science Fiction', 'Space Opera', 'Philosophical Fiction'],
    themes: ['Ecology & Scarcity', 'Feudal Politics', 'Messianic Myths'],
    curatorNote:
      'Outstanding ecological world-building. In your 3D graph, this serves as an anchor node linking 14 other political sci-fi volumes in your collection.',
    dimensionsScore: {
      constellationNodes: 14,
      geoPlot: 'Off-World Archive',
      timelineYear: '+10,191',
    },
  },
  {
    id: 'calvino',
    title: 'Invisible Cities',
    author: 'Italo Calvino',
    year: '1972',
    shelf: 'Study • Oak Shelf 1',
    setting: 'Venice & Kublai Khan’s Palace',
    settingEra: '13th Century (Historical/Metaphorical)',
    coverUrl:
      'https://images.unsplash.com/photo-1512820790803-83ca734da794?auto=format&fit=crop&w=600&q=80',
    genres: ['Literary Fiction', 'Magical Realism', 'Architecture'],
    themes: ['Memory & Desires', 'Urban Semiotics', 'Poetics of Space'],
    curatorNote:
      'Tightly bonded with Jorge Luis Borges in your semantic universe. Recommended reading when exploring your European postmodernist collection.',
    dimensionsScore: {
      constellationNodes: 9,
      geoPlot: 'Venice, Italy (45.44° N)',
      timelineYear: '1271 CE',
    },
  },
];

export function HeroShowcaseCard() {
  const [activeBookIndex, setActiveBookIndex] = useState(0);
  const book = SAMPLE_VOLUMES[activeBookIndex];

  return (
    <div className="w-full max-w-4xl mx-auto mt-12 sm:mt-16">
      {/* Interactive Switcher */}
      <div className="flex items-center justify-between gap-3 mb-4 px-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
          <span className="font-label-caps-sm text-[11px] text-on-surface-variant/80 uppercase tracking-widest font-semibold">
            Live Archival Volume Record
          </span>
        </div>

        <div className="flex items-center gap-1.5 p-1 bg-surface-container rounded-xl border border-outline-variant/30 text-xs">
          {SAMPLE_VOLUMES.map((vol, idx) => (
            <button
              key={vol.id}
              type="button"
              onClick={() => setActiveBookIndex(idx)}
              className={`px-3 py-1 rounded-lg font-sans text-xs transition-all ${
                activeBookIndex === idx
                  ? 'bg-surface text-primary font-bold shadow-xs'
                  : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              {vol.title}
            </button>
          ))}
        </div>
      </div>

      {/* Main Archival Stage Card */}
      <div className="relative rounded-3xl bg-surface-container-lowest border border-outline-variant/40 shadow-elevation-2 overflow-hidden transition-all duration-300">
        <div className="p-6 sm:p-8 lg:p-10">
          <AnimatePresence mode="wait">
            <motion.div
              key={book.id}
              initial={{opacity: 0, y: 10}}
              animate={{opacity: 1, y: 0}}
              exit={{opacity: 0, y: -10}}
              transition={{duration: 0.25}}
              className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start"
            >
              {/* Left Column: Cover & Physical Shelf Anchor */}
              <div className="md:col-span-4 flex flex-col items-center md:items-start">
                <div className="relative group w-44 sm:w-48 aspect-[2/3] rounded-xl overflow-hidden shadow-elevation-2 border border-outline-variant/30 bg-surface-container">
                  <img
                    src={book.coverUrl}
                    alt={book.title}
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                    referrerPolicy="no-referrer"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-80" />
                  <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between text-[11px] text-white/90 font-mono font-medium">
                    <span>{book.year}</span>
                    <span className="flex items-center gap-1 text-emerald-300">
                      <CheckCircle2 className="w-3 h-3" /> Enriched
                    </span>
                  </div>
                </div>

                <div className="mt-4 w-full flex items-center gap-2 p-2.5 rounded-xl bg-surface-container-low border border-outline-variant/30 text-xs text-on-surface-variant">
                  <Bookmark className="w-3.5 h-3.5 text-secondary shrink-0" />
                  <span className="truncate font-sans font-medium">
                    {book.shelf}
                  </span>
                </div>
              </div>

              {/* Right Column: Deep Metadata & AI Dimensions */}
              <div className="md:col-span-8 flex flex-col justify-between h-full">
                <div>
                  {/* Category Pills & Era */}
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <Badge
                      variant="secondary"
                      className="bg-secondary/10 text-secondary border-secondary/20 font-sans text-xs font-semibold px-2.5 py-0.5"
                    >
                      {book.genres[0]}
                    </Badge>
                    <span className="text-xs text-on-surface-variant/60">
                      •
                    </span>
                    <span className="font-sans text-xs text-on-surface-variant font-medium">
                      Published {book.year}
                    </span>
                  </div>

                  <h3 className="font-serif text-3xl sm:text-4xl font-bold text-primary tracking-tight mb-1">
                    {book.title}
                  </h3>
                  <p className="font-serif text-lg text-secondary italic mb-6">
                    by {book.author}
                  </p>

                  {/* Dimension Micro-Chips */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30">
                      <MapPin className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
                      <div>
                        <div className="font-label-caps-xs text-[10px] text-on-surface-variant/70 uppercase tracking-wider font-bold">
                          Setting Geography
                        </div>
                        <div className="font-sans text-xs font-semibold text-primary">
                          {book.setting}
                        </div>
                        <div className="text-[11px] text-on-surface-variant/80 font-sans">
                          {book.dimensionsScore.geoPlot}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-start gap-2.5 p-3 rounded-xl bg-surface-container-low border border-outline-variant/30">
                      <Calendar className="w-4 h-4 text-secondary mt-0.5 shrink-0" />
                      <div>
                        <div className="font-label-caps-xs text-[10px] text-on-surface-variant/70 uppercase tracking-wider font-bold">
                          Narrative Epoch
                        </div>
                        <div className="font-sans text-xs font-semibold text-primary">
                          {book.settingEra}
                        </div>
                        <div className="text-[11px] text-on-surface-variant/80 font-sans">
                          Plot point: {book.dimensionsScore.timelineYear}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Thematic DNA Tags */}
                  <div className="mb-6">
                    <div className="flex items-center gap-1.5 font-label-caps-xs text-[10px] text-on-surface-variant/70 uppercase tracking-wider font-bold mb-2">
                      <Layers className="w-3 h-3 text-secondary" />
                      Thematic Kinship DNA
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {book.themes.map(theme => (
                        <span
                          key={theme}
                          className="px-2.5 py-1 rounded-lg bg-surface-container border border-outline-variant/30 text-xs font-sans text-on-surface font-medium"
                        >
                          {theme}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Curator Sommelier Note */}
                <div className="p-4 rounded-2xl bg-surface-container-high/60 border border-outline-variant/40 relative">
                  <div className="flex items-center gap-2 mb-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-secondary" />
                    <span className="font-label-caps-sm text-[10px] text-secondary font-bold uppercase tracking-wider">
                      Archival Curator Dispatch
                    </span>
                  </div>
                  <p className="font-serif italic text-xs sm:text-sm text-primary leading-relaxed">
                    "{book.curatorNote}"
                  </p>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Card Footer Ticker */}
        <div className="bg-surface-container px-6 sm:px-8 py-3 border-t border-outline-variant/30 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-4 text-on-surface-variant font-sans">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
              Continuous Camera Vision
            </span>
            <span className="hidden sm:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
              1-Click Barcode Ingestion
            </span>
            <span className="hidden md:flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              Auto Multi-Source Enrichment
            </span>
          </div>

          <div className="flex items-center gap-1 font-label-caps-sm text-xs font-bold text-secondary uppercase tracking-wider">
            <span>Explore The 3D Graph</span>
            <ArrowUpRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </div>
    </div>
  );
}
