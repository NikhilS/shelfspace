import React, {useMemo} from 'react';
import {
  Wand2,
  RefreshCw,
  Sparkles,
  Loader2,
  Activity,
  Sparkle,
  Info,
  CheckCircle2,
  FileSpreadsheet,
  Layers,
} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Book} from '../../types';
import {motion, AnimatePresence} from 'motion/react';

interface OperationsConsoleProps {
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
  processingIds: Record<string, boolean>;
  activeJob: {
    status: 'running' | 'completed' | 'failed' | 'none';
    progress: number;
    total: number;
  } | null;
  emptyCoverUrls: Set<string>;
  activeFilter:
    | 'all'
    | 'missing_metadata'
    | 'missing_genre'
    | 'low_res_cover'
    | 'missing_cover';
  onSelectAllFiltered: () => void;
  filteredCount: number;
}

export function OperationsConsole({
  books,
  selectedCount,
  isOnline,
  isProcessing,
  progress,
  onFixMetadata,
  onForceResyncAll,
  onFixGenreAPI,
  onForceGenreAPI,
  onFixGenreAI,
  onForceGenreAI,
  processingIds,
  activeJob,
  emptyCoverUrls,
  activeFilter,
  onSelectAllFiltered,
  filteredCount,
}: OperationsConsoleProps) {
  // Real-time metadata health calculations
  const {healthScore} = useMemo(() => {
    if (books.length === 0) {
      return {
        healthScore: 100,
      };
    }

    let totalPoints = 0;
    const maxPointsPerBook = 10;

    books.forEach(b => {
      let bookPoints = 0;

      // Cover: Max 3 pts
      const hasNoCover = !b.coverUrl || emptyCoverUrls.has(b.coverUrl);
      const isLowRes = b.coverUrl && b.coverUrl.includes('zoom=1');
      if (hasNoCover) {
        // missing cover
      } else if (isLowRes) {
        bookPoints += 1.5;
      } else {
        bookPoints += 3;
      }

      // Synopsis: Max 3 pts
      if (b.synopsis) {
        bookPoints += 3;
      }

      // Catalog Classification / BISAC Genres: Max 2 pts
      if (b.genres && b.genres.length > 0) {
        bookPoints += 2;
      }

      // Release/Publication Date: Max 2 pts
      if (b.publishedDate) {
        bookPoints += 2;
      }

      totalPoints += bookPoints;
    });

    const maxTotalPoints = books.length * maxPointsPerBook;
    const score = Math.round((totalPoints / maxTotalPoints) * 100);

    return {
      healthScore: score,
    };
  }, [books, emptyCoverUrls]);

  // Find currently actively updating items on client side
  const activeProcessingBooks = useMemo(() => {
    return books.filter(b => processingIds[b.id]);
  }, [books, processingIds]);

  const isServerJobRunning = activeJob?.status === 'running';
  const showProgressTerminal = isProcessing || isServerJobRunning;
  const currentWorkingCount = isProcessing
    ? progress
    : activeJob?.progress || 0;
  const totalWorkingCount = isProcessing
    ? selectedCount
    : activeJob?.total || 0;

  const roundedPercentage =
    totalWorkingCount > 0
      ? Math.min(
          100,
          Math.round((currentWorkingCount / totalWorkingCount) * 100),
        )
      : 0;

  // Set up filter-specific targeted cure actions
  const recommendation = useMemo(() => {
    switch (activeFilter) {
      case 'missing_metadata':
        return {
          title: 'Fill Gaps with Smart Lookup',
          description:
            'Safe lookups that populate missing descriptions and details while preserving original fields.',
          badge: 'Metadata Fill',
          icon: <Wand2 className="w-5 h-5 text-primary" />,
          action: onFixMetadata,
          isPrimary: true,
        };
      case 'missing_genre':
        return {
          title: 'AI Classify Missing Genres',
          description:
            'Uses Gemini models to align volume titles & metadata against BISAC taxonomies.',
          badge: 'Gemini AI',
          icon: <Sparkles className="w-5 h-5 text-indigo-500 animate-pulse" />,
          action: onFixGenreAI,
          isPrimary: true,
        };
      case 'missing_cover':
      case 'low_res_cover':
        return {
          title: 'Deep Overwrite Metadata',
          description:
            'Triggers fresh index scrape. Replaces placeholders with verified publisher covers.',
          badge: 'Deep Re-Scrape',
          icon: <RefreshCw className="w-5 h-5 text-amber-500" />,
          action: onForceResyncAll,
          isPrimary: true,
        };
      default:
        return {
          title: 'Auto-detect & Cure All Gaps',
          description:
            'Loops through active volumes. Intelligently fills description blanks and catalogs topics.',
          badge: 'Batch Cataloging',
          icon: <Activity className="w-5 h-5 text-primary" />,
          action: onFixMetadata,
          isPrimary: true,
        };
    }
  }, [activeFilter, onFixMetadata, onFixGenreAI, onForceResyncAll]);

  return (
    <div className="bg-surface border border-outline-variant/30 rounded-2xl p-5 sm:p-6 shadow-[0_12px_40px_rgba(0,0,0,0.035)] h-fit sticky top-6">
      {/* MINI HEALTH HUD */}
      <div className="flex items-center gap-4 bg-primary/[0.02] border border-primary/5 rounded-xl p-3.5 mb-5 select-none justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex items-center justify-center w-11 h-11 flex-shrink-0">
            <svg className="w-full h-full transform -rotate-90">
              <circle
                cx="22"
                cy="22"
                r="18"
                className="stroke-outline-variant/30"
                strokeWidth="3.5"
                fill="transparent"
              />
              <motion.circle
                cx="22"
                cy="22"
                r="18"
                className={`${healthScore >= 90 ? 'stroke-success' : healthScore >= 70 ? 'stroke-amber-500' : 'stroke-error'}`}
                strokeWidth="3.5"
                fill="transparent"
                strokeDasharray={113}
                initial={{strokeDashoffset: 113}}
                animate={{strokeDashoffset: 113 - (113 * healthScore) / 100}}
                transition={{duration: 1.2, ease: 'easeOut'}}
              />
            </svg>
            <div className="absolute font-serif text-xs font-black text-primary">
              {healthScore}%
            </div>
          </div>
          <div>
            <h4 className="font-serif text-sm font-bold text-on-surface leading-tight">
              Library Health
            </h4>
            <p className="text-[10px] text-on-surface-variant font-medium">
              Integrity Score based on empty records
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-container border border-outline-variant/50 rounded-lg text-xs font-medium text-on-surface font-sans">
          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
          {books.length} Books
        </div>
      </div>

      {/* OPERATIONS TITLE */}
      <div className="flex items-center gap-2 mb-4 pb-2 border-b border-outline-variant/20">
        <Activity className="w-4 h-4 text-primary" />
        <h3 className="font-sans text-xs font-bold text-on-surface uppercase tracking-wider">
          Orchestration Engine
        </h3>
        {!isOnline && (
          <span className="ml-auto inline-flex items-center gap-1 bg-red-500/10 text-red-500 text-[9px] uppercase font-bold py-0.5 px-2 rounded-full">
            Offline
          </span>
        )}
      </div>

      <AnimatePresence mode="wait">
        {/* VIEW 1: ACTIVE PIPELINE TERMINAL */}
        {showProgressTerminal ? (
          <motion.div
            key="pipeline"
            initial={{opacity: 0, y: 8}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: -8}}
            className="space-y-4"
          >
            <div className="bg-slate-950 text-slate-100 p-4 rounded-xl font-mono text-xs border border-slate-900 shadow-inner relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-primary/10 rounded-full blur-3xl pointer-events-none" />

              <div className="flex items-center justify-between mb-3 text-[10px]">
                <span className="text-secondary font-bold uppercase tracking-wider flex items-center gap-1.5 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-secondary" />
                  Processing...
                </span>
                <span className="text-slate-400 font-bold">
                  {roundedPercentage}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-900 rounded-full h-1 mb-4 border border-slate-800 overflow-hidden">
                <motion.div
                  className="bg-primary h-full rounded-full"
                  style={{width: `${roundedPercentage}%`}}
                  transition={{duration: 0.3}}
                />
              </div>

              <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1 text-[11px] leading-relaxed text-slate-300">
                <p className="text-slate-500">
                  &gt; Starting bulk operation queue
                </p>
                <p className="text-slate-500">
                  &gt; Batch targets initialized: {totalWorkingCount} books
                </p>

                {activeProcessingBooks.length > 0 ? (
                  activeProcessingBooks.map(b => (
                    <motion.p
                      key={b.id}
                      initial={{opacity: 0, x: -5}}
                      animate={{opacity: 1, x: 0}}
                      className="text-primary font-medium"
                    >
                      &gt; Repairing: "{b.title}"...
                    </motion.p>
                  ))
                ) : (
                  <p className="text-slate-400 italic">
                    &gt; Aligning API indices, writing shards...
                  </p>
                )}

                {currentWorkingCount > 0 && (
                  <p className="text-success font-semibold">
                    &gt; Completed targets: {currentWorkingCount} of{' '}
                    {totalWorkingCount}
                  </p>
                )}
              </div>
            </div>

            <div className="text-[11px] text-on-surface-variant leading-relaxed text-center px-2 py-1 bg-surface-container rounded-xl border border-outline-variant/30 flex items-center gap-2.5 justify-center font-medium">
              <Loader2 className="w-3.5 h-3.5 text-primary animate-spin-fast flex-shrink-0" />
              <span>
                Background processor is editing Firestore records safely.
              </span>
            </div>
          </motion.div>
        ) : selectedCount === 0 ? (
          /* VIEW 2: EMPTY STATE - PROMPT USER TO SELECT FROM THE ACTIVE FILTER */
          <motion.div
            key="empty-state"
            initial={{opacity: 0, y: 8}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: -8}}
            className="space-y-4"
          >
            <div className="border border-dashed border-outline-variant rounded-xl p-5 text-center bg-surface-container/20">
              <div className="w-9 h-9 rounded-full bg-surface-container border border-outline-variant flex items-center justify-center mx-auto mb-3">
                <Info className="w-4 h-4 text-on-surface-variant" />
              </div>
              <p className="font-sans text-xs font-bold text-on-surface">
                No books queued for action
              </p>
              <p className="text-[11px] text-on-surface-variant mt-1 leading-relaxed max-w-[200px] mx-auto">
                Select books from the integrity queue on the left to activate
                cures.
              </p>
            </div>

            {filteredCount > 0 ? (
              <Button
                onClick={onSelectAllFiltered}
                variant="outline"
                className="w-full h-11 border-primary/20 hover:border-primary/50 text-xs font-bold font-sans transition-colors bg-primary/[0.02]"
                id="btn-queue-all"
              >
                Queue All {filteredCount} Books in Lens
              </Button>
            ) : (
              <div className="bg-success/5 border border-success/10 rounded-xl p-3 text-center">
                <p className="text-xs font-bold text-success flex items-center justify-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> No adjustments needed in
                  this lens!
                </p>
              </div>
            )}
          </motion.div>
        ) : (
          /* VIEW 3: ACTIVE ACTIONS FOR TARGET QUEUE */
          <motion.div
            key="actions-workspace"
            initial={{opacity: 0, y: 8}}
            animate={{opacity: 1, y: 0}}
            exit={{opacity: 0, y: -8}}
            className="space-y-5"
          >
            {/* Context Badge */}
            <div className="bg-primary/5 rounded-xl p-3.5 border border-primary/10 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center font-serif text-sm font-black">
                  {selectedCount}
                </div>
                <div>
                  <h4 className="font-bold text-xs text-primary leading-tight">
                    Target Queue Active
                  </h4>
                  <p className="text-[10px] text-on-surface-variant/80 font-medium">
                    Lens: {activeFilter.replace('_', ' ')}
                  </p>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="text-[10px] text-primary hover:text-primary-container h-7 px-2"
                onClick={onSelectAllFiltered}
              >
                Reset Queue
              </Button>
            </div>

            {/* RECOMMENDED TARGET ACTION CARD */}
            <div className="space-y-2">
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest block font-sans">
                Recommended Action
              </span>

              <div className="border border-primary/35 shadow-sm rounded-xl p-4 bg-primary/[0.02] space-y-3 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-16 h-16 bg-primary/5 rounded-full blur-xl pointer-events-none" />
                <div className="flex items-start gap-3">
                  <div className="p-2 bg-primary/10 rounded-lg flex-shrink-0">
                    {recommendation.icon}
                  </div>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h4 className="font-sans text-xs font-bold text-on-surface">
                        {recommendation.title}
                      </h4>
                      <span className="text-[8px] bg-primary/10 text-primary uppercase tracking-wider font-bold py-0.5 px-2 rounded-full">
                        {recommendation.badge}
                      </span>
                    </div>
                    <p className="text-[10px] text-on-surface-variant leading-relaxed mt-1">
                      {recommendation.description}
                    </p>
                  </div>
                </div>

                <Button
                  onClick={recommendation.action}
                  disabled={!isOnline}
                  className="w-full justify-center h-10 bg-primary hover:bg-primary-container text-on-primary font-bold text-xs shadow-sm flex items-center gap-2 rounded-lg"
                  id="btn-execute-recommended"
                >
                  Confirm Run for {selectedCount} Volumes
                </Button>
              </div>
            </div>

            {/* OTHER OPERATIONS / EXTENSIBLE DIRECTORY */}
            <div className="space-y-2.5 pt-2">
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-widest block font-sans">
                Other Archival Tools
              </span>

              <div className="grid grid-cols-1 gap-2.5">
                {/* 1. Core metadata tools */}
                {activeFilter !== 'missing_metadata' && (
                  <Button
                    onClick={onFixMetadata}
                    disabled={!isOnline}
                    variant="outline"
                    className="w-full justify-start h-11 px-3.5 border-outline-variant hover:border-primary/40 hover:bg-primary/5 text-xs font-sans transition-all flex items-center text-on-surface"
                    id="sub-btn-fix-metadata"
                  >
                    <Wand2 className="w-3.5 h-3.5 text-on-surface-variant mr-3" />
                    <div className="text-left leading-none">
                      <p className="text-xs font-bold">
                        Smart Fill Missing Metadata
                      </p>
                      <p className="text-[9px] text-on-surface-variant mt-0.5">
                        Find synopsis/date gaps cleanly
                      </p>
                    </div>
                  </Button>
                )}

                {/* 2. Overwrite tools */}
                <Button
                  onClick={onForceResyncAll}
                  disabled={!isOnline}
                  variant="outline"
                  className="w-full justify-start h-11 px-3.5 border-outline-variant hover:border-amber-500/40 hover:bg-amber-500/5 text-xs font-sans transition-all flex items-center text-on-surface"
                  id="sub-btn-force-metadata"
                >
                  <RefreshCw className="w-3.5 h-3.5 text-amber-500 mr-3" />
                  <div className="text-left leading-none">
                    <p className="text-xs font-bold">Deep Overwrite Metadata</p>
                    <p className="text-[9px] text-on-surface-variant mt-0.5">
                      Forces complete overwrite check from Google Books
                    </p>
                  </div>
                </Button>

                {/* 3. AI taxonomies */}
                {activeFilter !== 'missing_genre' && (
                  <Button
                    onClick={onFixGenreAI}
                    disabled={!isOnline}
                    variant="outline"
                    className="w-full justify-start h-11 px-3.5 border-outline-variant hover:border-indigo-500/40 hover:bg-indigo-500/5 text-xs font-sans transition-all flex items-center text-on-surface"
                    id="sub-btn-genre-ai"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500 mr-3" />
                    <div className="text-left leading-none">
                      <p className="text-xs font-bold font-sans">
                        AI Classify Genres (Gemini)
                      </p>
                      <p className="text-[9px] text-on-surface-variant mt-0.5">
                        Categorises using Generative taxonomic alignment
                      </p>
                    </div>
                  </Button>
                )}

                <Button
                  onClick={onForceGenreAI}
                  disabled={!isOnline}
                  variant="outline"
                  className="w-full justify-start h-11 px-3.5 border-outline-variant hover:border-indigo-700/40 hover:bg-indigo-700/5 text-xs font-sans transition-all flex items-center text-on-surface"
                  id="sub-btn-force-genre-ai"
                >
                  <Sparkle className="w-3.5 h-3.5 text-indigo-700 mr-3 animate-spin-slow" />
                  <div className="text-left leading-none">
                    <p className="text-xs font-bold font-sans">
                      Force AI Taxonomy Alignment
                    </p>
                    <p className="text-[9px] text-on-surface-variant mt-0.5">
                      Fully classifies all active target genres and clusters
                    </p>
                  </div>
                </Button>

                {/* 4. API subjects */}
                <Button
                  onClick={onFixGenreAPI}
                  disabled={!isOnline}
                  variant="outline"
                  className="w-full justify-start h-11 px-3.5 border-outline-variant hover:bg-emerald-500/5 hover:border-emerald-500/30 text-xs font-sans transition-all flex items-center text-on-surface"
                  id="sub-btn-genre-api"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600 mr-3" />
                  <div className="text-left leading-none">
                    <p className="text-xs font-bold">
                      API Catalog Genre Classification
                    </p>
                    <p className="text-[9px] text-on-surface-variant mt-0.5">
                      Pulls pure publisher registration registers
                    </p>
                  </div>
                </Button>

                <Button
                  onClick={onForceGenreAPI}
                  disabled={!isOnline}
                  variant="outline"
                  className="w-full justify-start h-11 px-3.5 border-outline-variant hover:bg-emerald-500/5 hover:border-emerald-500/30 text-xs font-sans transition-all flex items-center text-on-surface"
                  id="sub-btn-force-genre-api"
                >
                  <Layers className="w-3.5 h-3.5 text-emerald-800 mr-3" />
                  <div className="text-left leading-none">
                    <p className="text-xs font-bold">
                      Force Sync API Catalog Subjects
                    </p>
                    <p className="text-[9px] text-on-surface-variant mt-0.5">
                      Overwrites current categories with API publishers raw data
                    </p>
                  </div>
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
