import {useRef, useState, useCallback, useMemo} from 'react';
import {ScatterPoint} from '../../hooks/useConstellationData';
import {Point2D} from '../../lib/clustering';
import {
  CameraState,
  ClusterGeometry,
  SemanticLodWeights,
  computeSemanticLod,
} from './types';

export interface CameraSnapshot {
  x: number;
  y: number;
  zoom: number;
}

export interface UseConstellationCameraParams {
  viewportSize: {width: number; height: number};
  plotData: ScatterPoint[];
  clusterById: Map<number, ClusterGeometry>;
  onSelectStar: (id: string | null) => void;
  onSelectCluster: (id: number | null) => void;
  onOpenDrawer?: () => void;
}

export function useConstellationCamera({
  viewportSize,
  plotData,
  clusterById,
  onSelectStar,
  onSelectCluster,
  onOpenDrawer,
}: UseConstellationCameraParams) {
  const cameraRef = useRef<CameraState>({
    x: 0,
    y: 0,
    zoom: 1,
    targetX: 0,
    targetY: 0,
    targetZoom: 1,
    vx: 0,
    vy: 0,
  });

  const [cameraSnapshot, setCameraSnapshot] = useState<CameraSnapshot>({
    x: 0,
    y: 0,
    zoom: 1,
  });

  const triggerRenderRef = useRef<() => void>(() => {});

  const zoomDisplay = Math.round(cameraSnapshot.zoom * 100);
  const lodWeights = useMemo<SemanticLodWeights>(
    () => computeSemanticLod(cameraSnapshot.zoom),
    [cameraSnapshot.zoom],
  );

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

  const focusOnStar = useCallback(
    (star: ScatterPoint, targetZoomLevel?: number) => {
      const id = star.id || star.book.id;
      onSelectStar(id);
      onSelectCluster(star.clusterId >= 0 ? star.clusterId : null);
      if (onOpenDrawer) {
        onOpenDrawer();
      }
      const nextZoom = Math.max(
        cameraRef.current.targetZoom,
        targetZoomLevel ?? 1.85,
      );

      cameraRef.current.vx = 0;
      cameraRef.current.vy = 0;
      cameraRef.current.targetX = star.x;
      cameraRef.current.targetY = star.y;
      cameraRef.current.targetZoom = nextZoom;
      triggerRenderRef.current();
    },
    [onSelectStar, onSelectCluster, onOpenDrawer],
  );

  const focusOnCluster = useCallback(
    (clusterId: number) => {
      const cluster = clusterById.get(clusterId);
      if (!cluster) {
        return;
      }
      onSelectStar(null);
      onSelectCluster(clusterId);
      if (onOpenDrawer) {
        onOpenDrawer();
      }

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const idx of cluster.pointIndices) {
        const pt = plotData[idx];
        if (!pt) {
          continue;
        }
        if (pt.x < minX) {
          minX = pt.x;
        }
        if (pt.x > maxX) {
          maxX = pt.x;
        }
        if (pt.y < minY) {
          minY = pt.y;
        }
        if (pt.y > maxY) {
          maxY = pt.y;
        }
      }

      const span = Math.max(26, maxX - minX, maxY - minY);
      const fitZoom = Math.max(1.35, Math.min(3.1, 130 / span));

      cameraRef.current.vx = 0;
      cameraRef.current.vy = 0;
      cameraRef.current.targetX = (minX + maxX) * 0.5;
      cameraRef.current.targetY = (minY + maxY) * 0.5;
      cameraRef.current.targetZoom = fitZoom;
      triggerRenderRef.current();
    },
    [clusterById, plotData, onSelectStar, onSelectCluster, onOpenDrawer],
  );

  const handleResetView = useCallback(() => {
    onSelectStar(null);
    onSelectCluster(null);
    cameraRef.current.vx = 0;
    cameraRef.current.vy = 0;
    cameraRef.current.targetX = 0;
    cameraRef.current.targetY = 0;
    cameraRef.current.targetZoom = 1;
    triggerRenderRef.current();
  }, [onSelectStar, onSelectCluster]);

  const handleZoomStep = useCallback((factor: number) => {
    const next = Math.max(
      0.55,
      Math.min(6.0, cameraRef.current.targetZoom * factor),
    );
    cameraRef.current.vx = 0;
    cameraRef.current.vy = 0;
    cameraRef.current.targetZoom = next;
    triggerRenderRef.current();
  }, []);

  /**
   * Zooms proportionally toward a specific screen point `(sx, sy)`,
   * keeping the world point beneath the cursor anchored in place.
   */
  const zoomAtScreenPoint = useCallback(
    (sx: number, sy: number, zoomMultiplier: number, immediate = false) => {
      const cam = cameraRef.current;
      const worldBefore = screenToWorld(
        sx,
        sy,
        cam,
        viewportSize.width,
        viewportSize.height,
      );

      const nextZoom = Math.max(
        0.55,
        Math.min(6.0, cam.targetZoom * zoomMultiplier),
      );
      const nextScale =
        getBaseScale(viewportSize.width, viewportSize.height) * nextZoom;

      cam.vx = 0;
      cam.vy = 0;
      cam.targetZoom = nextZoom;
      cam.targetX =
        worldBefore.x -
        (sx - viewportSize.width * 0.5) / Math.max(1e-6, nextScale);
      cam.targetY =
        worldBefore.y -
        (sy - viewportSize.height * 0.5) / Math.max(1e-6, nextScale);

      if (immediate) {
        cam.zoom = cam.targetZoom;
        cam.x = cam.targetX;
        cam.y = cam.targetY;
      }

      triggerRenderRef.current();
    },
    [viewportSize, screenToWorld, getBaseScale],
  );

  /**
   * Atomically solves simultaneous two-finger midpoint pan and focal-point pinch zoom
   * so the world point under `prevCenter` moves directly under `nextCenter` at the new scale.
   */
  const pinchAndPan = useCallback(
    (prevCenter: Point2D, nextCenter: Point2D, zoomRatio: number) => {
      const cam = cameraRef.current;
      const worldAnchor = screenToWorld(
        prevCenter.x,
        prevCenter.y,
        cam,
        viewportSize.width,
        viewportSize.height,
      );

      const nextZoom = Math.max(0.55, Math.min(6.0, cam.zoom * zoomRatio));
      const nextScale =
        getBaseScale(viewportSize.width, viewportSize.height) * nextZoom;

      const nextX = Math.max(
        -145,
        Math.min(
          145,
          worldAnchor.x -
            (nextCenter.x - viewportSize.width * 0.5) /
              Math.max(1e-6, nextScale),
        ),
      );
      const nextY = Math.max(
        -145,
        Math.min(
          145,
          worldAnchor.y -
            (nextCenter.y - viewportSize.height * 0.5) /
              Math.max(1e-6, nextScale),
        ),
      );

      cam.vx = 0;
      cam.vy = 0;
      cam.zoom = nextZoom;
      cam.targetZoom = nextZoom;
      cam.x = nextX;
      cam.targetX = nextX;
      cam.y = nextY;
      cam.targetY = nextY;

      triggerRenderRef.current();
    },
    [viewportSize, screenToWorld, getBaseScale],
  );

  /**
   * Advances inertial velocity and spring-damped target interpolation for one frame.
   */
  const stepCameraPhysics = useCallback((isDragging: boolean): boolean => {
    const cam = cameraRef.current;

    // Apply inertial glide when pointer is released
    if (!isDragging && (Math.abs(cam.vx) > 0.008 || Math.abs(cam.vy) > 0.008)) {
      cam.targetX += cam.vx;
      cam.targetY += cam.vy;
      cam.x = cam.targetX;
      cam.y = cam.targetY;
      cam.vx *= 0.88;
      cam.vy *= 0.88;
      if (Math.abs(cam.vx) <= 0.008) {
        cam.vx = 0;
      }
      if (Math.abs(cam.vy) <= 0.008) {
        cam.vy = 0;
      }
    }

    // Clamp world pan bounds so user never gets lost far outside the manifold
    cam.targetX = Math.max(-145, Math.min(145, cam.targetX));
    cam.targetY = Math.max(-145, Math.min(145, cam.targetY));

    const dx = cam.targetX - cam.x;
    const dy = cam.targetY - cam.y;
    const dz = cam.targetZoom - cam.zoom;

    const isInterpolating =
      Math.abs(dx) > 0.012 ||
      Math.abs(dy) > 0.012 ||
      Math.abs(dz) > 0.0012 ||
      Math.abs(cam.vx) > 0.008 ||
      Math.abs(cam.vy) > 0.008;

    if (isInterpolating) {
      cam.x += dx * 0.2;
      cam.y += dy * 0.2;
      cam.zoom += dz * 0.2;
    } else {
      cam.x = cam.targetX;
      cam.y = cam.targetY;
      cam.zoom = cam.targetZoom;
    }

    setCameraSnapshot(prev => {
      if (
        Math.abs(prev.x - cam.x) < 0.02 &&
        Math.abs(prev.y - cam.y) < 0.02 &&
        Math.abs(prev.zoom - cam.zoom) < 0.002
      ) {
        return prev;
      }
      return {x: cam.x, y: cam.y, zoom: cam.zoom};
    });

    return isInterpolating;
  }, []);

  return {
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
  };
}
