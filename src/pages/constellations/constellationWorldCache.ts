import type {ScatterPoint} from '../../hooks/useConstellationData';
import type {Point2D, SemanticWebEdge} from '../../lib/clustering';
import {
  CLUSTER_COLORS,
  type ClusterGeometry,
  blendHexColors,
  hexToRgba,
} from './types';

export const OFFSCREEN_WORLD_SPAN = 165;
const OFFSCREEN_SIZE_PX = 1650;

interface StaticWorldLayerCache {
  canvas: HTMLCanvasElement;
  plotDataRef: ScatterPoint[];
  clustersRef: ClusterGeometry[];
  edgesRef: SemanticWebEdge[];
  isDark: boolean;
  focusedClusterId: number | null;
}

let staticWorldCache: StaticWorldLayerCache | null = null;

/**
 * Draws a smooth closed Catmull-Rom spline through polygon vertices on a 2D canvas.
 */
export function traceSmoothClosedHull(
  ctx: CanvasRenderingContext2D,
  pts: Point2D[],
  tension = 0.28,
): void {
  const n = pts.length;
  if (n < 3) {
    return;
  }

  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);

  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];

    const cp1x = p1.x + (p2.x - p0.x) * tension;
    const cp1y = p1.y + (p2.y - p0.y) * tension;
    const cp2x = p2.x - (p3.x - p1.x) * tension;
    const cp2y = p2.y - (p3.y - p1.y) * tension;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
  }

  ctx.closePath();
}

function worldToOffscreen(wx: number, wy: number): Point2D {
  const half = OFFSCREEN_SIZE_PX * 0.5;
  const scale = half / OFFSCREEN_WORLD_SPAN;
  return {
    x: half + wx * scale,
    y: half + wy * scale,
  };
}

