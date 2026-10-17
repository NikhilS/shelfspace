import React, {useMemo, useState, useRef, useEffect, useCallback} from 'react';
import {useParams} from 'react-router-dom';
import {ZoomIn, ZoomOut, Maximize2} from 'lucide-react';
import {ScatterPoint} from '../../hooks/useConstellationData';
import {
  Point2D,
  computeClusterMST,
  computePaddedConvexHull,
  createSeededRng,
} from '../../lib/clustering';
import {
  CLUSTER_COLORS,
  ClusterGeometry,
  StippleGrain,
  CameraState,
  ConstellationChartProps,
} from './types';
import {renderConstellationFrame} from './ConstellationCanvasRenderer';
import {ConstellationToolbar} from './ConstellationToolbar';
import {ConstellationInspector} from './ConstellationInspector';

export {CLUSTER_COLORS} from './types';

export default function ConstellationChart({
  plotData,
  clusterNames,
  libraryId: propLibraryId,
}: ConstellationChartProps) {
  const {id: routeLibraryId} = useParams<{id: string}>();
  const libraryId = propLibraryId || routeLibraryId;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  }>({width: 900, height: 620});

  const [selectedStarId, setSelectedStarId] = useState<string | null>(null);
  const [activeClusterId, setActiveClusterId] = useState<number | null>(null);
  const [hoveredStarId, setHoveredStarId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [zoomDisplay, setZoomDisplay] = useState(100);

  // Camera state stored in a mutable ref for zero-allocation 60fps animation
  const cameraRef = useRef<CameraState>({
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
  });

  // Interaction refs
  const pointerStateRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    movedDistance: number;
    activePointers: Map<number, {x: number; y: number}>;
    lastPinchDist: number | null;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    movedDistance: 0,
    activePointers: new Map(),
    lastPinchDist: null,
  });

  const rafIdRef = useRef<number | null>(null);
  const triggerRenderRef = useRef<() => void>(() => {});

  // Precompute deterministic warm archival stipple points for paper texture depth
  const paperStipples = useMemo<StippleGrain[]>(() => {
    const rng = createSeededRng(90210);
    return Array.from({length: 140}, () => ({
      x: (rng() - 0.5) * 320,
      y: (rng() - 0.5) * 320,
      radius: 0.6 + rng() * 1.1,
      alpha: 0.08 + rng() * 0.16,
    }));
  }, []);

  // Map book ID to index and point for O(1) lookups
  const starById = useMemo(() => {
    const map = new Map<string, {point: ScatterPoint; index: number}>();
    plotData.forEach((point, index) => {
      const id = point.id || point.book.id;
      map.set(id, {point, index});
    });
    return map;
  }, [plotData]);

  // Precompute Cluster Geometry (Centroids, Prim's MST edges, Padded Convex Hulls, Dominant Genres)
  const clustersGeometry = useMemo<ClusterGeometry[]>(() => {
    const grouped = new Map<number, number[]>();
    const allWorldPoints: Point2D[] = plotData.map(p => ({x: p.x, y: p.y}));

    plotData.forEach((p, idx) => {
      if (p.clusterId < 0) return;
      const list = grouped.get(p.clusterId) || [];
      list.push(idx);
      grouped.set(p.clusterId, list);
    });

    const result: ClusterGeometry[] = [];
    const sortedClusterIds = Array.from(grouped.keys()).sort((a, b) => a - b);

    for (const cid of sortedClusterIds) {
      const indices = grouped.get(cid) || [];
      if (indices.length === 0) continue;

      const clusterPts = indices.map(i => allWorldPoints[i]);
      let sumX = 0;
      let sumY = 0;
      const genreCounts = new Map<string, number>();

      for (const idx of indices) {
        sumX += allWorldPoints[idx].x;
        sumY += allWorldPoints[idx].y;
        const genre = plotData[idx].book.primaryGenre;
        if (genre) {
          genreCounts.set(genre, (genreCounts.get(genre) || 0) + 1);
        }
      }

      const centroid = {
        x: sumX / indices.length,
        y: sumY / indices.length,
      };

      const mstEdges = computeClusterMST(allWorldPoints, indices);
      const hullPoints = computePaddedConvexHull(clusterPts, 6.2);
      const dominantGenres = Array.from(genreCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([g]) => g);

      result.push({
        clusterId: cid,
        name: clusterNames[cid] || `Constellation ${cid + 1}`,
        color: CLUSTER_COLORS[cid % CLUSTER_COLORS.length],
        centroid,
        pointIndices: indices,
        mstEdges,
        hullPoints,
        dominantGenres,
      });
    }

    return result;
  }, [plotData, clusterNames]);

  const clusterById = useMemo(() => {
    const map = new Map<number, ClusterGeometry>();
    clustersGeometry.forEach(c => map.set(c.clusterId, c));
    return map;
  }, [clustersGeometry]);

  // Search filter matching book IDs
  const matchingStarIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const p of plotData) {
      const id = p.id || p.book.id;
      const title = (p.book.title || '').toLowerCase();
      const author = (p.book.author || '').toLowerCase();
      const genre = (p.book.primaryGenre || '').toLowerCase();
      const cname = (clusterNames[p.clusterId] || '').toLowerCase();
      if (
        title.includes(q) ||
        author.includes(q) ||
        genre.includes(q) ||
        cname.includes(q)
      ) {
        set.add(id);
      }
    }
    return set;
  }, [plotData, clusterNames, searchQuery]);

  const selectedStar = useMemo(() => {
    if (!selectedStarId) return null;
    return starById.get(selectedStarId)?.point || null;
  }, [selectedStarId, starById]);

  const hoveredStar = useMemo(() => {
    if (!hoveredStarId) return null;
    return starById.get(hoveredStarId)?.point || null;
  }, [hoveredStarId, starById]);

  const activeCluster = useMemo(() => {
    const cid =
      activeClusterId !== null
        ? activeClusterId
        : selectedStar
          ? selectedStar.clusterId
          : null;
    if (cid === null || cid < 0) return null;
    return clusterById.get(cid) || null;
  }, [activeClusterId, selectedStar, clusterById]);

  // Coordinate conversions between World [-100, 100] and Screen pixels
  const getBaseScale = useCallback((width: number, height: number) => {
    return (Math.min(width, height) * 0.42) / 100;
  }, []);

  const worldToScreen = useCallback(
    (
      wx: number,
      wy: number,
      cam: {x: number; y: number; zoom: number},
      width: number,
      height: number,
    ): Point2D => {
      const scale = getBaseScale(width, height) * cam.zoom;
      return {
        x: width * 0.5 + (wx - cam.x) * scale,
        y: height * 0.5 + (wy - cam.y) * scale,
      };
    },
    [getBaseScale],
  );

  const screenToWorld = useCallback(
    (
      sx: number,
      sy: number,
      cam: {x: number; y: number; zoom: number},
      width: number,
      height: number,
    ): Point2D => {
      const scale = getBaseScale(width, height) * cam.zoom;
      return {
        x: cam.x + (sx - width * 0.5) / Math.max(1e-6, scale),
        y: cam.y + (sy - height * 0.5) / Math.max(1e-6, scale),
      };
    },
    [getBaseScale],
  );

  // Camera Actions
  const focusOnStar = useCallback(
    (star: ScatterPoint, targetZoomLevel?: number) => {
      const id = star.id || star.book.id;
      setSelectedStarId(id);
      setActiveClusterId(star.clusterId >= 0 ? star.clusterId : null);
      cameraRef.current.targetX = star.x;
      cameraRef.current.targetY = star.y;
      cameraRef.current.targetZoom = Math.max(
        cameraRef.current.targetZoom,
        targetZoomLevel ?? 1.75,
      );
      triggerRenderRef.current();
    },
    [],
  );

  const focusOnCluster = useCallback(
    (clusterId: number) => {
      const cluster = clusterById.get(clusterId);
      if (!cluster) return;
      setSelectedStarId(null);
      setActiveClusterId(clusterId);

      // Compute bounding box of cluster stars
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const idx of cluster.pointIndices) {
        const pt = plotData[idx];
        if (pt.x < minX) minX = pt.x;
        if (pt.x > maxX) maxX = pt.x;
        if (pt.y < minY) minY = pt.y;
        if (pt.y > maxY) maxY = pt.y;
      }

      const span = Math.max(26, maxX - minX, maxY - minY);
      const fitZoom = Math.max(1.2, Math.min(3.0, 125 / span));

      cameraRef.current.targetX = (minX + maxX) * 0.5;
      cameraRef.current.targetY = (minY + maxY) * 0.5;
      cameraRef.current.targetZoom = fitZoom;
      triggerRenderRef.current();
    },
    [clusterById, plotData],
  );

  const handleResetView = useCallback(() => {
    setSelectedStarId(null);
    setActiveClusterId(null);
    cameraRef.current.targetX = 0;
    cameraRef.current.targetY = 0;
    cameraRef.current.targetZoom = 1;
    triggerRenderRef.current();
  }, []);

  const handleZoomStep = useCallback((factor: number) => {
    const next = Math.max(
      0.55,
      Math.min(6.0, cameraRef.current.targetZoom * factor),
    );
    cameraRef.current.targetZoom = next;
    triggerRenderRef.current();
  }, []);

  // Track viewport size with ResizeObserver
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(300, Math.floor(entry.contentRect.width));
        const h = Math.max(380, Math.floor(entry.contentRect.height));
        setViewportSize(prev =>
          prev.width === w && prev.height === h ? prev : {width: w, height: h},
        );
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Main 2D HTML5 Canvas Render Loop — Warm Archival Cartography
  useEffect(() => {
    if (
      typeof navigator !== 'undefined' &&
      /jsdom/i.test(navigator.userAgent || '')
    ) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let isDisposed = false;

    const drawFrame = () => {
      if (isDisposed) return;

      const cam = cameraRef.current;
      const dx = cam.targetX - cam.x;
      const dy = cam.targetY - cam.y;
      const dz = cam.targetZoom - cam.zoom;

      const isMoving =
        Math.abs(dx) > 0.015 || Math.abs(dy) > 0.015 || Math.abs(dz) > 0.0015;

      if (isMoving) {
        cam.x += dx * 0.18;
        cam.y += dy * 0.18;
        cam.zoom += dz * 0.18;
        const pct = Math.round(cam.zoom * 100);
        setZoomDisplay(prev => (prev === pct ? prev : pct));
      } else {
        cam.x = cam.targetX;
        cam.y = cam.targetY;
        cam.zoom = cam.targetZoom;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const {width, height} = viewportSize;
      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
      }

      const isDark =
        typeof document !== 'undefined' &&
        (document.documentElement.classList.contains('dark') ||
          document.documentElement.getAttribute('data-theme') === 'dark');

      renderConstellationFrame({
        ctx,
        width,
        height,
        dpr,
        isDark,
        cam,
        plotData,
        clustersGeometry,
        paperStipples,
        selectedStarId,
        selectedStar,
        activeClusterId,
        hoveredStarId,
        matchingStarIds,
        starById,
        worldToScreen,
        getBaseScale,
      });

      if (isMoving) {
        rafIdRef.current = requestAnimationFrame(drawFrame);
      } else {
        rafIdRef.current = null;
      }
    };

    const scheduleRender = () => {
      if (rafIdRef.current === null) {
        rafIdRef.current = requestAnimationFrame(drawFrame);
      }
    };

    triggerRenderRef.current = scheduleRender;
    scheduleRender();

    return () => {
      isDisposed = true;
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [
    viewportSize,
    plotData,
    clustersGeometry,
    paperStipples,
    selectedStarId,
    selectedStar,
    activeClusterId,
    hoveredStarId,
    matchingStarIds,
    starById,
    worldToScreen,
    getBaseScale,
  ]);

  // Hit-testing helper for stars
  const findHitAtScreenPos = useCallback(
    (
      sx: number,
      sy: number,
      hitRadiusPx: number,
    ): {type: 'star'; star: ScatterPoint} | null => {
      const cam = cameraRef.current;
      const {width, height} = viewportSize;

      let bestStar: ScatterPoint | null = null;
      let bestDist = hitRadiusPx;

      for (let i = 0; i < plotData.length; i++) {
        const pt = plotData[i];
        const sp = worldToScreen(pt.x, pt.y, cam, width, height);
        const d = Math.hypot(sp.x - sx, sp.y - sy);
        if (d < bestDist) {
          bestDist = d;
          bestStar = pt;
        }
      }

      if (bestStar) {
        return {type: 'star', star: bestStar};
      }

      return null;
    },
    [plotData, viewportSize, worldToScreen],
  );

  // Pointer & Touch Event Handlers
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const ps = pointerStateRef.current;
    ps.activePointers.set(e.pointerId, {x: sx, y: sy});

    if (ps.activePointers.size === 1) {
      ps.isDragging = true;
      ps.startX = sx;
      ps.startY = sy;
      ps.lastX = sx;
      ps.lastY = sy;
      ps.movedDistance = 0;
      ps.lastPinchDist = null;
    } else if (ps.activePointers.size === 2) {
      const pts = Array.from(ps.activePointers.values());
      ps.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const ps = pointerStateRef.current;
    if (ps.activePointers.has(e.pointerId)) {
      ps.activePointers.set(e.pointerId, {x: sx, y: sy});
    }

    // 2-Finger Pinch-to-Zoom
    if (ps.activePointers.size === 2) {
      const pts = Array.from(ps.activePointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (ps.lastPinchDist && ps.lastPinchDist > 10) {
        const ratio = dist / ps.lastPinchDist;
        const nextZoom = Math.max(
          0.55,
          Math.min(6.0, cameraRef.current.targetZoom * ratio),
        );
        cameraRef.current.targetZoom = nextZoom;
        cameraRef.current.zoom = nextZoom;
        triggerRenderRef.current();
      }
      ps.lastPinchDist = dist;
      ps.movedDistance += 10;
      return;
    }

    // 1-Finger / Mouse Pan
    if (ps.isDragging && ps.activePointers.size === 1) {
      const dx = sx - ps.lastX;
      const dy = sy - ps.lastY;
      ps.lastX = sx;
      ps.lastY = sy;
      ps.movedDistance += Math.hypot(dx, dy);

      const scale =
        getBaseScale(viewportSize.width, viewportSize.height) *
        cameraRef.current.zoom;
      cameraRef.current.targetX -= dx / Math.max(1e-6, scale);
      cameraRef.current.targetY -= dy / Math.max(1e-6, scale);
      cameraRef.current.x = cameraRef.current.targetX;
      cameraRef.current.y = cameraRef.current.targetY;
      triggerRenderRef.current();
      return;
    }

    // Hover Hit-Testing
    const hit = findHitAtScreenPos(sx, sy, 22);
    if (hit && hit.type === 'star') {
      const id = hit.star.id || hit.star.book.id;
      if (hoveredStarId !== id) {
        setHoveredStarId(id);
      }
    } else if (hoveredStarId !== null) {
      setHoveredStarId(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    const rect = canvas?.getBoundingClientRect();
    const sx = rect ? e.clientX - rect.left : 0;
    const sy = rect ? e.clientY - rect.top : 0;

    const ps = pointerStateRef.current;
    ps.activePointers.delete(e.pointerId);

    if (ps.activePointers.size < 2) {
      ps.lastPinchDist = null;
    }
    if (ps.activePointers.size === 0) {
      ps.isDragging = false;
    }

    // Treat as a deliberate click/tap if pointer moved < 7px
    if (ps.movedDistance < 7 && rect) {
      const hitRadius = e.pointerType === 'touch' ? 34 : 24;
      const hit = findHitAtScreenPos(sx, sy, hitRadius);

      if (hit?.type === 'star') {
        focusOnStar(hit.star);
      } else {
        if (selectedStarId) {
          setSelectedStarId(null);
        } else if (activeClusterId !== null) {
          setActiveClusterId(null);
        }
      }
    }
  };

  // Native non-passive wheel listener for cursor-centered zoom without page scroll
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const cam = cameraRef.current;
      const worldBefore = screenToWorld(
        sx,
        sy,
        cam,
        viewportSize.width,
        viewportSize.height,
      );

      const zoomFactor = e.deltaY < 0 ? 1.16 : 0.86;
      const nextZoom = Math.max(
        0.55,
        Math.min(6.0, cam.targetZoom * zoomFactor),
      );

      const nextScale =
        getBaseScale(viewportSize.width, viewportSize.height) * nextZoom;
      cam.targetZoom = nextZoom;
      cam.targetX =
        worldBefore.x -
        (sx - viewportSize.width * 0.5) / Math.max(1e-6, nextScale);
      cam.targetY =
        worldBefore.y -
        (sy - viewportSize.height * 0.5) / Math.max(1e-6, nextScale);

      triggerRenderRef.current();
    };

    canvas.addEventListener('wheel', onWheel, {passive: false});
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [viewportSize, screenToWorld, getBaseScale]);

  return (
    <div className="flex flex-col gap-4">
      <ConstellationToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalVolumes={plotData.length}
        clustersGeometry={clustersGeometry}
        activeClusterId={activeClusterId}
        selectedStarId={selectedStarId}
        onResetView={handleResetView}
        onFocusCluster={focusOnCluster}
      />

      {/* Main Split Workspace: Archival Cartographic Plate + Curatorial Side Inspector */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
        {/* 2D HTML5 Canvas Archival Plate */}
        <div
          ref={containerRef}
          className="lg:col-span-8 relative w-full h-[480px] sm:h-[560px] lg:h-[640px] rounded-2xl border border-outline-variant/70 overflow-hidden bg-surface-container select-none shadow-xs"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className={`w-full h-full block touch-none ${
              hoveredStarId
                ? 'cursor-pointer'
                : 'cursor-grab active:cursor-grabbing'
            }`}
          />

          {/* Top-Left Archival Scale & Volume Summary */}
          <div className="absolute top-3 left-3 pointer-events-none flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface/90 backdrop-blur-md border border-outline-variant/60 text-on-surface-variant text-xs shadow-2xs">
            <span className="font-mono tabular-nums font-medium text-on-surface">
              {plotData.length} volumes
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              {clustersGeometry.length} constellations
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">{zoomDisplay}%</span>
          </div>

          {/* Top-Right Warm Archival Camera Controls */}
          <div className="absolute top-3 right-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => handleZoomStep(1.28)}
              title="Zoom in"
              aria-label="Zoom in"
              className="p-2 rounded-lg bg-surface/95 hover:bg-surface-container text-on-surface border border-outline-variant/60 shadow-2xs transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => handleZoomStep(0.78)}
              title="Zoom out"
              aria-label="Zoom out"
              className="p-2 rounded-lg bg-surface/95 hover:bg-surface-container text-on-surface border border-outline-variant/60 shadow-2xs transition-colors"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetView}
              title="Fit all constellations"
              aria-label="Fit all constellations"
              className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-surface/95 hover:bg-surface-container text-on-surface border border-outline-variant/60 shadow-2xs text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Fit Atlas</span>
            </button>
          </div>

          {/* Bottom-Left Warm Archival Hover Preview Card */}
          {hoveredStar && hoveredStar.id !== selectedStarId && (
            <div className="absolute bottom-3 left-3 right-3 sm:right-auto sm:max-w-xs pointer-events-none bg-surface/95 backdrop-blur-md border border-outline-variant/70 rounded-xl p-3 shadow-md text-on-surface">
              <div className="flex items-start gap-2.5">
                {hoveredStar.book.coverUrl && (
                  <img
                    src={hoveredStar.book.coverUrl}
                    alt={hoveredStar.book.title}
                    className="w-9 h-13 object-cover rounded-xs border border-outline-variant/40 shrink-0"
                    referrerPolicy="no-referrer"
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
                    Click point to lock &amp; trace kindred books
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <ConstellationInspector
          selectedStar={selectedStar}
          activeCluster={activeCluster}
          clustersGeometry={clustersGeometry}
          plotData={plotData}
          clusterNames={clusterNames}
          starById={starById}
          libraryId={libraryId}
          onClearStar={() => setSelectedStarId(null)}
          onResetView={handleResetView}
          onFocusCluster={focusOnCluster}
          onFocusStar={focusOnStar}
        />
      </div>
    </div>
  );
}
