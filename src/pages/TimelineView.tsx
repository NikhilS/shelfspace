import React, {useState, useMemo, useCallback, useEffect, useRef} from 'react';
import {useParams} from 'react-router-dom';
import {Clock, Waves} from 'lucide-react';
import {useCollectionScope} from '../hooks/useCollectionScope';
import {useAppPermissions} from '../hooks/useAppPermissions';
import {useBulkEnrichment} from '../hooks/useBulkEnrichment';
import {BulkEnrichmentBanner} from '../components/import/BulkEnrichmentBanner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {ReadingScopeToggle} from '../components/book/ReadingScopeToggle';
import {BookLoader} from '../components/book/BookLoader';
import {Book} from '../types';
import {
  PRESETS,
  formatYear,
  TimelinePresetControls,
  TimelineScrubber,
} from './timeline/TimelineControls';
import {computeRiverGeometry} from './timeline/TimelineEraMarker';
import {
  TimelineDesktopEpochDrawer,
  TimelineMobileEpochSheet,
  TimelineNonHistoricalAnnex,
} from './timeline/TimelineBookList';
import {
  partitionHistoricalBooks,
  buildTimelineClusters,
  computeTimelineStats,
} from './timeline/timelineMath';
import {TimelineRiverCanvas} from './timeline/TimelineRiverCanvas';

export {formatYear};

