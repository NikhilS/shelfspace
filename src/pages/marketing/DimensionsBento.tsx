import React, {useState} from 'react';
import {
  Network,
  Sparkles,
  MapPin,
  Clock,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Globe2,
} from 'lucide-react';
import {Badge} from '@/components/ui/badge';

export function DimensionsBento() {
  const [spruceMode, setSpruceMode] = useState<'before' | 'after'>('after');

  return (
    <section className="w-full py-24 sm:py-32 bg-background">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-16 sm:mb-20">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-secondary" />
            <span className="font-label-caps-sm text-[11px] text-secondary font-bold uppercase tracking-widest">
              Four Spatial Dimensions
            </span>
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-primary tracking-tight mb-4">
            Not just shelves. Dimensions.
          </h2>
          <p className="font-sans text-base sm:text-lg text-on-surface-variant leading-relaxed">
            Alphabetical ordering flattens your collection. book(ish) constructs
            a multi-dimensional relational model that reveals how your library
            truly connects.
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 auto-rows-fr">
          {/* Card 1: 3D Constellations (8-cols) */}
          <div className="md:col-span-8 rounded-3xl bg-[#031527] text-white p-8 sm:p-10 relative overflow-hidden border border-white/10 shadow-elevation-2 flex flex-col justify-between group">
            {/* Visual Constellation Canvas Mock */}
            <div className="absolute inset-0 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity duration-700">
              <svg
                className="w-full h-full"
                viewBox="0 0 600 400"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                {/* Filaments */}
                <line
                  x1="120"
                  y1="140"
                  x2="260"
                  y2="100"
                  stroke="#8397b8"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                />
                <line
                  x1="260"
                  y1="100"
                  x2="400"
                  y2="160"
                  stroke="#d4e3ff"
                  strokeWidth="2"
                />
                <line
                  x1="260"
                  y1="100"
                  x2="290"
                  y2="280"
                  stroke="#8397b8"
                  strokeWidth="1"
                />
                <line
                  x1="400"
                  y1="160"
                  x2="480"
                  y2="240"
                  stroke="#fcc79c"
                  strokeWidth="1.5"
                />
                <line
                  x1="290"
                  y1="280"
                  x2="480"
                  y2="240"
                  stroke="#8397b8"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />

                {/* Nodes */}
                <circle cx="120" cy="140" r="8" fill="#8397b8" />
                <circle cx="260" cy="100" r="14" fill="#d4e3ff" />
                <circle cx="400" cy="160" r="18" fill="#fcc79c" />
                <circle cx="290" cy="280" r="10" fill="#adcebd" />
                <circle cx="480" cy="240" r="12" fill="#d4e3ff" />

                {/* Micro Node Labels */}
                <text
                  x="260"
                  y="75"
                  fill="#ffffff"
                  fontSize="11"
                  textAnchor="middle"
                  fontFamily="sans-serif"
                >
                  Dune (Anchor)
                </text>
                <text
                  x="400"
                  y="200"
                  fill="#fcc79c"
                  fontSize="11"
                  textAnchor="middle"
                  fontFamily="sans-serif"
                >
                  Foundation
                </text>
                <text
                  x="120"
                  y="170"
                  fill="#8397b8"
                  fontSize="10"
                  textAnchor="middle"
                  fontFamily="sans-serif"
                >
                  Solaris
                </text>
                <text
                  x="480"
                  y="270"
                  fill="#d4e3ff"
                  fontSize="10"
                  textAnchor="middle"
                  fontFamily="sans-serif"
                >
                  Hyperion
                </text>
              </svg>
            </div>

            <div className="relative z-10">
              <div className="flex items-center justify-between gap-3 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white">
                  <Network className="w-6 h-6" />
                </div>
                <Badge
                  variant="outline"
                  className="bg-white/5 text-white/90 border-white/20 font-label-caps-xs uppercase tracking-wider text-[10px]"
                >
                  Force-Directed 3D Graph
                </Badge>
              </div>

              <h3 className="font-serif text-2xl sm:text-3xl font-bold tracking-tight text-white mb-3">
                Semantic Constellations
              </h3>
              <p className="font-sans text-sm sm:text-base text-white/80 max-w-xl leading-relaxed">
                Break out of rigid alphabetical shelves. Using vector
                embeddings, book(ish) plots your books in an interactive 3D
                universe where proximity reflects thematic kinships, shared
                philosophies, and narrative tone.
              </p>
            </div>

            <div className="relative z-10 pt-8 mt-6 border-t border-white/10 flex flex-wrap items-center justify-between gap-4 text-xs text-white/70">
              <div className="flex items-center gap-4">
                <span>• Live Force Physics</span>
                <span>• Genre Orbit Clustered</span>
                <span>• Cross-Era Bridges</span>
              </div>
              <span className="text-secondary-container font-semibold flex items-center gap-1">
                Explore The Galaxy <ArrowRight className="w-3 h-3" />
              </span>
            </div>
          </div>

          {/* Card 2: The Self-Healing Spruce-Up Engine (4-cols) */}
          <div className="md:col-span-4 rounded-3xl bg-surface-container-lowest border border-outline-variant/40 p-8 flex flex-col justify-between shadow-elevation-1 hover:shadow-elevation-2 transition-all">
            <div>
              <div className="flex items-center justify-between gap-2 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary">
                  <Sparkles className="w-6 h-6" />
                </div>
                {/* Before / After Switcher */}
                <div className="flex items-center p-0.5 rounded-lg bg-surface-container border border-outline-variant/30 text-[11px] font-sans">
                  <button
                    type="button"
                    onClick={() => setSpruceMode('before')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      spruceMode === 'before'
                        ? 'bg-surface text-primary font-bold shadow-xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Raw Ingest
                  </button>
                  <button
                    type="button"
                    onClick={() => setSpruceMode('after')}
                    className={`px-2.5 py-1 rounded-md transition-all ${
                      spruceMode === 'after'
                        ? 'bg-secondary text-on-secondary font-bold shadow-xs'
                        : 'text-on-surface-variant hover:text-on-surface'
                    }`}
                  >
                    Healed
                  </button>
                </div>
              </div>

              <h3 className="font-serif text-2xl font-bold text-primary tracking-tight mb-2">
                Self-Healing Spruce-Up
              </h3>
              <p className="font-sans text-xs sm:text-sm text-on-surface-variant leading-relaxed mb-6">
                An autonomous background engine that heals damaged covers,
                expands missing blurbs, and cleans legacy catalog tags into a
                unified literary taxonomy.
              </p>

              {/* State Comparison Mock */}
              {spruceMode === 'before' ? (
                <div className="p-4 rounded-2xl bg-surface-container-low border border-amber-300/40 space-y-2.5 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 text-xs font-sans text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Generic low-res cover</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-sans text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Genre: "General Fiction / Misc"</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-sans text-amber-800">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>Missing setting & timeline epoch</span>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-surface-container-low border border-emerald-300/40 space-y-2.5 animate-in fade-in duration-200">
                  <div className="flex items-center gap-2 text-xs font-sans text-emerald-800 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Original first-edition cover restored</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-sans text-emerald-800 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Standardized canonical taxonomy</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs font-sans text-emerald-800 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Geocoded: Venice, Italy (13th Century)</span>
                  </div>
                </div>
              )}
            </div>

            <div className="pt-6 border-t border-outline-variant/20 mt-6 flex items-center justify-between text-xs text-on-surface-variant">
              <span>Autonomous Gemini Engine</span>
              <span className="font-semibold text-secondary">
                Zero Manual Cleanup
              </span>
            </div>
          </div>

          {/* Card 3: Narrative World Map (6-cols) */}
          <div className="md:col-span-6 rounded-3xl bg-surface-container-lowest border border-outline-variant/40 p-8 sm:p-10 flex flex-col justify-between shadow-elevation-1 hover:shadow-elevation-2 transition-all">
            <div>
              <div className="flex items-center justify-between gap-2 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Globe2 className="w-6 h-6" />
                </div>
                <Badge
                  variant="outline"
                  className="bg-primary/5 text-primary border-primary/20 font-label-caps-xs uppercase tracking-wider text-[10px]"
                >
                  Geographic Intelligence
                </Badge>
              </div>

              <h3 className="font-serif text-2xl font-bold text-primary tracking-tight mb-2">
                Narrative Geography
              </h3>
              <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-6">
                Pinpoint where every story takes place. An interactive global
                atlas plots the physical settings of your books—from Victorian
                London and feudal Kyoto to Alexandria and Buenos Aires.
              </p>

              {/* World Map Pin Mock */}
              <div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/30 grid grid-cols-2 gap-3">
                <div className="flex items-center gap-2 text-xs font-sans text-on-surface">
                  <MapPin className="w-3.5 h-3.5 text-secondary shrink-0" />
                  <span className="font-medium">London, UK (34 books)</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-sans text-on-surface">
                  <MapPin className="w-3.5 h-3.5 text-secondary shrink-0" />
                  <span className="font-medium">Kyoto, Japan (18 books)</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-sans text-on-surface">
                  <MapPin className="w-3.5 h-3.5 text-secondary shrink-0" />
                  <span className="font-medium">Buenos Aires (9 books)</span>
                </div>
                <div className="flex items-center gap-2 text-xs font-sans text-on-surface">
                  <MapPin className="w-3.5 h-3.5 text-secondary shrink-0" />
                  <span className="font-medium">Cairo, Egypt (12 books)</span>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-outline-variant/20 mt-6 flex items-center justify-between text-xs text-on-surface-variant">
              <span>Spot global reading blind spots</span>
              <span className="font-semibold text-primary">
                Interactive Map View
              </span>
            </div>
          </div>

          {/* Card 4: Chronological History Timeline (6-cols) */}
          <div className="md:col-span-6 rounded-3xl bg-surface-container-lowest border border-outline-variant/40 p-8 sm:p-10 flex flex-col justify-between shadow-elevation-1 hover:shadow-elevation-2 transition-all">
            <div>
              <div className="flex items-center justify-between gap-2 mb-6">
                <div className="w-12 h-12 rounded-2xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary">
                  <Clock className="w-6 h-6" />
                </div>
                <Badge
                  variant="outline"
                  className="bg-secondary/5 text-secondary border-secondary/20 font-label-caps-xs uppercase tracking-wider text-[10px]"
                >
                  Epoch Traversal
                </Badge>
              </div>

              <h3 className="font-serif text-2xl font-bold text-primary tracking-tight mb-2">
                Deep-Time Timeline
              </h3>
              <p className="font-sans text-sm text-on-surface-variant leading-relaxed mb-6">
                Publication dates only tell part of the story. book(ish) parses
                the narrative setting so you can walk through centuries of human
                history and future speculation.
              </p>

              {/* Timeline Track Mock */}
              <div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/30 space-y-3">
                <div className="w-full h-1.5 bg-outline-variant/40 relative rounded-full my-4">
                  <div className="absolute top-1/2 left-[10%] w-3.5 h-3.5 bg-secondary rounded-full transform -translate-y-1/2 border-2 border-surface" />
                  <div className="absolute top-1/2 left-[45%] w-3.5 h-3.5 bg-primary rounded-full transform -translate-y-1/2 border-2 border-surface" />
                  <div className="absolute top-1/2 left-[90%] w-3.5 h-3.5 bg-emerald-600 rounded-full transform -translate-y-1/2 border-2 border-surface" />
                </div>
                <div className="flex justify-between text-[11px] font-mono text-on-surface-variant/80">
                  <span>800 BCE (Iliad)</span>
                  <span>1920s (Gatsby)</span>
                  <span>10,191 AG (Dune)</span>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-outline-variant/20 mt-6 flex items-center justify-between text-xs text-on-surface-variant">
              <span>Narrative setting alignment</span>
              <span className="font-semibold text-secondary">
                Temporal Synchrony
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
