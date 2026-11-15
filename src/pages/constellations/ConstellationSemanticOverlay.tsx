import React, {useMemo} from 'react';
import {ChevronDown, ChevronUp, Maximize2, ZoomIn, ZoomOut} from 'lucide-react';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';
import type {ScatterPoint} from '../../hooks/useConstellationData';
import type {Point2D} from '../../lib/clustering';
import type {SpatialGridIndex} from './spatialIndex';
import {
  CLUSTER_COLORS,
  type ClusterGeometry,
  type SemanticLodWeights,
} from './types';

interface PlacedRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface ConstellationSemanticOverlayProps {
  plotData: ScatterPoint[];
  clustersGeometry: ClusterGeometry[];
  spatialIndex: SpatialGridIndex;
  cameraSnapshot: {x: number; y: number; zoom: number};
  viewportSize: {width: number; height: number};
  lodWeights: SemanticLodWeights;
  selectedStarId: string | null;
  selectedStar: ScatterPoint | null;
  hoveredStarId: string | null;
  hoveredStar: ScatterPoint | null;
  activeClusterId: number | null;
  matchingStarIds: Set<string> | null;
  worldToScreen: (
    wx: number,
    wy: number,
    cam: {x: number; y: number; zoom: number},
    width: number,
    height: number,
  ) => Point2D;
  screenToWorld: (
    sx: number,
    sy: number,
    cam: {x: number; y: number; zoom: number},
    width: number,
    height: number,
  ) => Point2D;
  onFocusCluster: (clusterId: number) => void;
  onFocusStar: (star: ScatterPoint) => void;
}