export default function TimelineView() {
  const {id: libraryId} = useParams<{id: string}>();

  const {
    isReadingMode,
    books,
    isBooksLoading,
    canEdit,
    includeWantToRead,
    setIncludeWantToRead,
    readAndReadingCount,
    wantToReadCount,
    refetchShelf,
  } = useCollectionScope(libraryId);
  const {hasAiPlan} = useAppPermissions();

  const [zoomLevel, setZoomLevel] = useState<1 | 5 | 20>(1);
  const [selectedPreset, setSelectedPreset] = useState<string>('all');
  const [selectedClusterKey, setSelectedClusterKey] = useState<number | null>(
    null,
  );
  const [hoveredClusterKey, setHoveredClusterKey] = useState<number | null>(
    null,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [isNonHistoricalCollapsed, setIsNonHistoricalCollapsed] =
    useState(true);
  const [stageWidth, setStageWidth] = useState<number>(920);

  const stageContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = stageContainerRef.current;
    if (!el) return;

    const updateWidth = () => {
      if (el.clientWidth && el.clientWidth > 200) {
        setStageWidth(el.clientWidth);
      }
    };
    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(el);
      return () => observer.disconnect();
    }
    return undefined;
  }, [books.length]);

  const filterTemporalPredicate = useCallback(
    (b: Book) => !b.temporalMetadata,
    [],
  );

  const targetEnrichmentLibId = useMemo(() => {
    if (libraryId) return libraryId;
    const missing = books.find(
      b =>
        b.libraryId &&
        b.enrichmentStatus?.temporal !== 'unsupported' &&
        filterTemporalPredicate(b),
    );
    return missing?.libraryId;
  }, [libraryId, books, filterTemporalPredicate]);

  const enrichmentScopedBooks = useMemo(() => {
    if (libraryId) return books;
    if (!targetEnrichmentLibId) return [];
    return books.filter(b => b.libraryId === targetEnrichmentLibId);
  }, [libraryId, books, targetEnrichmentLibId]);

  const {
    isBackfilling,
    progress: backfillProgress,
    inFlightCount,
  } = useBulkEnrichment({
    books: enrichmentScopedBooks,
    isBooksLoading,
    libraryId: targetEnrichmentLibId,
    providerKey: 'temporalMetadata',
    metadataField: 'temporalMetadata',
    filterPredicate: filterTemporalPredicate,
    canEdit: Boolean(canEdit && hasAiPlan),
    successToastMessage: 'Historical temporal analysis complete!',
    errorToastMessage: 'Analysis backfill failed',
    onComplete: isReadingMode ? () => void refetchShelf() : undefined,
  });

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

  const handlePresetSelect = (presetId: string) => {
    setSelectedPreset(presetId);
    setSelectedClusterKey(null);
    const preset = PRESETS.find(p => p.id === presetId);
    if (preset) {
      setZoomLevel(preset.zoom);
    }
  };

  const {historicalBooks, nonHistoricalBooks} = useMemo(
    () => partitionHistoricalBooks(books),
    [books],
  );

  const clusters = useMemo(
    () => buildTimelineClusters(historicalBooks, zoomLevel, selectedPreset),
    [historicalBooks, zoomLevel, selectedPreset],
  );

  const timelineStats = useMemo(
    () => computeTimelineStats(clusters),
    [clusters],
  );

  const riverGeometry = useMemo(
    () => computeRiverGeometry(clusters, stageWidth),
    [clusters, stageWidth],
  );

  const selectedCluster = useMemo(() => {
    if (selectedClusterKey === null) return null;
    return clusters.find(c => c.key === selectedClusterKey) || null;
  }, [clusters, selectedClusterKey]);

  const handleJumpToCluster = (clusterKey: number) => {
    setSelectedClusterKey(clusterKey);
    const el = document.getElementById(`river-dock-${clusterKey}`);
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  };

  const filteredNonHistorical = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return nonHistoricalBooks;
    return nonHistoricalBooks.filter(
      b =>
        b.title.toLowerCase().includes(query) ||
        (b.author || '').toLowerCase().includes(query),
    );
  }, [nonHistoricalBooks, searchQuery]);

  const maxClusterCount = useMemo(() => {
    if (clusters.length === 0) return 1;
    return Math.max(1, ...clusters.map(c => c.books.length));
  }, [clusters]);

  return (
    <div className="layout-page-content" id="timeline-layout">
      {/* 1. Cartographic Header & Controls Bar */}
      <div className="layout-header border-none flex flex-col lg:flex-row lg:justify-between lg:items-end gap-6 pb-2">
        <div>
          <BackToLibrary
            libraryId={libraryId}
            label={
              isReadingMode
                ? 'Back to Reading Room'
                : 'Back to Library Overview'
            }
            className="mb-2"
          />
          <h1 className="layout-header-title text-balance">
            Historical Temporal Timeline
          </h1>
          <p className="layout-header-subtitle max-w-2xl">
            {isReadingMode
              ? 'A hydrographic survey of your reading life across time. Narrow riffles widen into alluvial pools and river islands at each historical bend, while tributary arcs trace narratives across centuries.'
              : 'A hydrographic survey of your library across time. Narrow riffles widen into alluvial pools and river islands at each historical bend, while tributary arcs trace narratives across centuries.'}
          </p>

          {/* Unboxed Archival Metrics Strip (Zero-Pill Discipline) */}
          {!isBooksLoading && timelineStats.totalHistorical > 0 && (
            <div className="mt-4 pt-3 border-t border-outline-variant/40 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-on-surface-variant font-sans">
              <span>
                <strong className="font-mono tabular-nums text-on-surface font-semibold">
                  {timelineStats.totalHistorical}
                </strong>{' '}
                Historical Volumes
              </span>
              <span aria-hidden="true" className="text-outline-variant">
                ·
              </span>
              <span>
                Headwaters:{' '}
                <strong className="font-mono tabular-nums text-on-surface font-semibold">
                  {timelineStats.earliestYear !== null
                    ? formatYear(timelineStats.earliestYear)
                    : '—'}
                </strong>
              </span>
              <span aria-hidden="true" className="text-outline-variant">
                ·
              </span>
              <span>
                Delta:{' '}
                <strong className="font-mono tabular-nums text-on-surface font-semibold">
                  {timelineStats.latestYear !== null
                    ? formatYear(timelineStats.latestYear)
                    : '—'}
                </strong>
              </span>
              <span aria-hidden="true" className="text-outline-variant">
                ·
              </span>
              <span>
                <strong className="font-mono tabular-nums text-on-surface font-semibold">
                  {clusters.length}
                </strong>{' '}
                {clusters.length === 1 ? 'Epoch Bend' : 'Epoch Bends'}
              </span>
              {timelineStats.totalSpanning > 0 && (
                <>
                  <span aria-hidden="true" className="text-outline-variant">
                    ·
                  </span>
                  <span>
                    <strong className="font-mono tabular-nums text-primary font-semibold">
                      {timelineStats.totalSpanning}
                    </strong>{' '}
                    Multi-Era Span{' '}
                    {timelineStats.totalSpanning === 1 ? 'Arc' : 'Arcs'}
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        <div className="flex flex-col items-start lg:items-end gap-2.5">
          {isReadingMode && (
            <ReadingScopeToggle
              readAndReadingCount={readAndReadingCount}
              wantToReadCount={wantToReadCount}
              includeWantToRead={includeWantToRead}
              onToggleWantToRead={setIncludeWantToRead}
            />
          )}
          <TimelinePresetControls
            selectedPreset={selectedPreset}
            zoomLevel={zoomLevel}
            onPresetSelect={handlePresetSelect}
            onZoomChange={z => {
              setZoomLevel(z);
              setSelectedClusterKey(null);
            }}
          />
        </div>
      </div>

      {/* Backfilling and Sync progress loader indicator */}
      <BulkEnrichmentBanner
        isBackfilling={isBackfilling}
        completed={backfillProgress.completed}
        failed={backfillProgress.failed}
        total={backfillProgress.total}
        title="Scanning Literary Chronologies"
        description="Mapping historical eras..."
        colorTheme="indigo"
        className="ml-1 mb-5"
        inFlightCount={inFlightCount}
      />

      {/* 2. Interactive Century Scrubber & Hydrographic Minimap Bar */}
      {!isBooksLoading && (
        <TimelineScrubber
          clusters={clusters}
          selectedClusterKey={selectedClusterKey}
          hoveredClusterKey={hoveredClusterKey}
          maxClusterCount={maxClusterCount}
          onJumpToCluster={handleJumpToCluster}
          onHoverCluster={setHoveredClusterKey}
        />
      )}

      {/* 3. Primary Interactive Meandering River Stage & Epoch Curatorial Drawer */}
      <div className="relative grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        <div
          className={`transition-all duration-300 ${
            selectedCluster ? 'lg:col-span-8' : 'lg:col-span-12'
          }`}
        >
          <div className="bg-surface-container-lowest rounded-3xl p-3 sm:p-8 border border-outline-variant/40 min-h-[540px] relative overflow-hidden">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  'linear-gradient(to right, color-mix(in srgb, var(--color-outline-variant) 26%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--color-outline-variant) 26%, transparent) 1px, transparent 1px)',
                backgroundSize: '72px 72px',
              }}
            />

            {isBooksLoading ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-background/60 rounded-3xl z-20">
                <BookLoader size="lg" className="mb-4" />
                <p className="text-on-surface-variant text-sm font-medium">
                  Charting chronological river bends...
                </p>
              </div>
            ) : (
              <div className="relative z-10">
                {clusters.length > 0 ? (
                  <div className="relative w-full">
                    <div className="flex items-center justify-between text-xs font-mono tabular-nums text-on-surface-variant pb-4 mb-2 border-b border-outline-variant/30">
                      <span className="inline-flex items-center gap-1.5">
                        <Waves className="w-3.5 h-3.5 text-[#2d6d82] dark:text-[#6ab0c7]" />
                        <span>
                          HEADWATERS · {formatYear(clusters[0].minYear)}
                        </span>
                      </span>
                      <span className="hidden sm:inline">
                        ALLUVIAL SHOALS &amp; THALWEG BATHYMETRY
                      </span>
                      <span>
                        SCALE ·{' '}
                        {zoomLevel === 1
                          ? '500 YR / BEND'
                          : zoomLevel === 5
                            ? '100 YR / BEND'
                            : '10 YR / BEND'}
                      </span>
                    </div>

                    <TimelineRiverCanvas
                      clusters={clusters}
                      riverGeometry={riverGeometry}
                      selectedClusterKey={selectedClusterKey}
                      hoveredClusterKey={hoveredClusterKey}
                      onSelectCluster={setSelectedClusterKey}
                      onHoverCluster={setHoveredClusterKey}
                      stageContainerRef={stageContainerRef}
                    />

                    <div className="flex items-center justify-between text-xs font-mono tabular-nums text-on-surface-variant pt-4 mt-2 border-t border-outline-variant/30">
                      <span className="inline-flex items-center gap-1.5">
                        <Waves className="w-3.5 h-3.5 text-[#2d6d82] dark:text-[#6ab0c7]" />
                        <span>
                          CONTEMPORARY DELTA ·{' '}
                          {formatYear(
                            clusters[clusters.length - 1]?.maxYear ?? 2025,
                          )}
                        </span>
                      </span>
                      <span>
                        {timelineStats.totalHistorical} VOLUMES CHARTED
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-24 text-center">
                    <Clock className="w-12 h-12 text-outline mb-3 stroke-1" />
                    <h4 className="text-base font-serif font-semibold text-on-surface">
                      No historical timelines mapped
                    </h4>
                    <p className="text-xs text-on-surface-variant max-w-sm mt-1">
                      {selectedPreset === 'bce'
                        ? 'No books in this library are set in the Ancient or BCE era.'
                        : 'Wait for the chronological background scanner to finish analyzing your library or add historical books.'}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <TimelineDesktopEpochDrawer
          libraryId={libraryId}
          selectedCluster={selectedCluster}
          onClose={() => setSelectedClusterKey(null)}
        />
      </div>

      <TimelineMobileEpochSheet
        libraryId={libraryId}
        selectedCluster={selectedCluster}
        onClose={() => setSelectedClusterKey(null)}
      />

      {!isBooksLoading && (
        <TimelineNonHistoricalAnnex
          libraryId={libraryId}
          nonHistoricalBooks={nonHistoricalBooks}
          filteredNonHistorical={filteredNonHistorical}
          isCollapsed={isNonHistoricalCollapsed}
          onToggleCollapse={() =>
            setIsNonHistoricalCollapsed(!isNonHistoricalCollapsed)
          }
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
        />
      )}
    </div>
  );
}
