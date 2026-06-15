import React, {useState, useMemo, useCallback, useEffect} from 'react';
import {useParams, useNavigate, Link} from 'react-router-dom';
import {useAuth} from '../contexts/AuthContext';
import {useLibraryData} from '../hooks/useLibraryData';
import {useBulkEnrichment} from '../hooks/useBulkEnrichment';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import {BulkEnrichmentBanner} from '../components/BulkEnrichmentBanner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {
  History,
  Clock,
  Search,
  BookOpen,
  Sparkles,
  Sliders,
  Calendar,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import {BookLoader} from '../components/BookLoader';
import {Book} from '../types';
import {motion, AnimatePresence} from 'motion/react';

const PRESETS = [
  {
    id: 'all',
    label: 'All-Time Focus',
    zoom: 1,
    text: "A bird's-eye view of your entire collections.",
  },
  {
    id: 'bce',
    label: 'Ancient & BCE Era',
    zoom: 5,
    yearLimit: 0,
    text: 'Isolate historical epics of Antiquity.',
  },
  {
    id: 'modern',
    label: 'Century Highlights',
    zoom: 20,
    text: 'Decompose modern times into decades.',
  },
];

function getCircleSizeClasses(uniqueBookCount: number) {
  if (uniqueBookCount > 100)
    return {outer: 'w-44 h-44', middle: 'w-28 h-28', inner: 'w-10 h-10'};
  if (uniqueBookCount > 20)
    return {outer: 'w-32 h-32', middle: 'w-20 h-20', inner: 'w-8 h-8'};
  if (uniqueBookCount > 5)
    return {outer: 'w-24 h-24', middle: 'w-16 h-16', inner: 'w-6 h-6'};
  if (uniqueBookCount > 1)
    return {outer: 'w-16 h-16', middle: 'w-10 h-10', inner: 'w-5 h-5'};
  return {outer: 'w-12 h-12', middle: 'w-8 h-8', inner: 'w-4 h-4'};
}

const formatYear = (year: number) => {
  if (year < 0) return `${Math.abs(year)} BCE`;
  return `${year} CE`;
};

interface Cluster {
  key: number;
  label: string;
  books: Book[];
}

