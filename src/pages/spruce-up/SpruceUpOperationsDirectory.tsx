import React, {useState} from 'react';
import {
  Wand2,
  RefreshCw,
  Sparkles,
  Database,
  Info,
  ChevronDown,
  ChevronUp,
  Sliders,
  Sparkle,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Book} from '../../types';

interface SpruceUpOperationsDirectoryProps {
  books: Book[];
  duplicateGroupsCount: number;
  selectedCount: number;
  isOnline: boolean;
  isProcessing: boolean;
  progress: number;
  onFixMetadata: () => void;
  onForceResyncAll: () => void;
  onFixGenreAPI: () => void;
  onForceGenreAPI: () => void;
  onFixGenreAI: () => void;
  onForceGenreAI: () => void;
  emptyCoverUrls?: Set<string>;
}

export function SpruceUpOperationsDirectory({
  books,
  duplicateGroupsCount,
  selectedCount,
  isOnline,
  isProcessing,
  onFixMetadata,
  onForceResyncAll,
  onFixGenreAPI,
  onForceGenreAPI,
  onFixGenreAI,
  onForceGenreAI,
  emptyCoverUrls,
}: Omit<SpruceUpOperationsDirectoryProps, 'progress'>) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<
    'all' | 'metadata' | 'genre' | 'duplicate'
  >('all');

  // Compute neat metrics
  const totalBooks = books.length;
  const missingMetadataCount = books.filter(
    b =>
      !b.synopsis ||
      !b.publishedDate ||
      !b.coverUrl ||
      (emptyCoverUrls && b.coverUrl && emptyCoverUrls.has(b.coverUrl)),
  ).length;
  const missingGenreCount = books.filter(
    b => !b.genres || b.genres.length === 0,
  ).length;

  // Operation details matrix
  const operations = [
    {
      id: 'fix_metadata',
      name: 'Fix Missing Metadata',
      category: 'metadata',
      type: 'Traditional API',
      engine: 'OpenLibrary & Google Books',
      icon: <Wand2 className="w-4 h-4 text-secondary" />,
      description:
        'Scans selected books for missing summaries, page count, or release years and fills them sequentially using public indexes.',
      recommended:
        'When book files are imported without back-cover descriptions or publication metadata.',
      onExecute: onFixMetadata,
      isAi: false,
    },
    {
      id: 'force_metadata',
      name: 'Force Sync All Metadata',
      category: 'metadata',
      type: 'Traditional API',
      engine: 'OpenLibrary & Google Books',
      icon: <RefreshCw className="w-4 h-4 text-on-surface-variant/75" />,
      description:
        'Ignores existing cached values and forces a deep overwrite of summaries, publisher names, and high-fidelity cover URLs.',
      recommended:
        'When existing metadata is broken, cropped, or needs clean, fresh index updates.',
      onExecute: onForceResyncAll,
      isAi: false,
    },
    {
      id: 'fix_genre_api',
      name: 'Traditional Genre Match',
      category: 'genre',
      type: 'Traditional API',
      engine: 'Google Books Categories',
      icon: <Wand2 className="w-4 h-4 text-emerald-700" />,
      description:
        'Queries publisher-provided subject indexes specifically matching the book ISBN, setting exact physical catalog categories.',
      recommended:
        'Safe, standard classification mirroring official distributor registers.',
      onExecute: onFixGenreAPI,
      isAi: false,
    },
    {
      id: 'force_genre_api',
      name: 'Sync Genre from API',
      category: 'genre',
      type: 'Traditional API',
      engine: 'Google Books Categories',
      icon: <RefreshCw className="w-4 h-4 text-emerald-800" />,
      description:
        'Overwrites existing genre attributes with standard subjects imported from traditional catalog registries.',
      recommended:
        'To strip away custom tags and revert back to standard library index codes.',
      onExecute: onForceGenreAPI,
      isAi: false,
    },
    {
      id: 'fix_genre_ai',
      name: 'BISAC AI Classification',
      category: 'genre',
      type: 'Generative AI',
      engine: 'Gemini Pro Context Engine',
      icon: <Sparkles className="w-4 h-4 text-secondary" />,
      description:
        'Feeds the title, author, and synopses into Gemini. Generates highly accurate scholarly BISAC subject tags (e.g. HISTORY / Ancient).',
      recommended:
        'Highly recommended for classics, contemporary novels, or loose pamphlets where APIs serve dry or empty categories.',
      onExecute: onFixGenreAI,
      isAi: true,
    },
    {
      id: 'force_genre_ai',
      name: 'Force AI Classify (BISAC)',
      category: 'genre',
      type: 'Generative AI',
      engine: 'Gemini Pro Context Engine',
      icon: <Sparkle className="w-4 h-4 text-amber-600 animate-pulse" />,
      description:
        'Forces Gemini to evaluate your entire selection and re-align genres to strict BISAC taxonomical standard guidelines.',
      recommended:
        'To curate a cohesive, uniform catalog layout across the thematic Constellation Map.',
      onExecute: onForceGenreAI,
      isAi: true,
    },
  ];

  // Filter operations based on selected directory tab
  const filteredOperations = operations.filter(
    op => activeTab === 'all' || op.category === activeTab,
  );

  return (
    <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-sm overflow-hidden mb-8 transition-all">
      {/* Header section with toggle */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        className="bg-primary/5 px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-primary/10 transition-colors border-b border-outline-variant/20 select-none"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary/10 text-primary rounded-lg">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-serif text-lg font-bold text-primary tracking-tight">
              Archivist Operations Directory
            </h3>
            <p className="font-sans text-[11px] text-on-surface-variant/80">
              Technical reference and console control workspace for all
              automated curing and integrity tools.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="hidden sm:inline-flex bg-secondary-container/10 border border-secondary/20 rounded px-2.5 py-0.5 font-sans text-[10px] font-bold text-secondary uppercase tracking-wider">
            Traditional API & Gemini Pro
          </span>
          {isExpanded ? (
            <ChevronUp className="w-4 h-4 text-on-surface-variant" />
          ) : (
            <ChevronDown className="w-4 h-4 text-on-surface-variant" />
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="p-6">
          {/* Quick Stats overview bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/20 flex flex-col justify-between">
              <span className="font-sans text-[10px] font-bold tracking-wider text-on-surface-variant uppercase">
                Library Ledger
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <span className="font-serif text-2xl font-bold text-primary">
                  {totalBooks}
                </span>
                <span className="font-sans text-[10px] text-on-surface-variant">
                  Volumes
                </span>
              </div>
            </div>

            <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/20 flex flex-col justify-between">
              <span className="font-sans text-[10px] font-bold tracking-wider text-on-surface-variant uppercase">
                Missing Details
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <span
                  className={`font-serif text-2xl font-bold ${missingMetadataCount > 0 ? 'text-amber-700' : 'text-emerald-700'}`}
                >
                  {missingMetadataCount}
                </span>
                <span className="font-sans text-[10px] text-on-surface-variant">
                  Anomalies
                </span>
              </div>
            </div>

            <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/20 flex flex-col justify-between">
              <span className="font-sans text-[10px] font-bold tracking-wider text-on-surface-variant uppercase">
                Loose Genres
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <span
                  className={`font-serif text-2xl font-bold ${missingGenreCount > 0 ? 'text-amber-800' : 'text-emerald-700'}`}
                >
                  {missingGenreCount}
                </span>
                <span className="font-sans text-[10px] text-on-surface-variant">
                  Unclassified
                </span>
              </div>
            </div>

            <div className="bg-surface-container-low p-4 rounded-lg border border-outline-variant/20 flex flex-col justify-between">
              <span className="font-sans text-[10px] font-bold tracking-wider text-on-surface-variant uppercase">
                Duplicate Groups
              </span>
              <div className="flex items-baseline justify-between mt-1">
                <span
                  className={`font-serif text-2xl font-bold ${duplicateGroupsCount > 0 ? 'text-error' : 'text-emerald-700'}`}
                >
                  {duplicateGroupsCount}
                </span>
                <span className="font-sans text-[10px] text-on-surface-variant">
                  Signatures
                </span>
              </div>
            </div>
          </div>

          {/* Directory Tabs */}
          <div className="flex border-b border-outline-variant/30 gap-1 mb-6">
            {[
              {id: 'all', label: 'All Operations'},
              {id: 'metadata', label: 'Metadata APIs'},
              {id: 'genre', label: 'BISAC & AI Classifications'},
              {id: 'duplicate', label: 'Security & Duplicate Merges'},
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                className={`py-2 px-4 font-sans text-xs font-bold uppercase tracking-wider transition-all border-b-2 -mb-[1px] ${
                  activeTab === tab.id
                    ? 'border-secondary text-secondary font-extrabold'
                    : 'border-transparent text-on-surface-variant hover:text-primary hover:bg-surface-container/30'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'duplicate' ? (
            <div className="bg-surface-container-low p-5 rounded-lg border border-outline-variant/20 space-y-4">
              <div className="flex items-start gap-3">
                <div className="p-2 bg-error/10 text-error rounded">
                  <Database className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="font-serif text-sm font-bold text-primary">
                    ISBN Fingerprinting & Metadata Merging Engine
                  </h4>
                  <p className="font-sans text-xs text-on-surface-variant mt-1 leading-relaxed">
                    book(ish) runs strict client-side evaluation rules to keep
                    catalog indices pristine. Our duplicate engine looks for two
                    common ledger anomalies:
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="bg-surface p-4 rounded border border-outline-variant/20">
                  <h5 className="font-serif text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 bg-secondary rounded-full" />
                    ISBN formatting match
                  </h5>
                  <p className="font-sans text-[11px] text-on-surface-variant leading-relaxed">
                    Truncates hyphens, spaces, and checksum coordinates from
                    ISBN10/ISBN13 inputs, matching exact publication targets.
                  </p>
                </div>

                <div className="bg-surface p-4 rounded border border-outline-variant/20">
                  <h5 className="font-serif text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5 mb-1">
                    <span className="w-1.5 h-1.5 bg-secondary rounded-full" />
                    Title + Author signature match
                  </h5>
                  <p className="font-sans text-[11px] text-on-surface-variant leading-relaxed">
                    Evaluates normalized text strings when no ISBN is entered,
                    ensuring historical variants do not clutter bookshelves.
                  </p>
                </div>
              </div>

              <div className="bg-surface/60 p-3 rounded text-[11px] font-sans text-on-surface-variant leading-relaxed border border-outline-variant/20 flex gap-2.5 items-center">
                <Info className="w-4 h-4 text-secondary flex-shrink-0" />
                <span>
                  <strong>Tip:</strong> If you intentionally own multiple copies
                  of a volume, click "Allow Duplicate" in the suggestion cards
                  below to whitelist them from indexing scans.
                </span>
              </div>
            </div>
          ) : (
            /* TABULAR DIRECTORY MATRIX */
            <div className="border border-outline-variant/20 rounded-lg overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left font-sans text-xs border-collapse">
                  <thead>
                    <tr className="bg-surface-container border-b border-outline-variant/30 text-on-surface-variant uppercase text-[10px] font-bold tracking-widest">
                      <th className="py-3 px-4">Tool & Engine</th>
                      <th className="py-3 px-4 hidden md:table-cell">
                        Algorithm Category
                      </th>
                      <th className="py-3 px-4">How it works</th>
                      <th className="py-3 px-4 hidden sm:table-cell">
                        Recommended When
                      </th>
                      <th className="py-3 px-4 text-right">Console Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {filteredOperations.map(op => (
                      <tr
                        key={op.id}
                        className="hover:bg-surface-container-low/30 transition-all"
                      >
                        {/* Name column */}
                        <td className="py-3.5 px-4 font-bold text-primary min-w-[140px]">
                          <div className="flex items-center gap-2">
                            {op.icon}
                            <div>
                              <span className="font-serif text-xs font-bold block leading-none">
                                {op.name}
                              </span>
                              <span className="font-sans text-[9px] text-secondary tracking-wide block mt-1">
                                {op.engine}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Category badge */}
                        <td className="py-3.5 px-4 hidden md:table-cell">
                          <span
                            className={`inline-flex px-2 py-0.5 rounded font-sans text-[9px] font-bold uppercase tracking-wide border ${
                              op.isAi
                                ? 'bg-secondary/10 text-secondary border-secondary/20'
                                : 'bg-primary/5 text-primary border-primary/15'
                            }`}
                          >
                            {op.type}
                          </span>
                        </td>

                        {/* Description */}
                        <td className="py-3.5 px-4 font-sans text-[11px] text-on-surface-variant/90 max-w-[280px] leading-relaxed">
                          {op.description}
                        </td>

                        {/* Recommendation */}
                        <td className="py-3.5 px-4 hidden sm:table-cell font-sans text-[11px] text-on-surface-variant/80 italic leading-relaxed max-w-[220px]">
                          {op.recommended}
                        </td>

                        {/* Action buttons list */}
                        <td className="py-3.5 px-4 text-right min-w-[140px]">
                          {selectedCount > 0 ? (
                            <Button
                              onClick={op.onExecute}
                              disabled={isProcessing || !isOnline}
                              size="xs"
                              className={`font-sans text-[9px] py-1 px-3 uppercase tracking-wider font-extrabold shadow-sm ${
                                op.isAi
                                  ? 'bg-primary text-white hover:bg-primary-container'
                                  : 'bg-white hover:bg-surface-container border border-outline-variant text-on-surface'
                              }`}
                            >
                              Run ({selectedCount})
                            </Button>
                          ) : (
                            <div className="text-[10px] font-sans text-on-surface-variant/50 pr-2">
                              Select books to run
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Selector guide callout helpful prompt */}
          {selectedCount === 0 && (
            <div className="mt-4 p-3 bg-surface-container-low border border-outline-variant/10 rounded text-[11px] font-sans text-on-surface-variant flex gap-2.5 items-center">
              <Info className="w-3.5 h-3.5 text-secondary flex-shrink-0" />
              <span>
                To execute any of these tools directly on specific volumes,
                simply <strong>tick the checkboxes next to the books</strong> in
                the catalog list below.
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
