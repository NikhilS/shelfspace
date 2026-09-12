import React from 'react';
import {Sparkles, Compass, BookMarked, Quote} from 'lucide-react';
import {Badge} from '@/components/ui/badge';

export function CuratorSpotlightSection() {
  return (
    <section className="w-full py-24 sm:py-32 bg-surface-container-low/30 border-t border-outline-variant/30">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16 items-center">
          {/* Left Column: The Editorial Philosophy */}
          <div className="lg:col-span-6 flex flex-col items-start">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 mb-6">
              <Sparkles className="w-3.5 h-3.5 text-secondary" />
              <span className="font-label-caps-sm text-[11px] text-secondary font-bold uppercase tracking-widest">
                The Resident Sommelier
              </span>
            </div>

            <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-primary tracking-tight leading-[1.15] mb-6">
              Never stare blankly at your bookshelves again.
            </h2>

            <p className="font-sans text-base sm:text-lg text-on-surface-variant leading-relaxed mb-6">
              Large physical collections suffer from a quiet paradox: the more
              volumes you own, the harder it is to choose your next read.
            </p>

            <p className="font-sans text-sm sm:text-base text-on-surface-variant/90 leading-relaxed mb-8">
              Every morning, book(ish)'s AI Curator analyzes your reading
              momentum, the thematic topology of your collection, and neglected
              volumes gathering dust on top shelves. It serves a daily literary
              recommendation grounded strictly in the physical books you
              actually possess.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
              <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/30">
                <Compass className="w-5 h-5 text-secondary mb-2" />
                <h4 className="font-serif text-sm font-bold text-primary mb-1">
                  Shelf-Aware Geography
                </h4>
                <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                  Tells you the exact physical shelf and room location so you
                  can walk over and grab it.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-surface-container-lowest border border-outline-variant/30">
                <BookMarked className="w-5 h-5 text-secondary mb-2" />
                <h4 className="font-serif text-sm font-bold text-primary mb-1">
                  Uncanny Tonal Pairing
                </h4>
                <p className="font-sans text-xs text-on-surface-variant leading-relaxed">
                  Identifies subtle thematic bridges between seemingly unrelated
                  authors and movements.
                </p>
              </div>
            </div>
          </div>

          {/* Right Column: Physical Lending Slip Mock Card */}
          <div className="lg:col-span-6 flex justify-center">
            <div className="w-full max-w-md bg-[#FAF6EE] text-[#1c1c18] rounded-3xl p-8 sm:p-10 shadow-elevation-2 border border-[#E3DCCF] relative overflow-hidden">
              {/* Archival Header Stamp */}
              <div className="flex items-center justify-between border-b border-[#D8CFBF] pb-4 mb-6">
                <div>
                  <div className="font-mono text-[10px] tracking-widest text-[#78512F] uppercase font-bold">
                    Archival Dispatch • Daily Pick
                  </div>
                  <div className="font-serif text-xs italic text-[#5C574F]">
                    Curator Slip #4,192
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className="bg-[#EFE8DA] text-[#78512F] border-[#D8CFBF] font-mono text-[10px] uppercase tracking-wider"
                >
                  Winter Reading
                </Badge>
              </div>

              {/* Book Info */}
              <div className="mb-6">
                <div className="font-label-caps-xs text-[10px] text-[#78512F] uppercase tracking-wider font-bold mb-1">
                  Physical Shelf Location
                </div>
                <div className="font-sans text-xs font-semibold text-[#1c1c18] mb-4 flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-[#78512F]" />
                  East Wing Library • Oak Stack 3, Shelf B
                </div>

                <h3 className="font-serif text-2xl sm:text-3xl font-bold text-[#14263E] leading-tight">
                  The Left Hand of Darkness
                </h3>
                <div className="font-serif italic text-sm text-[#78512F] mt-1">
                  Ursula K. Le Guin (1969)
                </div>
              </div>

              {/* Rationale Quote */}
              <div className="p-4 rounded-2xl bg-[#F0E9DA] border border-[#DCD2C0] relative mb-6">
                <Quote className="w-4 h-4 text-[#78512F]/40 absolute top-3 right-3" />
                <div className="font-label-caps-xs text-[9px] uppercase tracking-wider text-[#78512F] font-bold mb-2">
                  Curator Rationale
                </div>
                <p className="font-serif italic text-xs sm:text-sm text-[#2D2A26] leading-relaxed">
                  "Because you recently logged Dune, this colder, more intimate
                  anthropological work provides a profound philosophical
                  counterbalance. Swap desert messianism for frostbound
                  diplomacy on the planet Gethen."
                </p>
              </div>

              {/* Sensory Footprint */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-sans">
                <span className="px-2.5 py-1 rounded-lg bg-[#EAE2D2] text-[#4A453E] font-medium">
                  Atmosphere: Sub-Zero Glacial
                </span>
                <span className="px-2.5 py-1 rounded-lg bg-[#EAE2D2] text-[#4A453E] font-medium">
                  Pacing: Contemplative
                </span>
              </div>

              {/* Bottom Stamp */}
              <div className="mt-8 pt-4 border-t border-[#D8CFBF] flex items-center justify-between text-[11px] font-mono text-[#78512F]/80">
                <span>Verified in Personal Vault</span>
                <span className="font-bold text-[#14263E]">Ready on Shelf</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