export default function TimelineView() {
  const {id: libraryId} = useParams<{id: string}>();
  const navigate = useNavigate();
  const {user} = useAuth();

  // Load parent library data using existing custom hook
  const {books, isBooksLoading} = useLibraryData(
    libraryId,
    user?.uid,
    navigate,
  );

  // States
  const [zoomLevel, setZoomLevel] = useState<1 | 5 | 20>(1);
  const [selectedPreset, setSelectedPreset] = useState<string>('all');
  const [selectedClusterKey, setSelectedClusterKey] = useState<number | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isNonHistoricalCollapsed, setIsNonHistoricalCollapsed] =
    useState(true);

  // 2. Scan and check for books needing automated backfill enrichment via our unified hook
  const filterTemporalPredicate = useCallback(
    (b: Book) => !b.temporalMetadata,
    [],
  );

  const {
    isBackfilling,
    progress: backfillProgress,
    inFlightCount,
  } = useBulkEnrichment({
    books,
    isBooksLoading,
    libraryId,
    apiEndpoint: `/api/books/${libraryId}/batch-enrich-temporal`,
    metadataField: 'temporalMetadata',
    batchSize: 20, // Exactly 20 books per request as per spec
    concurrencyLimit: 3, // canonical pool concurrency
    filterPredicate: filterTemporalPredicate,
    successToastMessage: 'Historical temporal analysis complete!',
    errorToastMessage: 'Analysis backfill failed',
  });

  // Telemetry logs for integration with the Debug Console
  useEffect(() => {
    DebugTelemetryEngine.getInstance().addLog(
      'info',
      `[TimelineView] Mounted for library: ${libraryId}`,
      {libraryId},
    );
  }, [libraryId]);

  useEffect(() => {
    DebugTelemetryEngine.getInstance().addLog(
      'info',
      `[TimelineView] Preset changed: "${selectedPreset}" (zoom: ${zoomLevel})`,
      {selectedPreset, zoomLevel},
    );
  }, [selectedPreset, zoomLevel]);

  useEffect(() => {
    DebugTelemetryEngine.getInstance().addLog(
      'info',
      `[TimelineView] Filter updated: search query="${searchQuery}"`,
      {searchQuery},
    );
  }, [searchQuery]);

  // Preset configuration mapper
  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId);
    setSelectedClusterKey(null);
    const preset = PRESETS.find(p => p.id === presetId);
    if (preset) {
      setZoomLevel(preset.zoom as 1 | 5 | 20);
    }
  };

  // Partition raw books
  const historicalBooks = useMemo(() => {
    return books.filter(
      b => b.temporalMetadata && !b.temporalMetadata.isNonHistorical,
    );
  }, [books]);

  const nonHistoricalBooks = useMemo(() => {
    return books.filter(b => b.temporalMetadata?.isNonHistorical === true);
  }, [books]);

  // Dynamic Mathematical Clustering
  const getClusterKey = (startYear: number, zoom: 1 | 5 | 20) => {
    let interval = 500;
    if (zoom === 5) interval = 100;
    if (zoom === 20) interval = 10;
    return Math.floor(startYear / interval) * interval;
  };

  const clusters = useMemo(() => {
    const map: Record<number, Book[]> = {};

    historicalBooks.forEach(b => {
      const year = b.temporalMetadata?.startYear;
      if (year !== undefined && year !== null) {
        // Filter out if currently viewing ancient preset limit
        if (selectedPreset === 'bce' && year > 0) return;

        const k = getClusterKey(year, zoomLevel);
        if (!map[k]) map[k] = [];
        map[k].push(b);
      }
    });

    const list: Cluster[] = Object.keys(map)
      .map(Number)
      .map(key => {
        const cBooks = map[key];

        // Find most frequent eraName in cluster for high-fidelity titles
        const eraNames = cBooks
          .map(b => b.temporalMetadata?.eraName)
          .filter(Boolean) as string[];

        let eraLabel = '';
        if (eraNames.length > 0) {
          const counts: Record<string, number> = {};
          let maxCount = 0;
          eraNames.forEach(n => {
            counts[n] = (counts[n] || 0) + 1;
            if (counts[n] > maxCount) {
              maxCount = counts[n];
              eraLabel = n;
            }
          });
        }

        if (!eraLabel) {
          const interval = zoomLevel === 1 ? 500 : zoomLevel === 5 ? 100 : 10;
          if (zoomLevel === 20) {
            eraLabel = `${formatYear(key)}s Era`;
          } else {
            eraLabel = `${formatYear(key)} - ${formatYear(key + interval - 1)}`;
          }
        }

        return {
          key,
          label: eraLabel,
          books: cBooks,
        };
      });

    return list.sort((a, b) => a.key - b.key);
  }, [historicalBooks, zoomLevel, selectedPreset]);

  // Selected details calculations
  const selectedCluster = useMemo(() => {
    if (selectedClusterKey === null) return null;
    return clusters.find(c => c.key === selectedClusterKey) || null;
  }, [clusters, selectedClusterKey]);

  // Search filtered books inside selected/sidebar lists
  const filteredNonHistorical = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return nonHistoricalBooks;
    return nonHistoricalBooks.filter(
      b =>
        b.title.toLowerCase().includes(query) ||
        (b.author || '').toLowerCase().includes(query),
    );
  }, [nonHistoricalBooks, searchQuery]);

  return (
    <div className="flex-1 bg-background text-on-background flex flex-col md:flex-row min-h-[calc(110vh-4rem)] relative">
      <LibrarySidebarNav libraryId={libraryId} />

      {/* Main Panel Content full-width */}
      <div className="flex-grow flex flex-col w-full min-w-0">
        {/* Primary Stage: Vertical chronological axis scrolling canvas */}
        <section className="flex-grow flex flex-col bg-background relative overflow-hidden">
          {/* Timeline Control Deck */}
          <div className="p-5 border-b border-outline-variant/20 flex flex-col sm:flex-row sm:items-center justify-between gap-4 z-10 bg-background/80 backdrop-blur-md">
            <div>
              <h1 className="font-headline-sm text-headline-sm font-serif tracking-tight text-primary flex items-center gap-2">
                <History className="w-5 h-5" />
                <span>Historical Temporal Timeline</span>
              </h1>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Mapping the chronological coverage and literature setting eras
                of your library
              </p>
            </div>

            {/* Slider and Range presets controls */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              {/* Presets buttons */}
              <div className="flex flex-wrap gap-1 p-1 bg-surface-container rounded-lg text-xs font-medium">
                {PRESETS.map(p => (
                  <button
                    key={p.id}
                    onClick={() => handlePresetSelect(p.id)}
                    className={`py-1.5 px-3 rounded-md transition-all ${selectedPreset === p.id ? 'bg-primary text-primary-foreground shadow' : 'text-on-surface-variant hover:text-on-surface'}`}
                    title={p.text}
                  >
                    {p.label}
                  </button>
                ))}
              </div>

              {/* Slider controls */}
              <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-container rounded-lg">
                <Sliders className="w-4 h-4 text-on-surface-variant shrink-0" />
                <span className="text-xs font-mono font-semibold select-none text-on-surface-variant pr-1">
                  Zoom: {zoomLevel}x
                </span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="1"
                  value={zoomLevel === 1 ? 1 : zoomLevel === 5 ? 2 : 3}
                  onChange={e => {
                    const val = Number(e.target.value);
                    const z = val === 1 ? 1 : val === 2 ? 5 : 20;
                    setZoomLevel(z);
                    setSelectedClusterKey(null);
                  }}
                  className="w-20 accent-primary h-1 bg-outline-variant/50 rounded-lg cursor-pointer focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Backfilling and Sync progress loader indicator */}
          <div className="px-5 pt-4">
            <BulkEnrichmentBanner
              isBackfilling={isBackfilling}
              completed={backfillProgress.completed}
              total={backfillProgress.total}
              title="Scanning Literary Chronologies"
              description="Mapping historical eras..."
              colorTheme="indigo"
              inFlightCount={inFlightCount}
            />
          </div>

          {/* Core Vertical Timeline track Stage */}
          <div className="flex-grow overflow-y-auto p-8 relative min-h-[500px]">
            {isBooksLoading ? (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50">
                <BookLoader size="lg" />
              </div>
            ) : (
              <div className="max-w-2xl mx-auto relative py-6">
                {/* Historical Timeline block if clusters exist */}
                {clusters.length > 0 ? (
                  <div className="relative pl-12 sm:pl-0 sm:flex sm:flex-col sm:items-center pb-12">
                    {/* Central line track */}
                    <div className="absolute left-8 sm:left-1/2 top-0 bottom-0 w-0.5 bg-outline-variant/30 -translate-x-1/2" />

                    <div className="space-y-16 w-full relative">
                      {clusters.map((cluster, idx) => {
                        const isLeft = idx % 2 === 0;
                        const isSelected = selectedClusterKey === cluster.key;
                        const circleSizes = getCircleSizeClasses(
                          cluster.books.length,
                        );

                        return (
                          <motion.div
                            layout
                            initial={{opacity: 0, y: 15}}
                            animate={{opacity: 1, y: 0}}
                            key={cluster.key}
                            className={`relative flex flex-col sm:flex-row items-center w-full ${isLeft ? 'sm:justify-start' : 'sm:justify-end'}`}
                          >
                            {/* Timeline Node core */}
                            <div
                              onClick={() =>
                                setSelectedClusterKey(
                                  isSelected ? null : cluster.key,
                                )
                              }
                              className="absolute left-8 sm:left-1/2 -translate-x-1/2 top-1.5 sm:top-auto cursor-pointer z-10 group"
                            >
                              <div className="relative flex items-center justify-center">
                                {/* Halo ripple glow */}
                                <div
                                  className={`absolute rounded-full border border-primary/20 bg-primary/2 transition-all duration-500 ease-in-out group-hover:scale-110 group-hover:bg-primary/5 ${circleSizes.outer} ${isSelected ? 'scale-110 border-primary/40 bg-primary/8' : 'animate-[pulse_3s_infinite]'}`}
                                />
                                <div
                                  className={`absolute rounded-full border border-primary/30 bg-primary/5 transition-all duration-300 group-hover:scale-105 ${circleSizes.middle} ${isSelected ? 'scale-105 border-primary/50' : ''}`}
                                />
                                <div
                                  className={`absolute rounded-full bg-primary flex items-center justify-center text-primary-foreground font-mono font-semibold text-xs transition-colors shadow-md ${circleSizes.inner} ${isSelected ? 'bg-primary-hover' : ''}`}
                                >
                                  {cluster.books.length}
                                </div>
                              </div>
                            </div>

                            {/* Interactive Epoch Card text wrapper */}
                            <motion.div
                              layout
                              className={`w-full sm:w-[calc(50%-2.5rem)] ml-16 sm:ml-0 overflow-hidden ${isLeft ? 'sm:pr-4 sm:text-right' : 'sm:pl-4 sm:text-left'}`}
                            >
                              <div
                                onClick={() =>
                                  setSelectedClusterKey(
                                    isSelected ? null : cluster.key,
                                  )
                                }
                                className={`p-5 rounded-2xl border transition-all duration-300 text-left ${isSelected ? 'bg-surface-container-high border-primary/50 shadow-md ring-1 ring-primary/20' : 'bg-surface-container-low border-outline-variant/20 shadow-sm hover:border-primary/20 hover:bg-surface-container-high cursor-pointer'}`}
                              >
                                <div className="flex items-center gap-1.5 text-xs font-mono font-medium text-primary uppercase tracking-wider mb-2">
                                  <Calendar className="w-3.5 h-3.5" />
                                  <span>{formatYear(cluster.key)}</span>
                                </div>
                                <h3 className="font-serif font-semibold text-on-surface text-lg text-balance line-clamp-2">
                                  {cluster.label}
                                </h3>
                                <p className="text-xs text-on-surface-variant mt-1.5">
                                  {cluster.books.length} volume
                                  {cluster.books.length > 1 ? 's' : ''} set here
                                </p>
                              </div>
                            </motion.div>
                          </motion.div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center text-center py-16 px-6">
                    <div className="w-16 h-16 bg-surface-variant/40 rounded-full flex items-center justify-center text-on-surface-variant/50 mb-4 animate-[pulse_4s_infinite]">
                      <Clock className="w-8 h-8" />
                    </div>
                    <h3 className="text-lg font-serif font-medium text-on-surface">
                      No Historical Settings Found
                    </h3>
                    <p className="text-sm text-on-surface-variant mt-2 max-w-sm">
                      Add more historical literature, biographies, or narrative
                      settings to mapping your timeline grid.
                    </p>
                  </div>
                )}

                {/* Non-Historical Settings Panel (Below the timeline!) */}
                {filteredNonHistorical.length > 0 && (
                  <div className="mt-12 pt-10 border-t border-outline-variant/20">
                    <div className="flex flex-col gap-4">
                      <button
                        onClick={() =>
                          setIsNonHistoricalCollapsed(!isNonHistoricalCollapsed)
                        }
                        className="flex items-center justify-between w-full text-left focus:outline-none group cursor-pointer"
                        id="toggle-non-historical-settings"
                      >
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                          <h2 className="font-serif font-semibold text-lg text-on-surface group-hover:text-primary transition-colors">
                            Non-Historical Settings (
                            {filteredNonHistorical.length})
                          </h2>
                        </div>
                        {isNonHistoricalCollapsed ? (
                          <ChevronDown className="w-5 h-5 text-on-surface-variant group-hover:text-primary transition-colors" />
                        ) : (
                          <ChevronUp className="w-5 h-5 text-on-surface-variant group-hover:text-primary transition-colors" />
                        )}
                      </button>

                      {!isNonHistoricalCollapsed && (
                        <motion.div
                          initial={{opacity: 0, height: 0}}
                          animate={{opacity: 1, height: 'auto'}}
                          exit={{opacity: 0, height: 0}}
                          transition={{duration: 0.2}}
                          className="flex flex-col gap-4 overflow-hidden"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <p className="text-xs text-on-surface-variant leading-relaxed max-w-lg">
                              {
                                'These companion records and backlog books are set in abstract lore environments, modern scratchpads, or timeless settings without discrete temporal bounds.'
                              }
                            </p>
                            {/* Search input for nonhistorical list */}
                            <div className="relative w-full sm:w-64">
                              <Search className="w-3.5 h-3.5 text-on-surface-variant absolute left-3 top-2.5" />
                              <input
                                type="text"
                                placeholder="Search non-historical..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className="w-full pl-8 pr-3 py-1.5 text-xs bg-surface-container rounded-lg border border-outline-variant/30 text-on-surface focus:outline-none focus:border-primary transition-colors"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-2">
                            {filteredNonHistorical.map(b => (
                              <div
                                key={b.id}
                                className="p-4 bg-surface-container-low border border-outline-variant/10 rounded-2xl flex flex-col gap-2 shadow-sm text-sm"
                              >
                                <div>
                                  <div className="font-medium text-on-surface/90 truncate">
                                    {b.title}
                                  </div>
                                  <div className="text-xs text-on-surface-variant truncate">
                                    {b.author || 'Unknown'}
                                  </div>
                                </div>
                                {b.temporalMetadata?.rationale && (
                                  <p className="text-xs text-on-surface-variant italic line-clamp-3 mt-1 leading-relaxed">
                                    &ldquo;{b.temporalMetadata.rationale}&rdquo;
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Selected Epoch Details Panel: Drawer/Sidebar popout */}
        <AnimatePresence>
          {selectedCluster && (
            <motion.div
              key={`selected-cluster-${selectedCluster.key}`}
              initial={{opacity: 0, x: 200}}
              animate={{opacity: 1, x: 0}}
              exit={{opacity: 0, x: 200}}
              className="w-full lg:w-96 border-l border-outline-variant/20 bg-surface-container-low flex flex-col shrink-0 overflow-hidden"
            >
              <div className="p-6 border-b border-outline-variant/20 flex items-center justify-between">
                <div>
                  <h3 className="font-serif font-semibold text-on-surface text-lg">
                    {selectedCluster.label}
                  </h3>
                  <div className="text-xs font-mono font-medium text-primary mt-0.5">
                    {formatYear(selectedCluster.key)} Epoch
                  </div>
                </div>
                <button
                  onClick={() => setSelectedClusterKey(null)}
                  className="p-1.5 rounded-full hover:bg-surface-container text-on-surface-variant transition-colors"
                >
                  <XIcon className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-grow overflow-y-auto p-4 space-y-4 max-h-[calc(100vh-14rem)]">
                {selectedCluster.books.map(b => (
                  <div
                    key={b.id}
                    className="p-4 bg-surface-container border border-outline-variant/30 rounded-2xl flex flex-col gap-3 group hover:border-primary/20 transition-all shadow-sm"
                  >
                    <div className="flex gap-3">
                      {b.coverUrl ? (
                        <div className="w-14 h-20 rounded-lg overflow-hidden border border-outline-variant/20 bg-surface-variant shrink-0 shadow-sm">
                          <img
                            src={b.coverUrl}
                            alt={b.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            referrerPolicy="no-referrer"
                          />
                        </div>
                      ) : (
                        <div className="w-14 h-20 rounded-lg bg-surface-variant/40 flex items-center justify-center text-primary/60 font-serif font-semibold text-lg shrink-0 border border-outline-variant/10 shadow-sm">
                          {b.title[0]?.toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <Link
                          to={`/library/${libraryId}/book/${b.id}`}
                          className="font-serif font-medium text-on-surface text-sm line-clamp-2 hover:text-primary transition-colors"
                        >
                          {b.title}
                        </Link>
                        <div className="text-xs text-on-surface-variant truncate mt-0.5">
                          by {b.author || 'Unknown Author'}
                        </div>
                        {b.publishedDate && (
                          <div className="text-[10px] font-mono font-medium text-on-surface-variant/70 mt-1">
                            Published: {b.publishedDate}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-outline-variant/10 text-xs text-on-surface-variant">
                      <div className="flex items-center gap-1 text-primary font-mono text-[10px] font-semibold uppercase tracking-wider mb-1">
                        <Sparkles className="w-3.5 h-3.5" />
                        <span>
                          Analysis (
                          {formatYear(b.temporalMetadata?.startYear || 0)} -{' '}
                          {formatYear(b.temporalMetadata?.endYear || 0)})
                        </span>
                      </div>
                      <p className="italic line-clamp-3">
                        &ldquo;{b.temporalMetadata?.rationale}&rdquo;
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function XIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      strokeWidth={2}
      stroke="currentColor"
      className={props.className}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18 18 6M6 6l12 12"
      />
    </svg>
  );
}
