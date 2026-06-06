import React, {useMemo, useState} from 'react';
import {useParams} from 'react-router-dom';
import {LibrarySidebarNav} from '../components/LibrarySidebarNav';
import {motion} from 'motion/react';
import {ErrorBoundary} from '../components/ErrorBoundary';
import {useSpruceUp} from './spruce-up/useSpruceUp';
import {useOnlineStatus} from '../hooks/useOnlineStatus';
import {DuplicateSection} from './spruce-up/DuplicateSection';
import {LibraryIntegrityTable} from './spruce-up/LibraryIntegrityTable';
import {OperationsConsole} from './spruce-up/OperationsConsole';
import {PageLoading} from '../components/PageLoading';
import {
  FileText,
  Bookmark,
  Image as ImageIcon,
  BookOpen,
  Sparkles,
  Loader2,
  Wand2,
  RefreshCw,
  Sparkle,
  FileSpreadsheet,
  Layers,
  ChevronUp,
  X,
} from 'lucide-react';
import {AnimatePresence} from 'motion/react';

export default function SpruceUpView() {
  const {id: libraryId} = useParams<{id: string}>();
  const isOnline = useOnlineStatus();
  const [showAllActions, setShowAllActions] = useState(false);
  const {
    booksWithDetails,
    loading,
    duplicates,
    processingIds,
    fixingAll,
    fixingProgress,
    selectedIds,
    filter,
    setFilter,
    toggleSelect,
    handleDelete,
    handleAllowDuplicateGroup,
    handleBulkFixMetadata,
    handleBulkForceResync,
    handleBulkFixGenreAPI,
    handleBulkForceGenreAPI,
    handleBulkFixGenreAI,
    handleBulkForceGenreAI,
    emptyCoverUrls,
    activeJob,
  } = useSpruceUp(libraryId);

  // Pre-calculate filtered counts for Diagnostic Bento Cards
  const missingMetadataBooks = useMemo(() => {
    return booksWithDetails.filter(b => {
      const isMissingGenre = !b.genres || b.genres.length === 0;
      const isMissingMetadata =
        !b.synopsis ||
        !b.publishedDate ||
        !b.coverUrl ||
        emptyCoverUrls.has(b.coverUrl);
      return isMissingMetadata || isMissingGenre;
    });
  }, [booksWithDetails, emptyCoverUrls]);

  const missingGenreBooks = useMemo(() => {
    return booksWithDetails.filter(b => !b.genres || b.genres.length === 0);
  }, [booksWithDetails]);

  const missingCoverBooks = useMemo(() => {
    return booksWithDetails.filter(b => {
      const isMissingCover = !b.coverUrl || emptyCoverUrls.has(b.coverUrl);
      const isLowResCover = b.coverUrl && b.coverUrl.includes('zoom=1');
      return isMissingCover || isLowResCover;
    });
  }, [booksWithDetails, emptyCoverUrls]);

  const filteredBooks = useMemo(() => {
    return booksWithDetails.filter(b => {
      const isMissingGenre = !b.genres || b.genres.length === 0;
      const isMissingMetadata =
        !b.synopsis ||
        !b.publishedDate ||
        !b.coverUrl ||
        emptyCoverUrls.has(b.coverUrl);
      const isLowResCover = b.coverUrl && b.coverUrl.includes('zoom=1');
      const isMissingCover = !b.coverUrl || emptyCoverUrls.has(b.coverUrl);

      if (filter === 'missing_metadata')
        return isMissingMetadata || isMissingGenre;
      if (filter === 'missing_genre') return isMissingGenre;
      if (filter === 'low_res_cover') return isLowResCover;
      if (filter === 'missing_cover') return isMissingCover;
      return true;
    });
  }, [booksWithDetails, filter, emptyCoverUrls]);

  const activeProgressPercentage = useMemo(() => {
    const currentCount = fixingAll ? fixingProgress : activeJob?.progress || 0;
    const totalCount = fixingAll ? selectedIds.size : activeJob?.total || 1;
    return Math.min(100, Math.round((currentCount / (totalCount || 1)) * 100));
  }, [fixingAll, fixingProgress, activeJob, selectedIds.size]);

  if (loading) {
    return (
      <PageLoading
        title="Scanning for anomalies..."
        subtitle="Analyzing duplicates and identifying missing metadata in your collection."
      />
    );
  }

  // Handle active "Select/Queue All" operation based on active lens
  const handleSelectAllFiltered = () => {
    const allSelected = filteredBooks.every(b => selectedIds.has(b.id));
    if (allSelected) {
      filteredBooks.forEach(b => {
        if (selectedIds.has(b.id)) toggleSelect(b.id);
      });
    } else {
      filteredBooks.forEach(b => {
        if (!selectedIds.has(b.id)) toggleSelect(b.id);
      });
    }
  };

  const mobileActions = [
    {
      title: 'Smart Fill Missing Metadata',
      description:
        'Safe lookups that populate missing descriptions and details while preserving original fields.',
      icon: <Wand2 className="w-5 h-5 text-amber-400" />,
      action: () => {
        setShowAllActions(false);
        void handleBulkFixMetadata();
      },
      badge: 'Metadata Fill',
    },
    {
      title: 'Deep Overwrite Metadata',
      description: 'Forces complete overwrite check from Google Books.',
      icon: <RefreshCw className="w-5 h-5 text-teal-400" />,
      action: () => {
        setShowAllActions(false);
        void handleBulkForceResync();
      },
      badge: 'Deep Re-Scrape',
    },
    {
      title: 'AI Classify Genres (Gemini)',
      description:
        'Uses Gemini models to align volume titles & metadata against BISAC taxonomies.',
      icon: <Sparkles className="w-5 h-5 text-indigo-400" />,
      action: () => {
        setShowAllActions(false);
        void handleBulkFixGenreAI();
      },
      badge: 'Gemini AI',
    },
    {
      title: 'Force AI Taxonomy Alignment',
      description: 'Fully classifies all active target genres and clusters.',
      icon: <Sparkle className="w-5 h-5 text-pink-400" />,
      action: () => {
        setShowAllActions(false);
        void handleBulkForceGenreAI();
      },
      badge: 'Aggressive AI',
    },
    {
      title: 'API Catalog Genre Classification',
      description: 'Pulls pure publisher registration registers.',
      icon: <FileSpreadsheet className="w-5 h-5 text-emerald-400" />,
      action: () => {
        setShowAllActions(false);
        void handleBulkFixGenreAPI();
      },
      badge: 'API Subjects',
    },
    {
      title: 'Force Sync API Catalog Subjects',
      description:
        'Overwrites current categories with API publishers raw data.',
      icon: <Layers className="w-5 h-5 text-blue-400" />,
      action: () => {
        setShowAllActions(false);
        void handleBulkForceGenreAPI();
      },
      badge: 'API Subject Force',
    },
  ];

  return (
    <>
      <LibrarySidebarNav libraryId={libraryId} />
      <div className="layout-page-content pb-24 lg:pb-8">
        <div className="layout-header mb-6">
          <div>
            <h2 className="layout-header-title text-3xl font-serif tracking-tight pr-4">
              Shelf Care
            </h2>
            <p className="layout-header-subtitle font-sans text-xs sm:text-sm text-on-surface-variant/80 mt-1 max-w-2xl leading-relaxed">
              Time for a little tidy-up! Audit your collection's health, patch
              up missing summaries, and organize genres using friendly Gemini
              AI.
            </p>
          </div>
        </div>

        <ErrorBoundary name="Spruce Up View Workspace">
          {/* STEP 1: INTERACTIVE DIAGNOSTIC LENSES (COMPACT, HORIZONTAL SCROLL ON MOBILE, SINGLE-ROW GRID ON DESKTOP) */}
          <div className="flex overflow-x-auto pb-3 mb-6 sm:mb-8 -mx-4 px-4 sm:mx-0 sm:px-0 scrollbar-none gap-3 sm:grid sm:grid-cols-4">
            {/* LENS A: Description Gaps */}
            <button
              type="button"
              onClick={() => setFilter('missing_metadata')}
              aria-label="Missing Metadata"
              className={`flex items-center justify-between gap-3 border rounded-xl p-3 sm:p-3.5 transition-all cursor-pointer select-none shadow-sm flex-shrink-0 w-[220px] sm:w-auto text-left ${
                filter === 'missing_metadata'
                  ? 'bg-primary/[0.04] border-primary ring-1 ring-primary/20'
                  : 'bg-surface hover:bg-surface-variant/10 border-outline-variant/30 hover:border-outline-variant/60'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 sm:p-2 bg-amber-500/10 text-amber-600 rounded-lg flex-shrink-0">
                  <FileText className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-sans font-bold text-xs text-on-surface leading-tight truncate">
                    Summary Gaps
                  </h4>
                  <p className="text-[9px] text-on-surface-variant leading-none mt-0.5 truncate">
                    Needs description or cover art
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs sm:text-sm font-black text-amber-600 bg-amber-500/5 px-2 py-0.5 rounded-full flex-shrink-0">
                {missingMetadataBooks.length}
              </span>
            </button>

            {/* LENS B: Unclassified / Missing Taxonomy */}
            <button
              type="button"
              onClick={() => setFilter('missing_genre')}
              aria-label="Missing Genre"
              className={`flex items-center justify-between gap-3 border rounded-xl p-3 sm:p-3.5 transition-all cursor-pointer select-none shadow-sm flex-shrink-0 w-[220px] sm:w-auto text-left ${
                filter === 'missing_genre'
                  ? 'bg-primary/[0.04] border-primary ring-1 ring-primary/20'
                  : 'bg-surface hover:bg-surface-variant/10 border-outline-variant/30 hover:border-outline-variant/60'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 sm:p-2 bg-indigo-500/10 text-indigo-600 rounded-lg flex-shrink-0">
                  <Bookmark className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-sans font-bold text-xs text-on-surface leading-tight truncate">
                    Mystery Genres
                  </h4>
                  <p className="text-[9px] text-on-surface-variant leading-none mt-0.5 truncate">
                    Unclassified genre territory
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs sm:text-sm font-black text-indigo-600 bg-indigo-500/5 px-2 py-0.5 rounded-full flex-shrink-0">
                {missingGenreBooks.length}
              </span>
            </button>

            {/* LENS C: Cover Illustrations */}
            <button
              type="button"
              onClick={() => setFilter('missing_cover')}
              aria-label="No Cover"
              className={`flex items-center justify-between gap-3 border rounded-xl p-3 sm:p-3.5 transition-all cursor-pointer select-none shadow-sm flex-shrink-0 w-[220px] sm:w-auto text-left ${
                filter === 'missing_cover' || filter === 'low_res_cover'
                  ? 'bg-primary/[0.04] border-primary ring-1 ring-primary/20'
                  : 'bg-surface hover:bg-surface-variant/10 border-outline-variant/30 hover:border-outline-variant/60'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 sm:p-2 bg-teal-500/10 text-teal-600 rounded-lg flex-shrink-0">
                  <ImageIcon className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-sans font-bold text-xs text-on-surface leading-tight truncate">
                    Covers & Art
                  </h4>
                  <p className="text-[9px] text-on-surface-variant leading-none mt-0.5 truncate">
                    Cover art is missing or blurry
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs sm:text-sm font-black text-teal-600 bg-teal-500/5 px-2 py-0.5 rounded-full flex-shrink-0">
                {missingCoverBooks.length}
              </span>
            </button>

            {/* LENS D: All Books / General Registry */}
            <button
              type="button"
              onClick={() => setFilter('all')}
              aria-label="Show All"
              className={`flex items-center justify-between gap-3 border rounded-xl p-3 sm:p-3.5 transition-all cursor-pointer select-none shadow-sm flex-shrink-0 w-[220px] sm:w-auto text-left ${
                filter === 'all'
                  ? 'bg-primary/[0.04] border-primary ring-1 ring-primary/20'
                  : 'bg-surface hover:bg-surface-variant/10 border-outline-variant/30 hover:border-outline-variant/60'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="p-1.5 sm:p-2 bg-primary/10 text-primary rounded-lg flex-shrink-0">
                  <BookOpen className="w-4 h-4 sm:w-4.5 sm:h-4.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="font-sans font-bold text-xs text-on-surface leading-tight truncate">
                    All Volumes
                  </h4>
                  <p className="text-[9px] text-on-surface-variant leading-none mt-0.5 truncate">
                    Your entire book collection
                  </p>
                </div>
              </div>
              <span className="font-mono text-xs sm:text-sm font-black text-primary bg-primary/5 px-2 py-0.5 rounded-full flex-shrink-0">
                {booksWithDetails.length}
              </span>
            </button>
          </div>

          <motion.div
            initial={{opacity: 0, y: 12}}
            animate={{opacity: 1, y: 0}}
            transition={{duration: 0.4, ease: 'easeOut', delay: 0.15}}
            className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
          >
            {/* LEFT COLUMN: ACTIVE WORKSPACE QUEUE (COL-SPAN 8) */}
            <div className="lg:col-span-8 flex flex-col gap-8">
              {/* SECTION 1: CATALOG INTEGRITY LIST */}
              <section className="space-y-4">
                <div className="flex items-center justify-between border-b border-outline-variant/30 pb-2.5">
                  <h3 className="text-sm font-sans font-bold uppercase tracking-wider text-on-surface-variant">
                    <span>Library Integrity</span> Anomaly Queue (
                    {filteredBooks.length} volumes detected)
                  </h3>

                  <div className="text-[11px] text-on-surface-variant flex items-center gap-1.5 font-medium">
                    <span className="px-2 py-0.5 bg-surface-container border border-outline-variant/30 rounded-md font-sans">
                      Active Filter:{' '}
                      <span className="font-bold text-primary uppercase">
                        {filter.replace('_', ' ')}
                      </span>
                    </span>
                  </div>
                </div>

                <LibraryIntegrityTable
                  books={booksWithDetails}
                  selectedIds={selectedIds}
                  onToggleSelect={toggleSelect}
                  onToggleSelectAll={handleSelectAllFiltered}
                  filter={filter}
                  emptyCoverUrls={emptyCoverUrls}
                />
              </section>

              {/* SECTION 2: DUPLICATES PIPELINE (ONLY IF GROUPS EXIST OR IN RELEVANT FILTER VIEWS) */}
              {duplicates.length > 0 && (
                <div className="mt-4 pt-4 border-t border-outline-variant/35">
                  <DuplicateSection
                    duplicates={duplicates}
                    processingIds={processingIds}
                    handleAllowDuplicateGroup={handleAllowDuplicateGroup}
                    handleDelete={handleDelete}
                  />
                </div>
              )}
            </div>

            {/* RIGHT COLUMN: STICKY METADATA CONTROL CONSOLE (COL-SPAN 4) */}
            <div className="lg:col-span-4 lg:sticky lg:top-6">
              <OperationsConsole
                books={booksWithDetails}
                duplicateGroupsCount={duplicates.length}
                selectedCount={selectedIds.size}
                isOnline={isOnline}
                isProcessing={fixingAll}
                progress={fixingProgress}
                onFixMetadata={handleBulkFixMetadata}
                onForceResyncAll={handleBulkForceResync}
                onFixGenreAPI={handleBulkFixGenreAPI}
                onForceGenreAPI={handleBulkForceGenreAPI}
                onFixGenreAI={handleBulkFixGenreAI}
                onForceGenreAI={handleBulkForceGenreAI}
                processingIds={processingIds}
                activeJob={activeJob}
                emptyCoverUrls={emptyCoverUrls}
                activeFilter={filter}
                onSelectAllFiltered={handleSelectAllFiltered}
                filteredCount={filteredBooks.length}
              />
            </div>
          </motion.div>

          {/* COMPACT FLOATING BOTTOM ACTION BAR FOR MOBILE (lg:hidden) */}
          <AnimatePresence>
            {(selectedIds.size > 0 ||
              fixingAll ||
              (activeJob && activeJob.status === 'running')) && (
              <>
                {/* BACKDROP DIMMER OVERLAY */}
                {showAllActions && (
                  <motion.div
                    initial={{opacity: 0}}
                    animate={{opacity: 0.5}}
                    exit={{opacity: 0}}
                    onClick={() => setShowAllActions(false)}
                    className="fixed inset-0 bg-black z-40 lg:hidden"
                  />
                )}

                {/* SLIDING BOTTOM SHEET COMMANDER DRAWER */}
                {showAllActions && (
                  <motion.div
                    initial={{y: '100%'}}
                    animate={{y: 0}}
                    exit={{y: '100%'}}
                    transition={{type: 'spring', damping: 25, stiffness: 220}}
                    className="fixed bottom-0 left-0 right-0 max-h-[85vh] bg-slate-950 border-t border-slate-800 text-slate-100 rounded-t-[2.5rem] p-6 pb-10 z-50 overflow-y-auto lg:hidden flex flex-col shadow-2xl"
                  >
                    {/* Drawer Handle Hook */}
                    <div className="w-12 h-1 bg-slate-700/80 rounded-full mx-auto mb-4 flex-shrink-0" />

                    <div className="flex items-center justify-between mb-5 border-b border-slate-800/80 pb-3.5 flex-shrink-0">
                      <div>
                        <h3 className="font-serif text-lg font-bold text-slate-100">
                          Archival Actions
                        </h3>
                        <p className="text-[10px] text-slate-400 font-sans mt-0.5 font-medium">
                          Execute curation commands for &nbsp;
                          <span className="text-secondary font-bold">
                            {selectedIds.size} STAGED
                          </span>
                          &nbsp; books
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowAllActions(false)}
                        className="p-1.5 bg-slate-800 hover:bg-slate-750 text-slate-300 rounded-full cursor-pointer transition-colors"
                        aria-label="Close action drawer"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-3 overflow-y-auto pr-1">
                      {mobileActions.map((act, index) => (
                        <button
                          key={index}
                          type="button"
                          disabled={
                            !isOnline ||
                            fixingAll ||
                            (activeJob && activeJob.status === 'running')
                          }
                          onClick={() => {
                            act.action();
                          }}
                          className="w-full text-left p-4 bg-slate-900 hover:bg-slate-850 active:bg-slate-800 border border-slate-800/80 hover:border-slate-700/60 transition-all rounded-2xl flex items-start gap-4 group disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <div className="p-2.5 bg-slate-805 group-hover:bg-slate-750 rounded-xl flex-shrink-0 text-slate-300 group-hover:text-white transition-colors">
                            {act.icon}
                          </div>
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <h4 className="font-sans text-xs font-black text-slate-200 group-hover:text-white transition-colors">
                                {act.title}
                              </h4>
                              <span className="text-[8px] bg-slate-800 text-slate-300 uppercase tracking-wider font-extrabold py-0.5 px-2 rounded-full">
                                {act.badge}
                              </span>
                            </div>
                            <p className="text-[10px] text-slate-400 leading-normal font-sans font-medium">
                              {act.description}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* FLOATING QUICK BAR */}
                <motion.div
                  initial={{opacity: 0, y: 50}}
                  animate={{opacity: 1, y: 0}}
                  exit={{opacity: 0, y: 50}}
                  className="fixed bottom-4 left-4 right-4 z-50 lg:hidden"
                >
                  <div className="bg-slate-955/95 backdrop-blur-md text-white border border-slate-800 shadow-2xl p-3.5 rounded-2xl flex items-center justify-between gap-3">
                    <div className="flex flex-col text-left pl-1">
                      <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                        {fixingAll ||
                        (activeJob && activeJob.status === 'running')
                          ? 'Running'
                          : `${selectedIds.size} STAGED`}
                      </span>
                      <span className="text-xs font-bold font-sans max-w-[110px] sm:max-w-[150px] truncate text-slate-100">
                        {fixingAll ||
                        (activeJob && activeJob.status === 'running') ? (
                          <span className="flex items-center gap-1">
                            Cure progress... {activeProgressPercentage}%
                          </span>
                        ) : filter === 'missing_metadata' ? (
                          'Smart Fill Gaps'
                        ) : filter === 'missing_genre' ? (
                          'AI Classify Genres'
                        ) : filter === 'missing_cover' ||
                          filter === 'low_res_cover' ? (
                          'Deep Overwrite Scrape'
                        ) : (
                          'Auto-Cure Catalog'
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      {/* ALL CURES OPTIONS SELECTOR BUTTON */}
                      <button
                        type="button"
                        disabled={
                          fixingAll ||
                          (activeJob && activeJob.status === 'running')
                        }
                        onClick={() => setShowAllActions(!showAllActions)}
                        className="bg-slate-800 hover:bg-slate-755 border border-slate-700/50 text-slate-200 font-bold text-xs py-2 px-3 rounded-xl transition-transform active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1 cursor-pointer"
                      >
                        <ChevronUp
                          className={`w-3.5 h-3.5 transition-transform duration-200 ${
                            showAllActions ? 'rotate-180' : ''
                          }`}
                        />
                        <span>Pick Action</span>
                      </button>

                      {/* Execute Recommended Action Button */}
                      <button
                        type="button"
                        disabled={
                          !isOnline ||
                          fixingAll ||
                          (activeJob && activeJob.status === 'running')
                        }
                        onClick={() => {
                          if (filter === 'missing_metadata') {
                            void handleBulkFixMetadata();
                          } else if (filter === 'missing_genre') {
                            void handleBulkFixGenreAI();
                          } else if (
                            filter === 'missing_cover' ||
                            filter === 'low_res_cover'
                          ) {
                            void handleBulkForceResync();
                          } else {
                            void handleBulkFixMetadata();
                          }
                        }}
                        className="bg-primary hover:bg-primary-container text-on-primary font-bold text-xs py-2 px-3.5 rounded-xl shadow-md cursor-pointer transition-transform active:scale-95 disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5"
                      >
                        {fixingAll ||
                        (activeJob && activeJob.status === 'running') ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            <span>Processing</span>
                          </>
                        ) : (
                          <>
                            {filter === 'missing_metadata' && (
                              <FileText className="w-3.5 h-3.5 text-amber-400" />
                            )}
                            {filter === 'missing_genre' && (
                              <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                            )}
                            {(filter === 'missing_cover' ||
                              filter === 'low_res_cover') && (
                              <ImageIcon className="w-3.5 h-3.5 text-teal-400" />
                            )}
                            {filter === 'all' && (
                              <BookOpen className="w-3.5 h-3.5 text-primary" />
                            )}
                            <span>Run Default</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </ErrorBoundary>
      </div>
    </>
  );
}