export function getOrBuildStaticWorldLayer(
  plotData: ScatterPoint[],
  clustersGeometry: ClusterGeometry[],
  semanticWebEdges: SemanticWebEdge[],
  isDark: boolean,
  focusedClusterId: number | null,
): HTMLCanvasElement | null {
  if (typeof document === 'undefined') {
    return null;
  }

  if (
    staticWorldCache &&
    staticWorldCache.plotDataRef === plotData &&
    staticWorldCache.clustersRef === clustersGeometry &&
    staticWorldCache.edgesRef === semanticWebEdges &&
    staticWorldCache.isDark === isDark &&
    staticWorldCache.focusedClusterId === focusedClusterId
  ) {
    return staticWorldCache.canvas;
  }

  const offCanvas =
    staticWorldCache?.canvas ?? document.createElement('canvas');
  offCanvas.width = OFFSCREEN_SIZE_PX;
  offCanvas.height = OFFSCREEN_SIZE_PX;

  let offCtx: CanvasRenderingContext2D | null = null;
  try {
    offCtx = offCanvas.getContext('2d');
  } catch {
    return null;
  }
  if (!offCtx) {
    return null;
  }

  offCtx.clearRect(0, 0, OFFSCREEN_SIZE_PX, OFFSCREEN_SIZE_PX);
  const offScale = (OFFSCREEN_SIZE_PX * 0.5) / OFFSCREEN_WORLD_SPAN;

  // 1. Pre-render Multi-Kernel Nebula Glow Fields into offscreen world bitmap
  for (const cluster of clustersGeometry) {
    const isClusterActive =
      focusedClusterId === null || focusedClusterId === cluster.clusterId;

    const baseFillAlpha = isClusterActive
      ? focusedClusterId === cluster.clusterId
        ? isDark
          ? 0.21
          : 0.165
        : isDark
          ? 0.135
          : 0.105
      : 0.03;

    const kernels =
      cluster.nebulaKernels && cluster.nebulaKernels.length > 0
        ? cluster.nebulaKernels
        : [
            {
              x: cluster.centroid.x,
              y: cluster.centroid.y,
              radius: 28,
              weight: 1.0,
            },
          ];

    for (const kernel of kernels) {
      const kPos = worldToOffscreen(kernel.x, kernel.y);
      const rPx = Math.max(44, kernel.radius * offScale * 1.42);
      const kAlpha = baseFillAlpha * kernel.weight;

      const nebulaGrad = offCtx.createRadialGradient(
        kPos.x,
        kPos.y,
        rPx * 0.04,
        kPos.x,
        kPos.y,
        rPx,
      );
      nebulaGrad.addColorStop(0, hexToRgba(cluster.color, kAlpha * 1.18));
      nebulaGrad.addColorStop(0.38, hexToRgba(cluster.color, kAlpha * 0.74));
      nebulaGrad.addColorStop(0.72, hexToRgba(cluster.color, kAlpha * 0.28));
      nebulaGrad.addColorStop(1, hexToRgba(cluster.color, 0));

      offCtx.fillStyle = nebulaGrad;
      offCtx.beginPath();
      offCtx.arc(kPos.x, kPos.y, rPx, 0, Math.PI * 2);
      offCtx.fill();
    }
  }

  // 2. Pre-render Unified Semantic Web Filaments into offscreen world bitmap
  const offPts = plotData.map(p => worldToOffscreen(p.x, p.y));
  if (semanticWebEdges.length > 0) {
    for (const edge of semanticWebEdges) {
      const pu = offPts[edge.u];
      const pv = offPts[edge.v];
      if (!pu || !pv) {
        continue;
      }

      const touchesFocused =
        focusedClusterId === null ||
        edge.sourceClusterId === focusedClusterId ||
        edge.targetClusterId === focusedClusterId;

      const colorU =
        edge.sourceClusterId >= 0
          ? CLUSTER_COLORS[edge.sourceClusterId % CLUSTER_COLORS.length]
          : '#78716C';
      const colorV =
        edge.targetClusterId >= 0
          ? CLUSTER_COLORS[edge.targetClusterId % CLUSTER_COLORS.length]
          : '#78716C';

      if (!edge.isCrossCluster) {
        const intraAlpha = touchesFocused
          ? focusedClusterId === edge.sourceClusterId
            ? 0.56
            : 0.34
          : 0.075;

        offCtx.strokeStyle = hexToRgba(colorU, intraAlpha);
        offCtx.lineWidth =
          focusedClusterId === edge.sourceClusterId ? 2.1 : 1.5;
        offCtx.beginPath();
        offCtx.moveTo(pu.x, pu.y);
        offCtx.lineTo(pv.x, pv.y);
        offCtx.stroke();
      } else {
        const crossAlpha = touchesFocused
          ? focusedClusterId !== null
            ? 0.5
            : 0.3
          : 0.065;

        const grad = offCtx.createLinearGradient(pu.x, pu.y, pv.x, pv.y);
        grad.addColorStop(0, hexToRgba(colorU, crossAlpha));
        grad.addColorStop(
          0.5,
          hexToRgba(blendHexColors(colorU, colorV, 0.5), crossAlpha * 0.9),
        );
        grad.addColorStop(1, hexToRgba(colorV, crossAlpha));

        offCtx.strokeStyle = grad;
        offCtx.lineWidth =
          focusedClusterId !== null && touchesFocused ? 1.95 : 1.35;
        offCtx.beginPath();
        offCtx.moveTo(pu.x, pu.y);
        offCtx.lineTo(pv.x, pv.y);
        offCtx.stroke();
      }
    }
  } else {
    for (const cluster of clustersGeometry) {
      const isClusterActive =
        focusedClusterId === null || focusedClusterId === cluster.clusterId;

      const baseLineAlpha = isClusterActive
        ? focusedClusterId === cluster.clusterId
          ? 0.58
          : 0.36
        : 0.08;

      offCtx.strokeStyle = hexToRgba(cluster.color, baseLineAlpha);
      offCtx.lineWidth = focusedClusterId === cluster.clusterId ? 2.2 : 1.6;

      offCtx.beginPath();
      for (const [uIdx, vIdx] of cluster.mstEdges) {
        const pu = offPts[uIdx];
        const pv = offPts[vIdx];
        if (!pu || !pv) {
          continue;
        }
        offCtx.moveTo(pu.x, pu.y);
        offCtx.lineTo(pv.x, pv.y);
      }
      offCtx.stroke();
    }
  }

  staticWorldCache = {
    canvas: offCanvas,
    plotDataRef: plotData,
    clustersRef: clustersGeometry,
    edgesRef: semanticWebEdges,
    isDark,
    focusedClusterId,
  };

  return offCanvas;
}

