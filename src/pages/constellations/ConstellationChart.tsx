import React, {useMemo, useState, useRef, useEffect, useCallback} from 'react';
import {useParams} from 'react-router-dom';
import {ZoomIn, ZoomOut, Maximize2, ChevronDown, ChevronUp} from 'lucide-react';
import {ScatterPoint} from '../../hooks/useConstellationData';
import {
  Point2D,
  SemanticNeighborIndex,
  computeClusterMST,
  computePaddedConvexHull,
  computeUnifiedSemanticWeb,
  createSeededRng,
} from '../../lib/clustering';
import {MonographCoverFallback} from '../../components/book/MonographCoverFallback';
import {
  CLUSTER_COLORS,
  ClusterGeometry,
  NebulaKernel,
  StippleGrain,
  ConstellationChartProps,
} from './types';
import {SpatialGridIndex} from './spatialIndex';
import {useConstellationCamera} from './useConstellationCamera';
import {renderConstellationFrame} from './ConstellationCanvasRenderer';
import {ConstellationToolbar} from './ConstellationToolbar';
import {ConstellationInspector} from './ConstellationInspector';

export {CLUSTER_COLORS} from './types';

interface PlacedRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

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

  // Precompute Cluster Geometry (Centroids, Multi-Kernel Nebulae, Anchor Books, MST, Dominant Genres)
  const clustersGeometry = useMemo<ClusterGeometry[]>(() => {
    const grouped = new Map<number, number[]>();
    const allWorldPoints: Point2D[] = plotData.map(p => ({x: p.x, y: p.y}));

    plotData.forEach((p, idx) => {
      if (p.clusterId < 0) {
        return;
      }
      const list = grouped.get(p.clusterId) || [];
      list.push(idx);
      grouped.set(p.clusterId, list);
    });

    const result: ClusterGeometry[] = [];
    const sortedClusterIds = Array.from(grouped.keys()).sort((a, b) => a - b);

    for (const cid of sortedClusterIds) {
      const indices = grouped.get(cid) || [];
      if (indices.length === 0) {
        continue;
      }

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

      // Identify up to 3 core anchor books closest to the cluster centroid for Tier 2 Neighborhood labels
      const anchorIndices = [...indices]
        .sort((a, b) => {
          const da = Math.hypot(
            allWorldPoints[a].x - centroid.x,
            allWorldPoints[a].y - centroid.y,
          );
          const db = Math.hypot(
            allWorldPoints[b].x - centroid.x,
            allWorldPoints[b].y - centroid.y,
          );
          return da - db;
        })
        .slice(0, 3);

      let sqDistSum = 0;
      for (const pt of clusterPts) {
        const d = Math.hypot(pt.x - centroid.x, pt.y - centroid.y);
        sqDistSum += d * d;
      }
      const rmsSpread = Math.sqrt(sqDistSum / Math.max(1, clusterPts.length));
      const baseRadius = Math.max(18, Math.min(48, rmsSpread * 1.65 + 10));

      const nebulaKernels: NebulaKernel[] = [
        {
          x: centroid.x,
          y: centroid.y,
          radius: baseRadius,
          weight: 1.0,
        },
      ];

      if (clusterPts.length >= 4) {
        const sectorBuckets: Point2D[][] = [[], [], []];
        for (const pt of clusterPts) {
          const dx = pt.x - centroid.x;
          const dy = pt.y - centroid.y;
          if (Math.hypot(dx, dy) < 3) {
            continue;
          }
          const angle = Math.atan2(dy, dx) + Math.PI;
          const bucketIdx = Math.min(
            2,
            Math.floor((angle / (Math.PI * 2)) * 3),
          );
          sectorBuckets[bucketIdx].push(pt);
        }

        for (const bucket of sectorBuckets) {
          if (bucket.length === 0) {
            continue;
          }
          let bx = 0;
          let by = 0;
          for (const bp of bucket) {
            bx += bp.x;
            by += bp.y;
          }
          bx /= bucket.length;
          by /= bucket.length;
          let maxBucketD = 10;
          for (const bp of bucket) {
            const d = Math.hypot(bp.x - bx, bp.y - by);
            if (d > maxBucketD) {
              maxBucketD = d;
            }
          }
          nebulaKernels.push({
            x: bx,
            y: by,
            radius: Math.max(14, Math.min(38, maxBucketD * 1.35 + 8)),
            weight: Math.min(0.85, 0.45 + bucket.length / clusterPts.length),
          });
        }
      }

      const mstEdges = computeClusterMST(allWorldPoints, indices);
      const hullPoints = computePaddedConvexHull(clusterPts, 6.2);
      const dominantGenres = Array.from(genreCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([g]) => g);

      result.push({
        clusterId: cid,
        name: clusterNames[cid] || `Constellation ${cid + 1}`,
        thesis: clusterTheses[cid],
        color: CLUSTER_COLORS[cid % CLUSTER_COLORS.length],
        centroid,
        pointIndices: indices,
        mstEdges,
        hullPoints,
        nebulaKernels,
        dominantGenres,
        anchorIndices,
      });
    }

    return result;
  }, [plotData, clusterNames, clusterTheses]);

  // O(1) 2D Spatial Grid Index for star hit-testing and viewport frustum queries
  const spatialIndex = useMemo(
    () => new SpatialGridIndex(plotData, clustersGeometry, 16),
    [plotData, clustersGeometry],
  );

  // Precompute Unified Semantic Web across all constellations
  const semanticWebEdges = useMemo(() => {
    if (propSemanticWebEdges && propSemanticWebEdges.length > 0) {
      return propSemanticWebEdges;
    }
    const allWorldPoints: Point2D[] = plotData.map(p => ({x: p.x, y: p.y}));
    const clusterIds = plotData.map(p => p.clusterId);
    const neighborIndexLists: SemanticNeighborIndex[][] = plotData.map(p =>
      (p.neighbors || [])
        .map(nb => {
          const target = starById.get(nb.bookId);
          if (!target) {
            return null;
          }
          return {
            index: target.index,
            similarity: nb.similarity,
          };
        })
        .filter((item): item is SemanticNeighborIndex => item !== null),
    );
    return computeUnifiedSemanticWeb(
      allWorldPoints,
      clusterIds,
      neighborIndexLists,
    );
  }, [plotData, starById, propSemanticWebEdges]);

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

  // Search filter matching book IDs
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

  // Pointer & Inertial Drag State
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

  // Track viewport size with ResizeObserver
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

  // Main On-Demand Offscreen-Cached 2D Canvas Render Loop & Inertial Physics Stepper
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

  // O(1) Spatial Grid Hit-Testing for stars at screen coordinates
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

  // Pointer & Multi-Touch Handlers with Inertial Velocity Tracking
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

    // 2-Finger Pinch-to-Zoom + Midpoint Pan (Atomic Focal Solver)
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

    // 1-Finger / Mouse Pan with Inertial Velocity Tracking
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

      // Exponential moving average of drag velocity for smooth release inertia
      cameraRef.current.vx = cameraRef.current.vx * 0.45 + worldDx * 0.55;
      cameraRef.current.vy = cameraRef.current.vy * 0.45 + worldDy * 0.55;

      triggerRenderRef.current();
      return;
    }

    // O(1) Hover Hit-Testing
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

    // Deliberate click/tap vs inertial drag release
    if (ps.movedDistance < 7 && rect) {
      cameraRef.current.vx = 0;
      cameraRef.current.vy = 0;

      // Check for touch double-tap focal zoom
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
      } else {
        if (selectedStarId) {
          setSelectedStarId(null);
        } else if (activeClusterId !== null) {
          setActiveClusterId(null);
        } else if (isDrawerOpen && viewportSize.width >= 1024) {
          setIsDrawerOpen(false);
        }
      }
    } else {
      // Kick off inertial momentum glide
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

  // Proportional cursor-centered wheel & trackpad pinch listener
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

      // Proportional exponential zoom sensitivity (finer for trackpad pinch where ctrlKey is true)
      const sensitivity = e.ctrlKey ? 0.0085 : 0.0022;
      const clampedDelta = Math.max(-160, Math.min(160, e.deltaY));
      const zoomMultiplier = Math.exp(-clampedDelta * sensitivity);

      zoomAtScreenPoint(sx, sy, zoomMultiplier);
    };

    canvas.addEventListener('wheel', onWheel, {passive: false});
    return () => canvas.removeEventListener('wheel', onWheel);
  }, [zoomAtScreenPoint]);

  // =======================================================================
  // Synchronized DOM Semantic Overlay (Tier 1 Banners, Tier 2 Titles, Tier 3 Book Covers)
  // =======================================================================
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

  // Tier 1: Clickable Cartographic Constellation Territory Banners
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

  // Tier 2: Collision-Resolved Neighborhood Book Title Callouts & Priority Labels
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

      // In Tier 3, non-selected stars render as miniature book covers instead of text pills
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

  // Tier 3: Reading Room Miniature Book Cover Plates (zoom >= 2.45x)
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

      {/* Map Stage + Responsive Below-Map Controls & Inspector on Smaller Screens (< 1024px) */}
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

          {/* Synchronized Semantic DOM Layer (Tier 1 Banners, Tier 2 Titles, Tier 3 Miniature Book Covers) */}
          <div
            aria-label="Constellation Map Semantic Overlay"
            className="absolute inset-0 pointer-events-none overflow-hidden z-10"
          >
            {/* TIER 1: Clickable Cartographic Constellation Territory Banners */}
            {visibleClusterBanners.map(
              ({cluster, x, y, isFocused, opacity}) => (
                <button
                  key={`banner-${cluster.clusterId}`}
                  type="button"
                  onClick={() => focusOnCluster(cluster.clusterId)}
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
              ),
            )}

            {/* TIER 2: Neighborhood Book Title Callouts & Kinship Affinity Percentages */}
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
                  onClick={() => focusOnStar(star)}
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

            {/* TIER 3: Reading Room Miniature Book Cover Plates */}
            {visibleBookCoverPlates.map(
              ({star, id, x, y, color, isSelected, isNeighbor}) => (
                <button
                  key={`cover-${id}`}
                  type="button"
                  onClick={() => focusOnStar(star)}
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

          {/* Bottom-Left Warm Archival Hover Preview Card (Desktop only) */}
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
        </div>

        {/* Camera & Semantic LOD Control Bar (Below map on smaller screens, floating bottom-center on lg:) */}
        <div className="w-full lg:w-auto lg:absolute lg:bottom-3 lg:left-1/2 lg:-translate-x-1/2 z-20 flex flex-wrap items-center justify-between lg:justify-center gap-2 lg:gap-1.5 px-3 py-2 lg:px-2.5 lg:py-1.5 rounded-xl bg-surface border border-outline-variant/80 text-on-surface shadow-xs lg:shadow-sm">
          {!isHudCollapsed && (
            <div className="flex items-center gap-1.5 sm:gap-2 lg:pr-2 lg:border-r border-outline-variant/60 text-xs text-on-surface-variant">
              <span className="font-mono tabular-nums font-semibold text-on-surface">
                {plotData.length} books
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {clustersGeometry.length} constellations
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-sans font-medium text-primary">
                {lodWeights.tierLabel}
              </span>
            </div>
          )}

          <div className="flex items-center gap-1.5 ml-auto lg:ml-0">
            <button
              type="button"
              onClick={() => handleZoomStep(0.78)}
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
              onClick={() => handleZoomStep(1.28)}
              title="Zoom in"
              aria-label="Zoom in"
              className="p-2 lg:p-1.5 rounded-lg hover:bg-surface-container text-on-surface transition-colors"
            >
              <ZoomIn className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleResetView}
              title="Fit all constellations"
              aria-label="Fit all constellations"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-surface-container hover:bg-surface-container-high text-on-surface border border-outline-variant/50 text-xs font-medium whitespace-nowrap shrink-0 transition-colors"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>Fit Atlas</span>
            </button>

            <button
              type="button"
              onClick={() => setIsHudCollapsed(prev => !prev)}
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

        {/* Curatorial Inspector (Full-width panel below map on < 1024px, slide-over drawer on lg:) */}
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
