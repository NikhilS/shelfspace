import React, {useState, useMemo, useCallback, useEffect, useRef} from 'react';
import {useParams, useNavigate} from 'react-router-dom';
import {Clock, Waves} from 'lucide-react';
import {useAuth} from '../stores/authStore';
import {useLibraryData} from '../hooks/useLibraryData';
import {useBulkEnrichment} from '../hooks/useBulkEnrichment';
import {BulkEnrichmentBanner} from '../components/import/BulkEnrichmentBanner';
import {DebugTelemetryEngine} from '../lib/telemetry';
import {BackToLibrary} from '../components/layout/BackToLibrary';
import {BookLoader} from '../components/book/BookLoader';
import {Book} from '../types';
import {
  PRESETS,
  formatYear,
  TimelineCluster,
  TimelinePresetControls,
  TimelineScrubber,
} from './timeline/TimelineControls';
import {
  computeRiverGeometry,
  TimelineEraMarker,
} from './timeline/TimelineEraMarker';
import {
  TimelineDesktopEpochDrawer,
  TimelineMobileEpochSheet,
  TimelineNonHistoricalAnnex,
} from './timeline/TimelineBookList';

export {formatYear};

export default function TimelineView() {
  const {id: libraryId} = useParams<{id: string}>();
  const navigate = useNavigate();
  const {user} = useAuth();

  const {books, isBooksLoading} = useLibraryData(
    libraryId,
    user?.uid,
    navigate,
  );

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

  const {
    isBackfilling,
    progress: backfillProgress,
    inFlightCount,
  } = useBulkEnrichment({
    books,
    isBooksLoading,
    libraryId,
    providerKey: 'temporalMetadata',
    metadataField: 'temporalMetadata',
    filterPredicate: filterTemporalPredicate,
    successToastMessage: 'Historical temporal analysis complete!',
    errorToastMessage: 'Analysis backfill failed',
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

  const historicalBooks = useMemo(() => {
    return books.filter(
      b => b.temporalMetadata && !b.temporalMetadata.isNonHistorical,
    );
  }, [books]);

  const nonHistoricalBooks = useMemo(() => {
    return books.filter(b => b.temporalMetadata?.isNonHistorical === true);
  }, [books]);

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
        if (selectedPreset === 'bce' && year > 0) return;

        const k = getClusterKey(year, zoomLevel);
        if (!map[k]) map[k] = [];
        map[k].push(b);
      }
    });

    const list: TimelineCluster[] = Object.keys(map)
      .map(Number)
      .map(key => {
        const cBooks = [...map[key]].sort(
          (a, b) =>
            (a.temporalMetadata?.startYear ?? 0) -
            (b.temporalMetadata?.startYear ?? 0),
        );

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
            eraLabel = `${formatYear(key)} – ${formatYear(key + interval - 1)}`;
          }
        }

        const startYears = cBooks.map(
          b => b.temporalMetadata?.startYear ?? key,
        );
        const endYears = cBooks.map(
          b =>
            b.temporalMetadata?.endYear ?? b.temporalMetadata?.startYear ?? key,
        );
        const minYear = Math.min(...startYears);
        const maxYear = Math.max(...endYears);

        const channelWidth = Math.min(
          96,
          Math.max(36, Math.round(32 + Math.log2(cBooks.length + 1) * 18)),
        );

        const spanningBooks = cBooks.filter(b => {
          const s = b.temporalMetadata?.startYear;
          const e = b.temporalMetadata?.endYear;
          return s !== undefined && e !== undefined && e - s >= 15;
        });

        return {
          key,
          label: eraLabel,
          books: cBooks,
          minYear,
          maxYear,
          channelWidth,
          spanningBooks,
        };
      });

    return list.sort((a, b) => a.key - b.key);
  }, [historicalBooks, zoomLevel, selectedPreset]);

  const timelineStats = useMemo(() => {
    if (clusters.length === 0) {
      return {
        totalHistorical: 0,
        earliestYear: null as number | null,
        latestYear: null as number | null,
        totalSpanning: 0,
      };
    }
    const earliestYear = Math.min(...clusters.map(c => c.minYear));
    const latestYear = Math.max(...clusters.map(c => c.maxYear));
    const totalHistorical = clusters.reduce(
      (acc, c) => acc + c.books.length,
      0,
    );
    const totalSpanning = clusters.reduce(
      (acc, c) => acc + c.spanningBooks.length,
      0,
    );
    return {
      totalHistorical,
      earliestYear,
      latestYear,
      totalSpanning,
    };
  }, [clusters]);

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
            label="Back to Library Overview"
            className="mb-2"
          />
          <h1 className="layout-header-title text-balance">
            Historical Temporal Timeline
          </h1>
          <p className="layout-header-subtitle max-w-2xl">
            A hydrographic survey of your library across time. Narrow riffles
            widen into alluvial pools and river islands at each historical bend,
            while tributary arcs trace narratives across centuries.
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

                    <div
                      ref={stageContainerRef}
                      className="relative w-full"
                      style={{height: `${riverGeometry.totalHeight}px`}}
                    >
                      <svg
                        viewBox={`0 0 ${riverGeometry.W} ${riverGeometry.totalHeight}`}
                        className="block absolute inset-0 w-full h-full pointer-events-none select-none"
                        aria-hidden="true"
                      >
                        <defs>
                          <linearGradient
                            id="alluvialValleyGrad"
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="100%"
                          >
                            <stop
                              offset="0%"
                              stopColor="#8ab0a6"
                              stopOpacity="0.09"
                            />
                            <stop
                              offset="50%"
                              stopColor="#a8c3b8"
                              stopOpacity="0.13"
                            />
                            <stop
                              offset="100%"
                              stopColor="#7da39b"
                              stopOpacity="0.11"
                            />
                          </linearGradient>

                          <linearGradient
                            id="shallowShoalGrad"
                            x1="0%"
                            y1="0%"
                            x2="0%"
                            y2="100%"
                          >
                            <stop
                              offset="0%"
                              stopColor="#7fb8c9"
                              stopOpacity="0.28"
                            />
                            <stop
                              offset="50%"
                              stopColor="#64a6ba"
                              stopOpacity="0.34"
                            />
                            <stop
                              offset="100%"
                              stopColor="#5295ab"
                              stopOpacity="0.38"
                            />
                          </linearGradient>

                          <linearGradient
                            id="midChannelGrad"
                            x1="0%"
                            y1="0%"
                            x2="0%"
                            y2="100%"
                          >
                            <stop
                              offset="0%"
                              stopColor="#488ea5"
                              stopOpacity="0.32"
                            />
                            <stop
                              offset="50%"
                              stopColor="#367c94"
                              stopOpacity="0.38"
                            />
                            <stop
                              offset="100%"
                              stopColor="#296b82"
                              stopOpacity="0.44"
                            />
                          </linearGradient>

                          <linearGradient
                            id="deepThalwegGrad"
                            x1="0%"
                            y1="0%"
                            x2="0%"
                            y2="100%"
                          >
                            <stop
                              offset="0%"
                              stopColor="#1f5d73"
                              stopOpacity="0.26"
                            />
                            <stop
                              offset="100%"
                              stopColor="#16495c"
                              stopOpacity="0.35"
                            />
                          </linearGradient>
                        </defs>

                        <path
                          d={riverGeometry.alluvialValleyPath}
                          fill="url(#alluvialValleyGrad)"
                          stroke="#7aa198"
                          strokeOpacity="0.22"
                          strokeWidth="1"
                        />

                        <path
                          d={riverGeometry.riparianMarshPath}
                          fill="#9cc2b8"
                          fillOpacity="0.11"
                          stroke="#68968d"
                          strokeOpacity="0.24"
                          strokeWidth="0.9"
                        />

                        {riverGeometry.tributaries.map(creek => {
                          const isHighlighted =
                            selectedClusterKey === creek.clusterKey ||
                            hoveredClusterKey === creek.clusterKey;
                          return (
                            <g key={creek.id}>
                              <path
                                d={creek.ribbonPath}
                                fill="url(#shallowShoalGrad)"
                                stroke="#3b7e94"
                                strokeOpacity={isHighlighted ? '0.55' : '0.32'}
                                strokeWidth="1"
                              />
                              <path
                                d={creek.waterLinePath}
                                fill="none"
                                stroke="#296b82"
                                strokeOpacity={isHighlighted ? '0.45' : '0.22'}
                                strokeWidth="0.8"
                              />
                            </g>
                          );
                        })}

                        <path
                          d={riverGeometry.shallowShoalPath}
                          fill="url(#shallowShoalGrad)"
                          stroke="#387b91"
                          strokeOpacity="0.52"
                          strokeWidth="1.25"
                        />

                        <path
                          d={riverGeometry.waterLinePortPath}
                          fill="none"
                          stroke="#2d6d82"
                          strokeOpacity="0.24"
                          strokeWidth="0.75"
                        />
                        <path
                          d={riverGeometry.waterLineStarboardPath}
                          fill="none"
                          stroke="#2d6d82"
                          strokeOpacity="0.24"
                          strokeWidth="0.75"
                        />

                        <path
                          d={riverGeometry.midChannelPath}
                          fill="url(#midChannelGrad)"
                        />

                        <path
                          d={riverGeometry.deepThalwegPath}
                          fill="url(#deepThalwegGrad)"
                        />

                        {riverGeometry.islands.map(island => (
                          <g key={island.id}>
                            <path
                              d={island.outerPath}
                              fill="var(--color-surface-container-low)"
                              fillOpacity="0.92"
                              stroke="#387b91"
                              strokeOpacity="0.45"
                              strokeWidth="1"
                            />
                            <path
                              d={island.innerVegPath}
                              fill="#8cb3a3"
                              fillOpacity="0.35"
                              stroke="#5c8a79"
                              strokeOpacity="0.35"
                              strokeWidth="0.75"
                            />
                          </g>
                        ))}

                        {riverGeometry.spanArcs.map(arc => {
                          const parentCluster = clusters[arc.fromClusterIndex];
                          const isHighlighted =
                            parentCluster &&
                            (selectedClusterKey === parentCluster.key ||
                              hoveredClusterKey === parentCluster.key);

                          return (
                            <g key={arc.id}>
                              <path
                                d={arc.pathD}
                                fill="none"
                                stroke="#2d6d82"
                                strokeOpacity={isHighlighted ? '0.75' : '0.32'}
                                strokeWidth={isHighlighted ? '1.8' : '1.15'}
                                strokeDasharray="3 4"
                              />
                              <circle
                                cx={arc.midX}
                                cy={arc.midY}
                                r={isHighlighted ? 4 : 2.8}
                                fill="#2d6d82"
                                fillOpacity={isHighlighted ? '0.85' : '0.45'}
                              />
                            </g>
                          );
                        })}

                        {riverGeometry.bendNodes.map(node => {
                          const isSelected =
                            selectedClusterKey === node.cluster.key;
                          const isHovered =
                            hoveredClusterKey === node.cluster.key;
                          const active = isSelected || isHovered;
                          const dockAnchorX = node.isRightApex
                            ? riverGeometry.W * 0.56
                            : riverGeometry.W * 0.44;

                          return (
                            <g key={`svg-bend-${node.cluster.key}`}>
                              <circle
                                cx={node.x}
                                cy={node.y}
                                r={node.width * 0.48}
                                fill="none"
                                stroke="#296b82"
                                strokeOpacity={active ? '0.52' : '0.22'}
                                strokeWidth={active ? '1.4' : '0.9'}
                              />
                              <line
                                x1={node.x}
                                y1={node.y}
                                x2={dockAnchorX}
                                y2={node.y}
                                stroke="#2d6d82"
                                strokeOpacity={active ? '0.55' : '0.25'}
                                strokeWidth={active ? '1.5' : '1'}
                              />
                            </g>
                          );
                        })}
                      </svg>

                      {riverGeometry.bendNodes.map(node => (
                        <TimelineEraMarker
                          key={node.cluster.key}
                          node={node}
                          stageWidth={riverGeometry.W}
                          selectedClusterKey={selectedClusterKey}
                          hoveredClusterKey={hoveredClusterKey}
                          onSelectCluster={setSelectedClusterKey}
                          onHoverCluster={setHoveredClusterKey}
                        />
                      ))}
                    </div>

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
