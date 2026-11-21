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
      className="w-full py-16 sm:py-20 border-t border-outline-variant/50 bg-surface-container-low/45"
      data-testid="features-bento-section"
    >
      <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
        {/* Crisp Section Header */}
        <div className="max-w-2xl mb-10 sm:mb-12">
          <span className="metadata-eyebrow text-tertiary">What’s Inside</span>
          <h2 className="font-serif text-3xl sm:text-4xl font-bold text-on-surface tracking-tight mt-1.5 leading-[1.14] [text-wrap:balance]">
            Built for your real shelves and everything you read.
          </h2>
          <p className="font-sans text-sm sm:text-base text-on-surface-variant mt-2.5 leading-relaxed">
            Whether you’re cataloging a wall of books at home or tracking a
            borrowed novel from a friend, everything stays fast, visual, and
            organized.
          </p>
        </div>

        {/* 4-Card Visual Bento Grid — Single-Elevation Hairline Discipline */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Card 1: Unified Quick Search + Advanced Adding (6 cols) */}
          <div className="md:col-span-6 bento-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="metadata-eyebrow">1 · Add Books Your Way</span>
                <span className="font-mono tabular-nums text-[11px] font-medium text-tertiary">
                  1-Click or Bulk
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-semibold text-on-surface tracking-tight [text-wrap:balance]">
                Quick search, barcode scan, or snap a whole shelf.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Start with a fast 1-click search dialog anywhere in the app, or
                jump into advanced tools to scan ISBN barcodes, photograph a
                bookshelf to extract every spine, or import a Goodreads CSV.
              </p>
            </div>

            {/* Visual Miniature: Search + 4 Ingestion Modes (Tonal Strip + Hairline Dividers) */}
            <div className="mt-6 space-y-3 pt-4 border-t border-outline-variant/50">
              <div className="flex items-center justify-between px-3.5 py-2 rounded-lg bg-surface-container-low border border-outline-variant/55 text-xs font-sans">
                <span className="flex items-center gap-2 text-on-surface font-medium">
                  <Search className="w-3.5 h-3.5 text-tertiary" />
                  “Piranesi” — Susanna Clarke
                </span>
                <span className="px-2.5 py-0.5 rounded-md bg-primary text-on-primary text-[11px] font-semibold">
                  + Add
                </span>
              </div>
              <div className="grid grid-cols-3 divide-x divide-outline-variant/55 pt-1 text-xs font-sans">
                <div className="pr-2.5 flex items-center gap-2 text-on-surface font-medium">
                  <Camera className="w-3.5 h-3.5 text-tertiary shrink-0" />
                  <span className="truncate">Shelf Photo</span>
                </div>
                <div className="px-2.5 flex items-center gap-2 text-on-surface font-medium">
                  <ScanBarcode className="w-3.5 h-3.5 text-tertiary shrink-0" />
                  <span className="truncate">ISBN Scan</span>
                </div>
                <div className="pl-2.5 flex items-center gap-2 text-on-surface font-medium">
                  <FileSpreadsheet className="w-3.5 h-3.5 text-tertiary shrink-0" />
                  <span className="truncate">CSV Import</span>
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Physical Libraries & Auto Spruce-Up (6 cols) */}
          <div className="md:col-span-6 bento-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="metadata-eyebrow">
                  2 · Physical Shelves &amp; Spruce-Up
                </span>
                <span className="font-mono tabular-nums text-[11px] font-medium text-tertiary">
                  Multi-Library
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-semibold text-on-surface tracking-tight [text-wrap:balance]">
                Organize your rooms, share shelves, and auto-spruce covers.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Keep separate libraries for your living room, office, or family
                cabin. The Spruce-Up engine automatically fills in missing
                high-res covers, genres, story settings, and publication years.
              </p>
            </div>

            {/* Visual Miniature: Libraries + Spruce-Up Status */}
            <div className="mt-6 space-y-3 pt-4 border-t border-outline-variant/50">
              <div className="grid grid-cols-2 divide-x divide-outline-variant/55">
                <div className="pr-3.5">
                  <div className="flex items-center justify-between text-xs font-sans font-semibold text-on-surface">
                    <span className="flex items-center gap-1.5 font-serif text-sm">
                      <Library className="w-3.5 h-3.5 text-tertiary shrink-0" />
                      Living Room
                    </span>
                    <span className="font-mono tabular-nums text-on-surface-variant">
                      142
                    </span>
                  </div>
                  <div className="text-[11px] font-sans text-on-surface-variant mt-0.5">
                    Shared with household
                  </div>
                </div>
                <div className="pl-3.5">
                  <div className="flex items-center justify-between text-xs font-sans font-semibold text-on-surface">
                    <span className="flex items-center gap-1.5 font-serif text-sm">
                      <Library className="w-3.5 h-3.5 text-tertiary shrink-0" />
                      Study Shelf
                    </span>
                    <span className="font-mono tabular-nums text-on-surface-variant">
                      68
                    </span>
                  </div>
                  <div className="text-[11px] font-sans text-on-surface-variant mt-0.5">
                    Private collection
                  </div>
                </div>
              </div>
              <div className="pt-2.5 border-t border-outline-variant/40 flex items-center justify-between text-xs font-sans">
                <span className="flex items-center gap-1.5 text-on-surface-variant font-medium">
                  <Sparkles className="w-3.5 h-3.5 text-tertiary" />
                  Auto-enriched covers, settings &amp; themes
                </span>
                <span className="inline-flex items-center gap-1 text-tertiary font-semibold">
                  <Check className="w-3.5 h-3.5" /> Ready
                </span>
              </div>
            </div>
          </div>

          {/* Card 3: Personal Reading Room (6 cols) */}
          <div className="md:col-span-6 bento-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="metadata-eyebrow">
                  3 · Personal Reading Room
                </span>
                <span className="font-mono tabular-nums text-[11px] font-medium text-tertiary">
                  Owned + Un-owned
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-semibold text-on-surface tracking-tight [text-wrap:balance]">
                Track what you’re reading—even if it’s not on your shelf.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Log books you’re reading, want to read, or finished across both
                your physical shelves and borrowed or audio books. Watch your 3D
                Read Stack grow and get a daily Pick of the Day.
              </p>
            </div>

            {/* Visual Miniature: Segmented Reading Statuses */}
            <div className="mt-6 pt-4 border-t border-outline-variant/50">
              <div className="flex flex-wrap items-center gap-1.5 p-1 rounded-lg bg-surface-container border border-outline-variant/50">
                {[
                  {label: 'Currently Reading', count: 2, active: true},
                  {label: 'Want to Read', count: 18, active: false},
                  {label: 'Read', count: 47, active: false},
                ].map(shelf => (
                  <div
                    key={shelf.label}
                    className={`flex-1 min-w-[104px] px-3 py-1.5 rounded-md text-xs font-sans flex items-center justify-between ${
                      shelf.active
                        ? 'bg-surface text-primary font-semibold shadow-2xs border border-outline-variant/55'
                        : 'text-on-surface-variant font-medium'
                    }`}
                  >
                    <span className="truncate">{shelf.label}</span>
                    <span className="font-mono tabular-nums text-[11px] opacity-85 ml-1.5">
                      {shelf.count}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Card 4: Constellations, World Map & Timeline (6 cols) */}
          <div className="md:col-span-6 bento-card rounded-2xl p-6 sm:p-7 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-3">
                <span className="metadata-eyebrow">
                  4 · Visual Perspectives
                </span>
                <span className="font-mono tabular-nums text-[11px] font-medium text-tertiary">
                  3 Views
                </span>
              </div>
              <h3 className="font-serif text-xl sm:text-2xl font-semibold text-on-surface tracking-tight [text-wrap:balance]">
                See your books as a 3D constellation, a world map, or a
                timeline.
              </h3>
              <p className="font-sans text-sm text-on-surface-variant mt-2 leading-relaxed">
                Zoom through a star map of shared themes, see pins for every
                city and region your books take place in, or scrub through
                centuries of story eras and publication dates.
              </p>
            </div>

            {/* Visual Miniature: 3 Perspectives Hairline Triptych */}
            <div className="mt-6 pt-4 border-t border-outline-variant/50 grid grid-cols-3 divide-x divide-outline-variant/55 text-xs font-sans">
              <div className="pr-3">
                <Compass className="w-4 h-4 text-tertiary mb-1.5" />
                <div className="font-serif font-semibold text-sm text-on-surface">
                  Constellations
                </div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">
                  Theme clusters
                </div>
              </div>
              <div className="px-3">
                <Globe className="w-4 h-4 text-tertiary mb-1.5" />
                <div className="font-serif font-semibold text-sm text-on-surface">
                  World Map
                </div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">
                  Story locations
                </div>
              </div>
              <div className="pl-3">
                <Clock className="w-4 h-4 text-tertiary mb-1.5" />
                <div className="font-serif font-semibold text-sm text-on-surface">
                  Timeline
                </div>
                <div className="text-[11px] text-on-surface-variant mt-0.5">
                  Eras &amp; years
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
