import React from 'react';
import {
  Camera,
  ScanBarcode,
  FileSpreadsheet,
  Globe2,
  CheckCircle2,
  Zap,
} from 'lucide-react';

const INGESTION_CHANNELS = [
  {
    icon: Camera,
    title: 'Continuous Spine Vision',
    badge: 'AI Machine Vision',
    description:
      'Sweep your camera along physical bookshelves. Neural vision extracts titles, authors, and editions in continuous sweeps without manual typing.',
    stats: '50+ books / minute',
  },
  {
    icon: ScanBarcode,
    title: 'Rapid Barcode Scanner',
    badge: 'Zero-Lag Hardware Ingest',
    description:
      'High-speed sequential ISBN barcode scanning with instant vibration feedback. Stack your books, beep through the pile, and save in one go.',
    stats: 'Sub-second capture',
  },
  {
    icon: FileSpreadsheet,
    title: '1-Click Goodreads & CSV Import',
    badge: 'Legacy Migration',
    description:
      'Export from Goodreads, StoryGraph, or Excel and drop the file directly into book(ish). Smart deduplication keeps your collection immaculate.',
    stats: 'Full export sync',
  },
  {
    icon: Globe2,
    title: 'Multi-Source Auto-Enrichment',
    badge: 'Autonomous Triangulation',
    description:
      'Cross-references Google Books, OpenLibrary, and Wikipedia simultaneously to pull verified ISBNs, historical settings, high-res covers, and blurbs.',
    stats: '3 global databases',
  },
];

export function IngestionRibbon() {
  return (
    <section className="w-full py-20 border-y border-outline-variant/30 bg-surface-container-low/40">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-12 gap-4">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-secondary" />
              <span className="font-label-caps-sm text-[11px] text-secondary font-bold uppercase tracking-widest">
                Frictionless Physical Ingestion
              </span>
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl font-bold text-primary tracking-tight">
              Catalog an entire 500-book shelf{' '}
              <br className="hidden sm:inline" />
              before your coffee cools.
            </h2>
          </div>
          <p className="font-sans text-sm sm:text-base text-on-surface-variant max-w-md leading-relaxed">
            The biggest barrier to physical cataloging is tedious manual data
            entry. book(ish) automates the capture pipeline so your physical
            shelves become digital instantly.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {INGESTION_CHANNELS.map(ch => {
            const Icon = ch.icon;
            return (
              <div
                key={ch.title}
                className="rounded-2xl bg-surface-container-lowest border border-outline-variant/40 p-6 flex flex-col justify-between hover:shadow-elevation-1 transition-all duration-300 group"
              >
                <div>
                  <div className="flex items-center justify-between gap-2 mb-4">
                    <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary group-hover:scale-105 transition-transform">
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="font-label-caps-xs text-[9px] font-bold text-secondary uppercase tracking-widest px-2 py-0.5 rounded-md bg-secondary/5 border border-secondary/15">
                      {ch.badge}
                    </span>
                  </div>

                  <h3 className="font-serif text-lg font-bold text-primary mb-2 tracking-tight">
                    {ch.title}
                  </h3>

                  <p className="font-sans text-xs sm:text-sm text-on-surface-variant leading-relaxed mb-6">
                    {ch.description}
                  </p>
                </div>

                <div className="pt-4 border-t border-outline-variant/20 flex items-center justify-between text-xs font-sans text-on-surface-variant/80">
                  <span className="flex items-center gap-1.5 text-emerald-700 font-medium">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Speed
                  </span>
                  <span className="font-mono text-xs font-semibold text-primary">
                    {ch.stats}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
