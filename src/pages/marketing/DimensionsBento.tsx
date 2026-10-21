import React from 'react';
import {
  Search,
  ScanBarcode,
  Camera,
  FileSpreadsheet,
  Library,
  Sparkles,
  Compass,
  Globe,
  Clock,
  Check,
} from 'lucide-react';

export function DimensionsBento() {
  return (
    <section
      className="w-full py-16 sm:py-20 border-t border-outline-variant/40 bg-surface-container-low/40"
      data-testid="features-bento-section"
    >
      <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
        {/* Crisp Section Header */}
        <div className="max-w-2xl mb-10 sm:mb-12">
          <span className="text-xs font-sans font-bold uppercase tracking-widest text-tertiary">
            What’s Inside
          </span>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-on-surface tracking-tight mt-1.5 leading-tight">
            Built for your real shelves and everything you read.
          </h2>
          <p className="font-sans text-sm sm:text-base text-on-surface-variant mt-2.5 leading-relaxed">
            Whether you’re cataloging a wall of books at home or tracking a
            borrowed novel from a friend, everything stays fast, visual, and
            organized.
          </p>
        </div>

        {/* 4-Card Visual Bento Grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Card 1: Unified Quick Search + Advanced Adding (6 cols) */}
          <div className="md:col-span-6 rounded-2xl bg-surface border border-outline-variant/60 p-6 sm:p-7 shadow-elevation-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                  1 · Add Books Your Way
                </span>
                <span className="px-2 py-0.5 rounded-md bg-surface-container text-[11px] font-sans font-semibold text-primary">
                  1-Click or Bulk
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
                Quick search, barcode scan, or snap a whole shelf.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Start with a fast 1-click search dialog anywhere in the app, or
                jump into advanced tools to scan ISBN barcodes, photograph a
                bookshelf to extract every spine, or import a Goodreads CSV.
              </p>
            </div>

            {/* Visual Miniature: Search + 4 Ingestion Modes */}
            <div className="mt-6 space-y-2.5 pt-4 border-t border-outline-variant/40">
              <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-surface-container-low border border-outline-variant/50 text-xs font-sans">
                <span className="flex items-center gap-2 text-on-surface font-medium">
                  <Search className="w-3.5 h-3.5 text-primary" />
                  “Piranesi” — Susanna Clarke
                </span>
                <span className="px-2 py-0.5 rounded-md bg-primary text-on-primary text-[11px] font-semibold">
                  + Add
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs font-sans">
                <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40 flex items-center gap-2 text-on-surface font-medium">
                  <Camera className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate">Shelf Photo</span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40 flex items-center gap-2 text-on-surface font-medium">
                  <ScanBarcode className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate">ISBN Scan</span>
                </div>
                <div className="p-2.5 rounded-lg bg-surface-container-low border border-outline-variant/40 flex items-center gap-2 text-on-surface font-medium">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-primary shrink-0" />
                  <span className="truncate">CSV Import</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Physical Libraries & Auto Spruce-Up (6 cols) */}
          <div className="md:col-span-6 rounded-2xl bg-surface border border-outline-variant/60 p-6 sm:p-7 shadow-elevation-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                  2 · Physical Shelves & Spruce-Up
                </span>
                <span className="px-2 py-0.5 rounded-md bg-surface-container text-[11px] font-sans font-semibold text-primary">
                  Multi-Library
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
                Organize your rooms, share shelves, and auto-spruce covers.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Keep separate libraries for your living room, office, or family
                cabin. The Spruce-Up engine automatically fills in missing
                high-res covers, genres, story settings, and publication years.
              </p>
            </div>

            {/* Visual Miniature: Libraries + Spruce-Up Status */}
            <div className="mt-6 space-y-2.5 pt-4 border-t border-outline-variant/40">
              <div className="grid grid-cols-2 gap-2.5">
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/50">
                  <div className="flex items-center justify-between text-xs font-sans font-bold text-on-surface">
                    <span className="flex items-center gap-1.5">
                      <Library className="w-3.5 h-3.5 text-primary" />
                      Living Room
                    </span>
                    <span className="font-mono text-on-surface-variant">
                      142
                    </span>
                  </div>
                  <div className="text-[11px] font-sans text-on-surface-variant mt-1">
                    Shared with household
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/50">
                  <div className="flex items-center justify-between text-xs font-sans font-bold text-on-surface">
                    <span className="flex items-center gap-1.5">
                      <Library className="w-3.5 h-3.5 text-primary" />
                      Study Shelf
                    </span>
                    <span className="font-mono text-on-surface-variant">
                      68
                    </span>
                  </div>
                  <div className="text-[11px] font-sans text-on-surface-variant mt-1">
                    Private collection
                  </div>
                </div>
              </div>
              <div className="px-3 py-2 rounded-lg bg-surface-container border border-outline-variant/50 flex items-center justify-between text-xs font-sans">
                <span className="flex items-center gap-1.5 text-on-surface font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-tertiary" />
                  Auto-enriched covers, settings & themes
                </span>
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-semibold">
                  <Check className="w-3.5 h-3.5" /> Ready
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Personal Reading Room (6 cols) */}
          <div className="md:col-span-6 rounded-2xl bg-surface border border-outline-variant/60 p-6 sm:p-7 shadow-elevation-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                  3 · Personal Reading Room
                </span>
                <span className="px-2 py-0.5 rounded-md bg-surface-container text-[11px] font-sans font-semibold text-primary">
                  Owned + Un-owned
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
                Track what you’re reading—even if it’s not on your shelf.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Log books you’re reading, want to read, or finished across both
                your physical shelves and borrowed or audio books. Watch your 3D
                Read Stack grow and get a daily Pick of the Day.
              </p>
            </div>

            {/* Visual Miniature: Reading Statuses */}
            <div className="mt-6 pt-4 border-t border-outline-variant/40 flex flex-wrap items-center justify-between gap-2">
              {[
                {label: 'Currently Reading', count: 2, active: true},
                {label: 'Want to Read', count: 18, active: false},
                {label: 'Read', count: 47, active: false},
              ].map(shelf => (
                <div
                  key={shelf.label}
                  className={`flex-1 min-w-[110px] p-2.5 rounded-lg border text-xs font-sans ${
                    shelf.active
                      ? 'bg-primary text-on-primary border-primary font-semibold'
                      : 'bg-surface-container-low text-on-surface border-outline-variant/50 font-medium'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="truncate">{shelf.label}</span>
                    <span className="font-mono text-[11px] opacity-85 ml-1">
                      {shelf.count}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Card 4: Constellations, World Map & Timeline (6 cols) */}
          <div className="md:col-span-6 rounded-2xl bg-surface border border-outline-variant/60 p-6 sm:p-7 shadow-elevation-1 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="text-[11px] font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                  4 · Visual Perspectives
                </span>
                <span className="px-2 py-0.5 rounded-md bg-surface-container text-[11px] font-sans font-semibold text-primary">
                  3 Views
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-bold text-on-surface tracking-tight">
                See your books as a 3D constellation, a world map, or a
                timeline.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Zoom through a 3D galaxy of shared themes, see pins for every
                city and region your books take place in, or scrub through
                centuries of story eras and publication dates.
              </p>
            </div>

            {/* Visual Miniature: 3 Perspectives Triptych */}
            <div className="mt-6 pt-4 border-t border-outline-variant/40 grid grid-cols-3 gap-2.5 text-xs font-sans">
              <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/50">
                <Compass className="w-4 h-4 text-primary mb-1.5" />
                <div className="font-bold text-on-surface">Constellations</div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">
                  3D theme clusters
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/50">
                <Globe className="w-4 h-4 text-primary mb-1.5" />
                <div className="font-bold text-on-surface">World Map</div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">
                  Story locations
                </div>
              </div>
              <div className="p-3 rounded-lg bg-surface-container-low border border-outline-variant/50">
                <Clock className="w-4 h-4 text-primary mb-1.5" />
                <div className="font-bold text-on-surface">Timeline</div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">
                  Eras & years
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
