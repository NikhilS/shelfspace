import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {useParams} from 'react-router-dom';
import type {ScatterPoint} from '../../hooks/useConstellationData';
import type {Point2D} from '../../lib/clustering';
import {renderConstellationFrame} from './ConstellationCanvasRenderer';
import {ConstellationInspector} from './ConstellationInspector';
import {
  ConstellationHudBar,
  ConstellationSemanticOverlay,
} from './ConstellationSemanticOverlay';
import {ConstellationToolbar} from './ConstellationToolbar';
import {
  buildClustersGeometry,
  buildConstellationSemanticWebEdges,
  buildPaperStipples,
  buildStarByIdMap,
} from './constellationGeometryBuilder';
import {SpatialGridIndex} from './spatialIndex';
import {
  CLUSTER_COLORS,
  type ClusterGeometry,
  type ConstellationChartProps,
  type StippleGrain,
} from './types';
import {useConstellationCamera} from './useConstellationCamera';

export {CLUSTER_COLORS};

export function ConstellationChart({
  plotData,
  clusterNames,
  clusterTheses = {},
  crossClusterBridges = [],
  semanticWebEdges: propSemanticWebEdges,
  libraryId: propLibraryId,
}: ConstellationChartProps) {
  const {id: routeLibraryId} = useParams<{id: string}>();
  const libraryId = propLibraryId || routeLibraryId;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  }>({width: 960, height: 640});

  const [selectedStarId, setSelectedStarId] = useState<string | null>(null);
  const [activeClusterId, setActiveClusterId] = useState<number | null>(null);
  const [hoveredStarId, setHoveredStarId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(true);
  const [isHudCollapsed, setIsHudCollapsed] = useState(false);

  const paperStipples = useMemo<StippleGrain[]>(
    () => buildPaperStipples(90210),
    [],
  );

  const starById = useMemo(() => buildStarByIdMap(plotData), [plotData]);

  const clustersGeometry = useMemo<ClusterGeometry[]>(
    () => buildClustersGeometry(plotData, clusterNames, clusterTheses),
    [plotData, clusterNames, clusterTheses],
  );

  const spatialIndex = useMemo(
    () => new SpatialGridIndex(plotData, clustersGeometry, 16),
    [plotData, clustersGeometry],
  );

  const semanticWebEdges = useMemo(
    () =>
      buildConstellationSemanticWebEdges(
        plotData,
        starById,
        propSemanticWebEdges,
      ),
    [plotData, starById, propSemanticWebEdges],
  );

  const clusterById = useMemo(() => {
    const map = new Map<number, ClusterGeometry>();
    clustersGeometry.forEach(c => map.set(c.clusterId, c));
    return map;
  }, [clustersGeometry]);

  const handleOpenDrawer = useCallback(() => {
    setIsDrawerOpen(true);
  }, []);

  const {
    cameraRef,
    cameraSnapshot,
    zoomDisplay,
    lodWeights,
    triggerRenderRef,
    getBaseScale,
    worldToScreen,
    screenToWorld,
    focusOnStar,
    focusOnCluster,
    handleResetView,
    handleZoomStep,
    zoomAtScreenPoint,
    pinchAndPan,
    stepCameraPhysics,
  } = useConstellationCamera({
    viewportSize,
    plotData,
    clusterById,
    onSelectStar: setSelectedStarId,
    onSelectCluster: setActiveClusterId,
    onOpenDrawer: handleOpenDrawer,
  });

  const matchingStarIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return null;
    }
    const set = new Set<string>();
    for (const p of plotData) {
      const id = p.id || p.book.id;
      const title = (p.book.title || '').toLowerCase();
      const author = (p.book.author || '').toLowerCase();
      const genre = (p.book.primaryGenre || '').toLowerCase();
      const cname = (clusterNames[p.clusterId] || '').toLowerCase();
      const cthesis = (clusterTheses[p.clusterId] || '').toLowerCase();
      if (
        title.includes(q) ||
        author.includes(q) ||
        genre.includes(q) ||
        cname.includes(q) ||
        cthesis.includes(q)
      ) {
        set.add(id);
      }
    }
    return set;
  }, [plotData, clusterNames, clusterTheses, searchQuery]);

  const selectedStar = useMemo(() => {
    if (!selectedStarId) {
      return null;
    }
    return starById.get(selectedStarId)?.point || null;
  }, [selectedStarId, starById]);

  const hoveredStar = useMemo(() => {
    if (!hoveredStarId) {
      return null;
    }
    return starById.get(hoveredStarId)?.point || null;
  }, [hoveredStarId, starById]);

  const activeCluster = useMemo(() => {
    const cid =
      activeClusterId !== null
        ? activeClusterId
        : selectedStar
          ? selectedStar.clusterId
          : null;
    if (cid === null || cid < 0) {
      return null;
    }
    return clusterById.get(cid) || null;
  }, [activeClusterId, selectedStar, clusterById]);

  const pointerStateRef = useRef<{
    isDragging: boolean;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    movedDistance: number;
    activePointers: Map<number, {x: number; y: number}>;
    lastPinchDist: number | null;
    lastPinchCenter: Point2D | null;
  }>({
    isDragging: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    movedDistance: 0,
    activePointers: new Map(),
    lastPinchDist: null,
    lastPinchCenter: null,
  });

  const rafIdRef = useRef<number | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') {
      return;
    }

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

  const lastTapRef = useRef<{time: number; x: number; y: number}>({
    time: 0,
    x: 0,
    y: 0,
  });

  useEffect(() => {
    let isDisposed = false;

    const drawFrame = () => {
      if (isDisposed) {
        return;
      }

      const isCameraMoving = stepCameraPhysics(
        pointerStateRef.current.isDragging,
      );
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr =
          typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        const targetW = Math.floor(viewportSize.width * dpr);
        const targetH = Math.floor(viewportSize.height * dpr);
        if (canvas.width !== targetW || canvas.height !== targetH) {
          canvas.width = targetW;
          canvas.height = targetH;
        }

        let ctx: CanvasRenderingContext2D | null = null;
        try {
          ctx = canvas.getContext('2d');
        } catch {
          ctx = null;
        }

        if (ctx) {
          const isDark =
            typeof document !== 'undefined' &&
            (document.documentElement.classList.contains('dark') ||
              document.documentElement.getAttribute('data-theme') === 'dark');

          renderConstellationFrame({
            ctx,
            width: viewportSize.width,
            height: viewportSize.height,
            dpr,
            isDark,
            cam: cameraRef.current,
            lod: lodWeights,
            skipCanvasLabels: true,
            plotData,
            clustersGeometry,
            crossClusterBridges,
            semanticWebEdges,
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
        }
      }

      if (isCameraMoving) {
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
    lodWeights,
    plotData,
    clustersGeometry,
    crossClusterBridges,
    semanticWebEdges,
    paperStipples,
    selectedStarId,
    selectedStar,
    activeClusterId,
    hoveredStarId,
    matchingStarIds,
    starById,
    worldToScreen,
    getBaseScale,
    stepCameraPhysics,
    cameraRef,
    triggerRenderRef,
  ]);

  const findHitAtScreenPos = useCallback(
    (sx: number, sy: number, hitRadiusPx: number): ScatterPoint | null => {
      const cam = cameraRef.current;
      const {width, height} = viewportSize;
      const worldPt = screenToWorld(sx, sy, cam, width, height);
      const scale = getBaseScale(width, height) * cam.zoom;
      const maxWorldRadius = hitRadiusPx / Math.max(1e-6, scale);

      const hit = spatialIndex.queryNearestStar(
        worldPt.x,
        worldPt.y,
        maxWorldRadius,
      );
      return hit ? hit.star : null;
    },
    [cameraRef, viewportSize, screenToWorld, getBaseScale, spatialIndex],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const ps = pointerStateRef.current;
    ps.activePointers.set(e.pointerId, {x: sx, y: sy});

    cameraRef.current.vx = 0;
    cameraRef.current.vy = 0;

    if (ps.activePointers.size === 1) {
      ps.isDragging = true;
      ps.startX = sx;
      ps.startY = sy;
      ps.lastX = sx;
      ps.lastY = sy;
      ps.movedDistance = 0;
      ps.lastPinchDist = null;
      ps.lastPinchCenter = null;
    } else if (ps.activePointers.size === 2) {
      const pts = Array.from(ps.activePointers.values());
      ps.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      ps.lastPinchCenter = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const ps = pointerStateRef.current;
    if (ps.activePointers.has(e.pointerId)) {
      ps.activePointers.set(e.pointerId, {x: sx, y: sy});
    }

    if (ps.activePointers.size === 2) {
      const pts = Array.from(ps.activePointers.values());
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const center = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5,
      };

      if (ps.lastPinchCenter && ps.lastPinchDist && ps.lastPinchDist > 10) {
        const ratio = dist / ps.lastPinchDist;
        pinchAndPan(ps.lastPinchCenter, center, ratio);
      }

      ps.lastPinchDist = dist;
      ps.lastPinchCenter = center;
      ps.movedDistance += 10;
      return;
    }

    if (ps.isDragging && ps.activePointers.size === 1) {
      const dx = sx - ps.lastX;
      const dy = sy - ps.lastY;
      ps.lastX = sx;
      ps.lastY = sy;
      ps.movedDistance += Math.hypot(dx, dy);

      const scale =
        getBaseScale(viewportSize.width, viewportSize.height) *
        cameraRef.current.zoom;
      const worldDx = -dx / Math.max(1e-6, scale);
      const worldDy = -dy / Math.max(1e-6, scale);

      cameraRef.current.targetX += worldDx;
      cameraRef.current.targetY += worldDy;
      cameraRef.current.x = cameraRef.current.targetX;
      cameraRef.current.y = cameraRef.current.targetY;

      cameraRef.current.vx = cameraRef.current.vx * 0.45 + worldDx * 0.55;
      cameraRef.current.vy = cameraRef.current.vy * 0.45 + worldDy * 0.55;

      triggerRenderRef.current();
      return;
    }

    const hitStar = findHitAtScreenPos(sx, sy, 22);
    if (hitStar) {
      const id = hitStar.id || hitStar.book.id;
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
      ps.lastPinchCenter = null;
    }
    if (ps.activePointers.size === 0) {
      ps.isDragging = false;
    }

    if (ps.movedDistance < 7 && rect) {
      cameraRef.current.vx = 0;
      cameraRef.current.vy = 0;

      const now = Date.now();
      const prevTap = lastTapRef.current;
      if (
        e.pointerType === 'touch' &&
        now - prevTap.time < 290 &&
        Math.hypot(sx - prevTap.x, sy - prevTap.y) < 32
      ) {
        lastTapRef.current = {time: 0, x: 0, y: 0};
        const hitStar = findHitAtScreenPos(sx, sy, 34);
        if (hitStar) {
          focusOnStar(
            hitStar,
            Math.max(2.8, cameraRef.current.targetZoom * 1.45),
          );
        } else {
          zoomAtScreenPoint(sx, sy, 1.75);
        }
        return;
      }
      lastTapRef.current = {time: now, x: sx, y: sy};

      const hitRadius = e.pointerType === 'touch' ? 34 : 24;
      const hitStar = findHitAtScreenPos(sx, sy, hitRadius);

      if (hitStar) {
        focusOnStar(hitStar);
      } else if (selectedStarId) {
        setSelectedStarId(null);
      } else if (activeClusterId !== null) {
        setActiveClusterId(null);
      } else if (isDrawerOpen && viewportSize.width >= 1024) {
        setIsDrawerOpen(false);
      }
    } else {
      triggerRenderRef.current();
    }
  };

  const handleDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const hitStar = findHitAtScreenPos(sx, sy, 26);
    if (hitStar) {
      focusOnStar(hitStar, Math.max(2.8, cameraRef.current.targetZoom * 1.45));
    } else {
      zoomAtScreenPoint(sx, sy, 1.75);
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      const sensitivity = e.ctrlKey ? 0.0085 : 0.0022;
      const clampedDelta = Math.max(-160, Math.min(160, e.deltaY));
      const zoomMultiplier = Math.exp(-clampedDelta * sensitivity);

      zoomAtScreenPoint(sx, sy, zoomMultiplier);
    };

    canvas.addEventListener('wheel', onWheel, {passive: false});
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAtScreenPoint]);

  return (
    <div className="flex flex-col gap-3">
      <ConstellationToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        totalVolumes={plotData.length}
        clustersGeometry={clustersGeometry}
        activeClusterId={activeClusterId}
        selectedStarId={selectedStarId}
        isDrawerOpen={isDrawerOpen}
        onToggleDrawer={() => setIsDrawerOpen(prev => !prev)}
        onResetView={handleResetView}
        onFocusCluster={focusOnCluster}
      />

      <div className="relative flex flex-col gap-3">
        <div
          ref={containerRef}
          className="relative w-full h-[54vh] min-h-[360px] sm:h-[62vh] lg:h-[calc(100vh-12rem)] lg:min-h-[560px] max-h-[820px] rounded-2xl border border-outline-variant/70 overflow-hidden bg-surface-container select-none shadow-xs"
        >
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
            className={`w-full h-full block touch-none ${
              hoveredStarId
                ? 'cursor-pointer'
                : 'cursor-grab active:cursor-grabbing'
            }`}
          />

          <ConstellationSemanticOverlay
            plotData={plotData}
            clustersGeometry={clustersGeometry}
            spatialIndex={spatialIndex}
            cameraSnapshot={cameraSnapshot}
            viewportSize={viewportSize}
            lodWeights={lodWeights}
            selectedStarId={selectedStarId}
            selectedStar={selectedStar}
            hoveredStarId={hoveredStarId}
            hoveredStar={hoveredStar}
            activeClusterId={activeClusterId}
            matchingStarIds={matchingStarIds}
            worldToScreen={worldToScreen}
            screenToWorld={screenToWorld}
            onFocusCluster={focusOnCluster}
            onFocusStar={focusOnStar}
          />
        </div>

        <ConstellationHudBar
          totalBooks={plotData.length}
          totalConstellations={clustersGeometry.length}
          tierLabel={lodWeights.tierLabel}
          zoomDisplay={zoomDisplay}
          isHudCollapsed={isHudCollapsed}
          onToggleHudCollapsed={() => setIsHudCollapsed(prev => !prev)}
          onZoomStep={handleZoomStep}
          onResetView={handleResetView}
        />

        <ConstellationInspector
          isOpen={isDrawerOpen}
          onCloseDrawer={() => setIsDrawerOpen(false)}
          selectedStar={selectedStar}
          activeCluster={activeCluster}
          clustersGeometry={clustersGeometry}
          crossClusterBridges={crossClusterBridges}
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
