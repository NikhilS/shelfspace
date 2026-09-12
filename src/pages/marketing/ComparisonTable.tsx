import React from 'react';
import {Check, X, Sparkles} from 'lucide-react';

const COMPARISON_ROWS = [
  {
    feature: 'Continuous Shelf Camera & Barcode Ingestion',
    bookish: 'Continuous camera sweeps & instant barcode scanner',
    goodreads: 'Single barcode or manual typing',
    spreadsheets: '100% manual keyboard typing',
  },
  {
    feature: 'Thematic Exploration',
    bookish: 'Interactive 3D Semantic Constellation Universe',
    goodreads: 'Flat paginated list',
    spreadsheets: 'Rows and columns',
  },
  {
    feature: 'Autonomous Metadata & Cover Healing',
    bookish: 'Continuous Gemini Spruce-Up engine',
    goodreads: 'Vulnerable to broken community edits',
    spreadsheets: 'Manual copy-paste from web',
  },
  {
    feature: 'Geographic & Chronological Mapping',
    bookish: 'Interactive narrative World Map & Deep-Time timeline',
    goodreads: 'None',
    spreadsheets: 'None',
  },
  {
    feature: 'Personal AI Literary Sommelier',
    bookish: 'Daily "Pick of the Day" with shelf-aware reasoning',
    goodreads: 'Amazon-driven algorithmic sponsored ads',
    spreadsheets: 'None',
  },
  {
    feature: 'Privacy & Collector Architecture',
    bookish: 'Zero ads. Private by default. Offline cache.',
    goodreads: 'Ad-supported social media platform',
    spreadsheets: 'Private but clunky',
  },
  {
    feature: 'Collaborative Family & Club Shelves',
    bookish: 'Granular permissions (Owner, Editor, Viewer)',
    goodreads: 'Read-only profile links',
    spreadsheets: 'Accidental overwrites & formula breaks',
  },
];

export function ComparisonTable() {
  return (
    <section className="w-full py-24 sm:py-32 bg-background border-t border-outline-variant/30">
      <div className="max-w-[1200px] mx-auto px-6 sm:px-12">
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-secondary/10 border border-secondary/20 mb-4">
            <Sparkles className="w-3.5 h-3.5 text-secondary" />
            <span className="font-label-caps-sm text-[11px] text-secondary font-bold uppercase tracking-widest">
              Purpose-Built For Physical Books
            </span>
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold text-primary tracking-tight mb-4">
            Built for book lovers, not social feeds.
          </h2>
          <p className="font-sans text-base sm:text-lg text-on-surface-variant leading-relaxed">
            See how book(ish) compares to legacy tracking tools and DIY
            spreadsheets.
          </p>
        </div>

        {/* Table Container */}
        <div className="rounded-3xl border border-outline-variant/40 bg-surface-container-lowest shadow-elevation-1 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[700px]">
              <thead>
                <tr className="border-b border-outline-variant/30 bg-surface-container-low/60">
                  <th className="p-5 sm:p-6 font-serif text-sm sm:text-base font-bold text-on-surface w-2/5">
                    Cataloging Capability
                  </th>
                  <th className="p-5 sm:p-6 font-serif text-base sm:text-lg font-bold text-primary bg-secondary/10 border-x border-secondary/20 w-1/4">
                    <div className="flex items-center gap-2">
                      <span>book(ish)</span>
                      <span className="px-2 py-0.5 rounded-full bg-secondary text-on-secondary text-[10px] font-sans font-bold uppercase tracking-wider">
                        Vault
                      </span>
                    </div>
                  </th>
                  <th className="p-5 sm:p-6 font-serif text-sm sm:text-base font-medium text-on-surface-variant w-1/5">
                    Goodreads / Amazon
                  </th>
                  <th className="p-5 sm:p-6 font-serif text-sm sm:text-base font-medium text-on-surface-variant w-1/5">
                    Spreadsheets / Notion
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-outline-variant/20 font-sans text-xs sm:text-sm">
                {COMPARISON_ROWS.map(row => (
                  <tr
                    key={row.feature}
                    className="hover:bg-surface-container-low/40 transition-colors"
                  >
                    <td className="p-5 sm:p-6 font-medium text-on-surface">
                      {row.feature}
                    </td>
                    <td className="p-5 sm:p-6 bg-secondary/5 border-x border-secondary/20 font-semibold text-primary">
                      <div className="flex items-start gap-2">
                        <Check className="w-4 h-4 text-emerald-600 mt-0.5 shrink-0" />
                        <span>{row.bookish}</span>
                      </div>
                    </td>
                    <td className="p-5 sm:p-6 text-on-surface-variant/80">
                      {row.goodreads === 'None' ? (
                        <div className="flex items-center gap-1.5 text-on-surface-variant/50">
                          <X className="w-4 h-4" />
                          <span>None</span>
                        </div>
                      ) : (
                        row.goodreads
                      )}
                    </td>
                    <td className="p-5 sm:p-6 text-on-surface-variant/80">
                      {row.spreadsheets === 'None' ? (
                        <div className="flex items-center gap-1.5 text-on-surface-variant/50">
                          <X className="w-4 h-4" />
                          <span>None</span>
                        </div>
                      ) : (
                        row.spreadsheets
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