export function ConstellationSemanticOverlay({
  plotData,
  clustersGeometry,
  spatialIndex,
  cameraSnapshot,
  viewportSize,
  lodWeights,
  selectedStarId,
  selectedStar,
  hoveredStarId,
  hoveredStar,
  activeClusterId,
  matchingStarIds,
  worldToScreen,
  screenToWorld,
  onFocusCluster,
  onFocusStar,
}: ConstellationSemanticOverlayProps) {
  const focusedClusterId =
    activeClusterId !== null
      ? activeClusterId
      : selectedStar
        ? selectedStar.clusterId
        : null;

  const selectedNeighborMap = useMemo(() => {
    const map = new Map<string, number>();
    if (selectedStar) {
      for (const nb of selectedStar.neighbors) {
        map.set(nb.bookId, nb.similarity);
      }
    }
    return map;
  }, [selectedStar]);

  const visibleClusterBanners = useMemo(() => {
    if (lodWeights.bannerOpacity <= 0.04) {
      return [];
    }
    const placed: PlacedRect[] = [];
    const overlaps = (r: PlacedRect) =>
      placed.some(
        b => r.x1 < b.x2 && r.x2 > b.x1 && r.y1 < b.y2 && r.y2 > b.y1,
      );

    const banners: Array<{
      cluster: ClusterGeometry;
      x: number;
      y: number;
      isFocused: boolean;
      opacity: number;
    }> = [];

    for (const cluster of clustersGeometry) {
      const sp = worldToScreen(
        cluster.centroid.x,
        cluster.centroid.y,
        cameraSnapshot,
        viewportSize.width,
        viewportSize.height,
      );
      if (
        sp.x < 40 ||
        sp.x > viewportSize.width - 40 ||
        sp.y < 32 ||
        sp.y > viewportSize.height - 32
      ) {
        continue;
      }

      const estHalfW = Math.max(58, cluster.name.length * 4.2 + 24);
      const rect: PlacedRect = {
        x1: sp.x - estHalfW,
        y1: sp.y - 16,
        x2: sp.x + estHalfW,
        y2: sp.y + 16,
      };

      const isFocused = focusedClusterId === cluster.clusterId;
      if (!isFocused && overlaps(rect)) {
        continue;
      }
      placed.push(rect);

      const dimFactor = focusedClusterId === null || isFocused ? 1.0 : 0.42;

      banners.push({
        cluster,
        x: sp.x,
        y: sp.y,
        isFocused,
        opacity: lodWeights.bannerOpacity * dimFactor,
      });
    }

    return banners;
  }, [
    clustersGeometry,
    cameraSnapshot,
    viewportSize,
    lodWeights.bannerOpacity,
    focusedClusterId,
    worldToScreen,
  ]);

  const visibleTitleCallouts = useMemo(() => {
    const anchorSet = new Set<number>();
    if (lodWeights.titleOpacity > 0.05) {
      for (const c of clustersGeometry) {
        if (c.anchorIndices) {
          for (const idx of c.anchorIndices) {
            anchorSet.add(idx);
          }
        }
      }
    }

    const candidates: number[] = [];
    for (let i = 0; i < plotData.length; i++) {
      const id = plotData[i].id || plotData[i].book.id;
      const isPriority =
        id === selectedStarId ||
        id === hoveredStarId ||
        selectedNeighborMap.has(id) ||
        (matchingStarIds ? matchingStarIds.has(id) : false);

      if (
        isPriority ||
        (lodWeights.titleOpacity > 0.08 &&
          lodWeights.coverOpacity < 0.65 &&
          (anchorSet.has(i) || cameraSnapshot.zoom >= 1.85))
      ) {
        candidates.push(i);
      }
    }

    candidates.sort((a, b) => {
      const idA = plotData[a].id || plotData[a].book.id;
      const idB = plotData[b].id || plotData[b].book.id;
      const score = (id: string, idx: number) =>
        id === selectedStarId
          ? 100
          : id === hoveredStarId
            ? 95
            : selectedNeighborMap.has(id)
              ? 85
              : matchingStarIds?.has(id)
                ? 75
                : anchorSet.has(idx)
                  ? 40
                  : 10;
      return score(idB, b) - score(idA, a);
    });

    const placed: PlacedRect[] = [];
    const overlaps = (r: PlacedRect) =>
      placed.some(
        b => r.x1 < b.x2 && r.x2 > b.x1 && r.y1 < b.y2 && r.y2 > b.y1,
      );

    const callouts: Array<{
      star: ScatterPoint;
      id: string;
      x: number;
      y: number;
      isSelected: boolean;
      isHovered: boolean;
      isNeighbor: boolean;
      affinityPct: number | null;
      opacity: number;
    }> = [];

    for (const idx of candidates) {
      if (callouts.length >= 28) {
        break;
      }
      const pt = plotData[idx];
      const id = pt.id || pt.book.id;
      const isSelected = id === selectedStarId;
      const isHovered = id === hoveredStarId;
      const isNeighbor = selectedNeighborMap.has(id);
      const isPriority =
        isSelected ||
        isHovered ||
        isNeighbor ||
        (matchingStarIds ? matchingStarIds.has(id) : false);

      if (lodWeights.coverOpacity >= 0.55 && !isSelected && !isHovered) {
        continue;
      }

      const sp = worldToScreen(
        pt.x,
        pt.y,
        cameraSnapshot,
        viewportSize.width,
        viewportSize.height,
      );
      if (
        sp.x < 24 ||
        sp.x > viewportSize.width - 24 ||
        sp.y < 20 ||
        sp.y > viewportSize.height - 20
      ) {
        continue;
      }

      const estW = Math.min(28, (pt.book.title || '').length) * 6.2 + 28;
      const rect: PlacedRect = {
        x1: sp.x + 8,
        y1: sp.y - 13,
        x2: sp.x + 12 + estW,
        y2: sp.y + 13,
      };

      if (!isSelected && !isHovered && overlaps(rect)) {
        continue;
      }
      placed.push(rect);

      const sim = selectedNeighborMap.get(id);
      callouts.push({
        star: pt,
        id,
        x: sp.x,
        y: sp.y,
        isSelected,
        isHovered,
        isNeighbor,
        affinityPct: typeof sim === 'number' ? Math.round(sim * 100) : null,
        opacity: isPriority ? 1 : lodWeights.titleOpacity,
      });
    }

    return callouts;
  }, [
    plotData,
    clustersGeometry,
    selectedStarId,
    hoveredStarId,
    selectedNeighborMap,
    matchingStarIds,
    lodWeights.titleOpacity,
    lodWeights.coverOpacity,
    cameraSnapshot,
    viewportSize,
    worldToScreen,
  ]);

  const visibleBookCoverPlates = useMemo(() => {
    if (lodWeights.coverOpacity <= 0.05) {
      return [];
    }

    const topLeftWorld = screenToWorld(
      -40,
      -40,
      cameraSnapshot,
      viewportSize.width,
      viewportSize.height,
    );
    const bottomRightWorld = screenToWorld(
      viewportSize.width + 40,
      viewportSize.height + 40,
      cameraSnapshot,
      viewportSize.width,
      viewportSize.height,
    );

    const candidateIndices = spatialIndex.queryStarIndicesInBounds(
      Math.min(topLeftWorld.x, bottomRightWorld.x),
      Math.min(topLeftWorld.y, bottomRightWorld.y),
      Math.max(topLeftWorld.x, bottomRightWorld.x),
      Math.max(topLeftWorld.y, bottomRightWorld.y),
    );

    candidateIndices.sort((a, b) => {
      const idA = plotData[a].id || plotData[a].book.id;
      const idB = plotData[b].id || plotData[b].book.id;
      const score = (id: string) =>
        id === selectedStarId
          ? 100
          : id === hoveredStarId
            ? 90
            : selectedNeighborMap.has(id)
              ? 80
              : matchingStarIds?.has(id)
                ? 70
                : 10;
      return score(idB) - score(idA);
    });

    const placed: PlacedRect[] = [];
    const overlaps = (r: PlacedRect) =>
      placed.some(
        b => r.x1 < b.x2 && r.x2 > b.x1 && r.y1 < b.y2 && r.y2 > b.y1,
      );

    const plates: Array<{
      star: ScatterPoint;
      id: string;
      x: number;
      y: number;
      color: string;
      isSelected: boolean;
      isNeighbor: boolean;
    }> = [];

    for (const idx of candidateIndices) {
      if (plates.length >= 36) {
        break;
      }
      const pt = plotData[idx];
      const id = pt.id || pt.book.id;
      const isSelected = id === selectedStarId;
      const isNeighbor = selectedNeighborMap.has(id);

      const sp = worldToScreen(
        pt.x,
        pt.y,
        cameraSnapshot,
        viewportSize.width,
        viewportSize.height,
      );
      if (
        sp.x < 30 ||
        sp.x > viewportSize.width - 30 ||
        sp.y < 36 ||
        sp.y > viewportSize.height - 36
      ) {
        continue;
      }

      const rect: PlacedRect = {
        x1: sp.x - 34,
        y1: sp.y - 44,
        x2: sp.x + 34,
        y2: sp.y + 44,
      };

      if (!isSelected && overlaps(rect)) {
        continue;
      }
      placed.push(rect);

      const color =
        pt.clusterId >= 0
          ? CLUSTER_COLORS[pt.clusterId % CLUSTER_COLORS.length]
          : '#78716C';

      plates.push({
        star: pt,
        id,
        x: sp.x,
        y: sp.y,
        color,
        isSelected,
        isNeighbor,
      });
    }

    return plates;
  }, [
    lodWeights.coverOpacity,
    cameraSnapshot,
    viewportSize,
    spatialIndex,
    plotData,
    selectedStarId,
    hoveredStarId,
    selectedNeighborMap,
    matchingStarIds,
    screenToWorld,
    worldToScreen,
  ]);

  return (
    <>
      <div
        aria-label="Constellation Map Semantic Overlay"
        className="absolute inset-0 pointer-events-none overflow-hidden z-10"
      >
        {visibleClusterBanners.map(({cluster, x, y, isFocused, opacity}) => (
          <button
            key={`banner-${cluster.clusterId}`}
            type="button"
            onClick={() => onFocusCluster(cluster.clusterId)}
            style={{
              left: 0,
              top: 0,
              transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -50%)`,
              opacity,
            }}
            className={`pointer-events-auto absolute will-change-transform inline-flex items-center gap-1.5 px-2 sm:px-2.5 py-0.5 sm:py-1 rounded-md border transition-colors ${
              isFocused
                ? 'bg-surface text-on-surface border-primary shadow-sm'
                : 'bg-surface/95 text-on-surface border-outline-variant/70 shadow-2xs hover:border-outline'
            }`}
          >
            <span
              className="w-2 h-2 rounded-xs shrink-0"
              style={{backgroundColor: cluster.color}}
            />
            <span className="font-serif text-[10px] sm:text-[11px] font-bold tracking-wider uppercase text-on-surface whitespace-nowrap">
              {cluster.name}
            </span>
            <span className="font-mono tabular-nums text-[10px] font-semibold text-on-surface-variant">
              {cluster.pointIndices.length}
            </span>
          </button>
        ))}

        {visibleTitleCallouts.map(
          ({
            star,
            id,
            x,
            y,
            isSelected,
            isHovered,
            isNeighbor,
            affinityPct,
            opacity,
          }) => (
            <button
              key={`title-${id}`}
              type="button"
              onClick={() => onFocusStar(star)}
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${Math.round(x + 10)}px, ${Math.round(y)}px, 0) translateY(-50%)`,
                opacity,
              }}
              className={`pointer-events-auto absolute will-change-transform inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-left transition-colors ${
                isSelected || isHovered
                  ? 'bg-surface text-on-surface border-primary shadow-sm z-20'
                  : isNeighbor
                    ? 'bg-surface/95 text-on-surface border-primary/50 shadow-2xs z-10'
                    : 'bg-surface/90 text-on-surface border-outline-variant/60 hover:bg-surface'
              }`}
            >
              <span className="font-sans text-[11px] font-semibold truncate max-w-[165px]">
                {star.book.title}
              </span>
              {affinityPct !== null && (
                <span className="font-mono tabular-nums text-[10px] font-bold text-primary shrink-0">
                  {affinityPct}%
                </span>
              )}
            </button>
          ),
        )}

        {visibleBookCoverPlates.map(
          ({star, id, x, y, color, isSelected, isNeighbor}) => (
            <button
              key={`cover-${id}`}
              type="button"
              onClick={() => onFocusStar(star)}
              style={{
                left: 0,
                top: 0,
                transform: `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0) translate(-50%, -50%)`,
                opacity: lodWeights.coverOpacity,
              }}
              className={`pointer-events-auto absolute will-change-transform flex flex-col items-center gap-1 p-1 rounded-lg border transition-colors ${
                isSelected
                  ? 'bg-surface border-primary shadow-md z-20 ring-2 ring-primary/30'
                  : isNeighbor
                    ? 'bg-surface/95 border-primary/60 shadow-sm z-10'
                    : 'bg-surface/95 border-outline-variant/70 shadow-xs'
              }`}
            >
              <div className="relative w-11 h-16 rounded-xs overflow-hidden border border-outline-variant/40 shrink-0">
                {star.book.coverUrl ? (
                  <img
                    src={star.book.coverUrl}
                    alt={star.book.title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <MonographCoverFallback
                    title={star.book.title}
                    author={star.book.author}
                    publishedYear={star.book.publishedDate}
                    variant="micro"
                    className="w-full h-full"
                  />
                )}
                <span
                  className="absolute bottom-0 inset-x-0 h-1"
                  style={{backgroundColor: color}}
                />
              </div>
              <span className="font-serif text-[10px] font-semibold text-on-surface leading-tight max-w-[68px] truncate">
                {star.book.title}
              </span>
            </button>
          ),
        )}
      </div>

      {hoveredStar && hoveredStar.id !== selectedStarId && (
        <div className="hidden lg:block absolute bottom-3 left-3 z-20 max-w-xs pointer-events-none bg-surface border border-outline-variant/80 rounded-xl p-3 shadow-md text-on-surface">
          <div className="flex items-start gap-2.5">
            {hoveredStar.book.coverUrl ? (
              <img
                src={hoveredStar.book.coverUrl}
                alt={hoveredStar.book.title}
                className="w-9 h-13 object-cover rounded-xs border border-outline-variant/40 shrink-0"
                referrerPolicy="no-referrer"
              />
            ) : (
              <MonographCoverFallback
                title={hoveredStar.book.title}
                author={hoveredStar.book.author}
                publishedYear={hoveredStar.book.publishedDate}
                variant="micro"
                className="w-9 h-13 rounded-xs shrink-0"
              />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-serif text-xs font-bold text-on-surface truncate">
                {hoveredStar.book.title}
              </p>
              <p className="text-[11px] text-on-surface-variant truncate">
                {hoveredStar.book.author}
              </p>
              <p className="text-[10px] text-primary font-medium mt-1">
                Click star to lock &amp; trace kindred books
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export interface ConstellationHudBarProps {
  totalBooks: number;
  totalConstellations: number;
  tierLabel: string;
  zoomDisplay: number;
  isHudCollapsed: boolean;
  onToggleHudCollapsed: () => void;
  onZoomStep: (factor: number) => void;
  onResetView: () => void;
}

export function ConstellationHudBar({
  totalBooks,
  totalConstellations,
  tierLabel,
  zoomDisplay,
  isHudCollapsed,
  onToggleHudCollapsed,
  onZoomStep,
  onResetView,
}: ConstellationHudBarProps) {
  return (
    <div className="w-full lg:w-auto lg:absolute lg:bottom-3 lg:left-1/2 lg:-translate-x-1/2 z-20 flex flex-wrap items-center justify-between lg:justify-center gap-2 lg:gap-1.5 px-3 py-2 lg:px-2.5 lg:py-1.5 rounded-xl bg-surface border border-outline-variant/80 text-on-surface shadow-xs lg:shadow-sm">
      {!isHudCollapsed && (
        <div className="flex items-center gap-1.5 sm:gap-2 lg:pr-2 lg:border-r border-outline-variant/60 text-xs text-on-surface-variant">
          <span className="font-mono tabular-nums font-semibold text-on-surface">
            {totalBooks} books
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums">
            {totalConstellations} constellations
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-sans font-medium text-primary">
            {tierLabel}
          </span>
        </div>
      )}

      <div className="flex items-center gap-1.5 ml-auto lg:ml-0">
        <button
          type="button"
          onClick={() => onZoomStep(0.78)}
          title="Zoom out"
          aria-label="Zoom out"
          className="p-2 lg:p-1.5 rounded-lg hover:bg-surface-container text-on-surface transition-colors"
        >
          <ZoomOut className="w-4 h-4" />
        </button>

        <span className="font-mono tabular-nums text-xs font-semibold text-on-surface min-w-[3.25rem] text-center">
          {zoomDisplay}%
        </span>

        <button
          type="button"
          onClick={() => onZoomStep(1.28)}
          title="Zoom in"
          aria-label="Zoom in"
          className="p-2 lg:p-1.5 rounded-lg hover:bg-surface-container text-on-surface transition-colors"
        >
          <ZoomIn className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={onResetView}
          title="Fit all constellations"
          aria-label="Fit all constellations"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/50 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
        >
          <Maximize2 className="w-3.5 h-3.5" />
          <span>Fit Atlas</span>
        </button>

        <button
          type="button"
          onClick={onToggleHudCollapsed}
          title={isHudCollapsed ? 'Expand HUD' : 'Collapse HUD'}
          aria-label={isHudCollapsed ? 'Expand HUD' : 'Collapse HUD'}
          className="hidden lg:inline-flex p-1.5 rounded-lg hover:bg-surface-container text-on-surface-variant hover:text-on-surface transition-colors"
        >
          {isHudCollapsed ? (
            <ChevronUp className="w-3.5 h-3.5" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}