export function renderDirectNebulaAndWebFallback(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  isDark: boolean;
  cam: {x: number; y: number; zoom: number};
  worldScale: number;
  focusedClusterId: number | null;
  clustersGeometry: ClusterGeometry[];
  semanticWebEdges: SemanticWebEdge[];
  screenPts: Point2D[];
  worldToScreen: (
    wx: number,
    wy: number,
    cam: {x: number; y: number; zoom: number},
    width: number,
    height: number,
  ) => Point2D;
}): void {
  const {
    ctx,
    width,
    height,
    isDark,
    cam,
    worldScale,
    focusedClusterId,
    clustersGeometry,
    semanticWebEdges,
    screenPts,
    worldToScreen,
  } = params;

  for (const cluster of clustersGeometry) {
    const isClusterActive =
      focusedClusterId === null || focusedClusterId === cluster.clusterId;

    const baseFillAlpha = isClusterActive
      ? focusedClusterId === cluster.clusterId
        ? isDark
          ? 0.19
          : 0.15
        : isDark
          ? 0.12
          : 0.095
      : 0.025;

    const kernels =
      cluster.nebulaKernels && cluster.nebulaKernels.length > 0
        ? cluster.nebulaKernels
        : [
            {
              x: cluster.centroid.x,
              y: cluster.centroid.y,
              radius: 28,
              weight: 1.0,
            },
          ];

    for (const kernel of kernels) {
      const kScreen = worldToScreen(kernel.x, kernel.y, cam, width, height);
      const rScreen = Math.max(42, kernel.radius * worldScale * 1.42);

      if (
        kScreen.x + rScreen < 0 ||
        kScreen.x - rScreen > width ||
        kScreen.y + rScreen < 0 ||
        kScreen.y - rScreen > height
      ) {
        continue;
      }

      const kAlpha = baseFillAlpha * kernel.weight;
      const nebulaGrad = ctx.createRadialGradient(
        kScreen.x,
        kScreen.y,
        rScreen * 0.04,
        kScreen.x,
        kScreen.y,
        rScreen,
      );
      nebulaGrad.addColorStop(0, hexToRgba(cluster.color, kAlpha * 1.15));
      nebulaGrad.addColorStop(0.38, hexToRgba(cluster.color, kAlpha * 0.72));
      nebulaGrad.addColorStop(0.72, hexToRgba(cluster.color, kAlpha * 0.26));
      nebulaGrad.addColorStop(1, hexToRgba(cluster.color, 0));

      ctx.fillStyle = nebulaGrad;
      ctx.beginPath();
      ctx.arc(kScreen.x, kScreen.y, rScreen, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (semanticWebEdges.length > 0) {
    for (const edge of semanticWebEdges) {
      const pu = screenPts[edge.u];
      const pv = screenPts[edge.v];
      if (!pu || !pv) {
        continue;
      }

      const touchesFocused =
        focusedClusterId === null ||
        edge.sourceClusterId === focusedClusterId ||
        edge.targetClusterId === focusedClusterId;

      const colorU =
        edge.sourceClusterId >= 0
          ? CLUSTER_COLORS[edge.sourceClusterId % CLUSTER_COLORS.length]
          : '#78716C';
      const colorV =
        edge.targetClusterId >= 0
          ? CLUSTER_COLORS[edge.targetClusterId % CLUSTER_COLORS.length]
          : '#78716C';

      if (!edge.isCrossCluster) {
        const intraAlpha = touchesFocused
          ? focusedClusterId === edge.sourceClusterId
            ? 0.54
            : 0.32
          : 0.07;

        ctx.strokeStyle = hexToRgba(colorU, intraAlpha);
        ctx.lineWidth = focusedClusterId === edge.sourceClusterId ? 1.45 : 1.05;
        ctx.beginPath();
        ctx.moveTo(pu.x, pu.y);
        ctx.lineTo(pv.x, pv.y);
        ctx.stroke();
      } else {
        const crossAlpha = touchesFocused
          ? focusedClusterId !== null
            ? 0.48
            : 0.28
          : 0.06;

        const grad = ctx.createLinearGradient(pu.x, pu.y, pv.x, pv.y);
        grad.addColorStop(0, hexToRgba(colorU, crossAlpha));
        grad.addColorStop(
          0.5,
          hexToRgba(blendHexColors(colorU, colorV, 0.5), crossAlpha * 0.9),
        );
        grad.addColorStop(1, hexToRgba(colorV, crossAlpha));

        ctx.strokeStyle = grad;
        ctx.lineWidth =
          focusedClusterId !== null && touchesFocused ? 1.35 : 0.95;
        ctx.beginPath();
        ctx.moveTo(pu.x, pu.y);
        ctx.lineTo(pv.x, pv.y);
        ctx.stroke();
      }
    }
  } else {
    for (const cluster of clustersGeometry) {
      const isClusterActive =
        focusedClusterId === null || focusedClusterId === cluster.clusterId;

      const baseLineAlpha = isClusterActive
        ? focusedClusterId === cluster.clusterId
          ? 0.58
          : 0.36
        : 0.08;

      ctx.strokeStyle = hexToRgba(cluster.color, baseLineAlpha);
      ctx.lineWidth = focusedClusterId === cluster.clusterId ? 1.55 : 1.15;

      ctx.beginPath();
      for (const [uIdx, vIdx] of cluster.mstEdges) {
        const pu = screenPts[uIdx];
        const pv = screenPts[vIdx];
        if (!pu || !pv) {
          continue;
        }
        ctx.moveTo(pu.x, pu.y);
        ctx.lineTo(pv.x, pv.y);
      }
      ctx.stroke();
    }
  }
}
