import {ScatterPoint} from '../../hooks/useConstellationData';
import {
  Point2D,
  CrossClusterBridge,
  SemanticWebEdge,
} from '../../lib/clustering';
import {
  CLUSTER_COLORS,
  ClusterGeometry,
  SemanticLodWeights,
  StippleGrain,
  hexToRgba,
  blendHexColors,
} from './types';

/**
 * Draws a smooth closed Catmull-Rom spline through polygon vertices on a 2D canvas.
 */
export function traceSmoothClosedHull(
  ctx: CanvasRenderingContext2D,
  pts: Point2D[],
  tension = 0.28,
) {
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

export interface RenderConstellationParams {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  dpr: number;
  isDark: boolean;
  cam: {x: number; y: number; zoom: number};
  lod?: SemanticLodWeights;
  skipCanvasLabels?: boolean;
  plotData: ScatterPoint[];
  clustersGeometry: ClusterGeometry[];
  crossClusterBridges?: CrossClusterBridge[];
  semanticWebEdges?: SemanticWebEdge[];
  paperStipples: StippleGrain[];
  selectedStarId: string | null;
  selectedStar: ScatterPoint | null;
  activeClusterId: number | null;
  hoveredStarId: string | null;
  matchingStarIds: Set<string> | null;
  starById: Map<string, {point: ScatterPoint; index: number}>;
  worldToScreen: (
    wx: number,
    wy: number,
    cam: {x: number; y: number; zoom: number},
    width: number,
    height: number,
  ) => Point2D;
  getBaseScale: (width: number, height: number) => number;
}

const OFFSCREEN_WORLD_SPAN = 165;
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

function worldToOffscreen(wx: number, wy: number): Point2D {
  const half = OFFSCREEN_SIZE_PX * 0.5;
  const scale = half / OFFSCREEN_WORLD_SPAN;
  return {
    x: half + wx * scale,
    y: half + wy * scale,
  };
}

function getOrBuildStaticWorldLayer(
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

export function renderConstellationFrame({
  ctx,
  width,
  height,
  dpr,
  isDark,
  cam,
  lod,
  skipCanvasLabels = false,
  plotData,
  clustersGeometry,
  crossClusterBridges = [],
  semanticWebEdges = [],
  paperStipples,
  selectedStarId,
  selectedStar,
  activeClusterId,
  hoveredStarId,
  matchingStarIds,
  starById,
  worldToScreen,
  getBaseScale,
}: RenderConstellationParams) {
  ctx.save();
  ctx.scale(dpr, dpr);

  // =======================================================================
  // LAYER 1: Warm Archival Parchment / Vellum Plate & Astrolabe Graticule
  // =======================================================================
  const bgGrad = ctx.createRadialGradient(
    width * 0.5,
    height * 0.5,
    Math.min(width, height) * 0.06,
    width * 0.5,
    height * 0.5,
    Math.max(width, height) * 0.78,
  );
  if (isDark) {
    bgGrad.addColorStop(0, '#211D19');
    bgGrad.addColorStop(0.6, '#181512');
    bgGrad.addColorStop(1, '#12100E');
  } else {
    bgGrad.addColorStop(0, '#FAF7F0');
    bgGrad.addColorStop(0.62, '#F3EDE0');
    bgGrad.addColorStop(1, '#E8DFCE');
  }
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, width, height);

  const originScreen = worldToScreen(0, 0, cam, width, height);
  const worldScale = getBaseScale(width, height) * cam.zoom;

  // Delicate engraved sepia/stone astrolabe rings
  ctx.strokeStyle = isDark
    ? 'rgba(214, 206, 190, 0.065)'
    : 'rgba(120, 108, 92, 0.12)';
  ctx.lineWidth = 1;
  for (const rWorld of [32, 64, 96, 128]) {
    ctx.beginPath();
    ctx.arc(
      originScreen.x,
      originScreen.y,
      rWorld * worldScale,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }

  // Subtle dashed intermediate ring
  ctx.save();
  ctx.setLineDash([3, 6]);
  ctx.strokeStyle = isDark
    ? 'rgba(214, 206, 190, 0.05)'
    : 'rgba(120, 108, 92, 0.1)';
  ctx.beginPath();
  ctx.arc(originScreen.x, originScreen.y, 48 * worldScale, 0, Math.PI * 2);
  ctx.arc(originScreen.x, originScreen.y, 80 * worldScale, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Cardinal meridian & equator lines
  ctx.strokeStyle = isDark
    ? 'rgba(214, 206, 190, 0.05)'
    : 'rgba(120, 108, 92, 0.09)';
  ctx.beginPath();
  ctx.moveTo(0, originScreen.y);
  ctx.lineTo(width, originScreen.y);
  ctx.moveTo(originScreen.x, 0);
  ctx.lineTo(originScreen.x, height);
  ctx.stroke();

  // Subtle paper stipple grain
  const parallaxCam = {
    x: cam.x * 0.25,
    y: cam.y * 0.25,
    zoom: 1 + (cam.zoom - 1) * 0.18,
  };
  for (const grain of paperStipples) {
    const sp = worldToScreen(grain.x, grain.y, parallaxCam, width, height);
    if (sp.x < -10 || sp.x > width + 10 || sp.y < -10 || sp.y > height + 10) {
      continue;
    }
    ctx.fillStyle = isDark
      ? `rgba(214, 206, 190, ${grain.alpha * 0.85})`
      : `rgba(120, 108, 92, ${grain.alpha})`;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, grain.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // Precompute screen coordinates for all book stars
  const screenPts: Point2D[] = plotData.map(p =>
    worldToScreen(p.x, p.y, cam, width, height),
  );

  const focusedClusterId =
    activeClusterId !== null
      ? activeClusterId
      : selectedStar
        ? selectedStar.clusterId
        : null;
  const hasSearchFilter = matchingStarIds !== null && matchingStarIds.size > 0;

  const selectedNeighborMap = new Map<string, number>();
  if (selectedStar) {
    for (const nb of selectedStar.neighbors) {
      selectedNeighborMap.set(nb.bookId, nb.similarity);
    }
  }

  // =======================================================================
  // LAYER 2 & 3: Offscreen-Cached Nebula Glow Fields & Semantic Web Filaments
  // =======================================================================
  const cachedWorldCanvas = getOrBuildStaticWorldLayer(
    plotData,
    clustersGeometry,
    semanticWebEdges,
    isDark,
    focusedClusterId,
  );

  if (cachedWorldCanvas && typeof ctx.drawImage === 'function') {
    const topLeft = worldToScreen(
      -OFFSCREEN_WORLD_SPAN,
      -OFFSCREEN_WORLD_SPAN,
      cam,
      width,
      height,
    );
    const bottomRight = worldToScreen(
      OFFSCREEN_WORLD_SPAN,
      OFFSCREEN_WORLD_SPAN,
      cam,
      width,
      height,
    );
    ctx.save();
    ctx.globalAlpha = lod ? lod.nebulaAlphaMultiplier : 1;
    ctx.drawImage(
      cachedWorldCanvas,
      topLeft.x,
      topLeft.y,
      bottomRight.x - topLeft.x,
      bottomRight.y - topLeft.y,
    );
    ctx.restore();
  } else {
    // Fallback direct rendering when offscreen 2D canvas is unavailable
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

    // Fallback Layer 3: Unified Semantic Web with Cross-Cluster Gradient Filaments
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
          ctx.lineWidth =
            focusedClusterId === edge.sourceClusterId ? 1.45 : 1.05;
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

  // =======================================================================
  // LAYER 3.5: Cross-Cluster Bridge Filaments (Unexpected Long-Range Links)
  // =======================================================================
  if (!selectedStar && crossClusterBridges.length > 0) {
    ctx.save();
    for (let bIdx = 0; bIdx < crossClusterBridges.length; bIdx++) {
      const bridge = crossClusterBridges[bIdx];
      const pStart = screenPts[bridge.sourceIndex];
      const pEnd = screenPts[bridge.targetIndex];
      const ptStart = plotData[bridge.sourceIndex];
      const ptEnd = plotData[bridge.targetIndex];
      if (!pStart || !pEnd || !ptStart || !ptEnd) {
        continue;
      }

      const idStart = ptStart.id || ptStart.book.id;
      const idEnd = ptEnd.id || ptEnd.book.id;
      const isHoveredBridge =
        hoveredStarId !== null &&
        (hoveredStarId === idStart || hoveredStarId === idEnd);
      const isClusterFocusedBridge =
        focusedClusterId !== null &&
        (bridge.sourceClusterId === focusedClusterId ||
          bridge.targetClusterId === focusedClusterId);

      if (
        focusedClusterId !== null &&
        !isClusterFocusedBridge &&
        !isHoveredBridge
      ) {
        continue;
      }

      const dx = pEnd.x - pStart.x;
      const dy = pEnd.y - pStart.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 8) {
        continue;
      }

      const nx = -dy / dist;
      const ny = dx / dist;
      const bendSign = bIdx % 2 === 0 ? 1 : -1;
      const arcOffset = Math.min(44, dist * 0.16) * bendSign;
      const ctrlX = (pStart.x + pEnd.x) * 0.5 + nx * arcOffset;
      const ctrlY = (pStart.y + pEnd.y) * 0.5 + ny * arcOffset;

      const bridgeAlpha = isHoveredBridge
        ? 0.68
        : isClusterFocusedBridge
          ? 0.44
          : 0.2;

      const colorStart =
        bridge.sourceClusterId >= 0
          ? CLUSTER_COLORS[bridge.sourceClusterId % CLUSTER_COLORS.length]
          : '#B45309';
      const colorEnd =
        bridge.targetClusterId >= 0
          ? CLUSTER_COLORS[bridge.targetClusterId % CLUSTER_COLORS.length]
          : '#9A3412';

      const bridgeGrad = ctx.createLinearGradient(
        pStart.x,
        pStart.y,
        pEnd.x,
        pEnd.y,
      );
      bridgeGrad.addColorStop(0, hexToRgba(colorStart, bridgeAlpha));
      bridgeGrad.addColorStop(1, hexToRgba(colorEnd, bridgeAlpha));

      ctx.setLineDash([4, 6]);
      ctx.strokeStyle = bridgeGrad;
      ctx.lineWidth = isHoveredBridge || isClusterFocusedBridge ? 1.35 : 1.0;
      ctx.beginPath();
      ctx.moveTo(pStart.x, pStart.y);
      ctx.quadraticCurveTo(ctrlX, ctrlY, pEnd.x, pEnd.y);
      ctx.stroke();

      if ((isHoveredBridge || isClusterFocusedBridge) && dist > 68) {
        const midX = 0.25 * pStart.x + 0.5 * ctrlX + 0.25 * pEnd.x;
        const midY = 0.25 * pStart.y + 0.5 * ctrlY + 0.25 * pEnd.y;
        const pctLabel = `${Math.round(bridge.similarity * 100)}%`;

        ctx.save();
        ctx.setLineDash([]);
        ctx.font = '600 9.5px "JetBrains Mono", monospace';
        const textW = ctx.measureText(pctLabel).width;
        const boxW = textW + 8;
        const boxH = 14;

        ctx.fillStyle = isDark
          ? 'rgba(28, 25, 23, 0.92)'
          : 'rgba(250, 247, 242, 0.94)';
        ctx.strokeStyle = isDark
          ? 'rgba(245, 158, 11, 0.48)'
          : 'rgba(180, 83, 9, 0.38)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(midX - boxW * 0.5, midY - boxH * 0.5, boxW, boxH, 3);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = isDark ? '#FDE68A' : '#9A3412';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pctLabel, midX, midY + 0.5);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  // =======================================================================
  // LAYER 4: Warm Terracotta & Brass Semantic Kinship Arcs
  // =======================================================================
  if (selectedStar) {
    const selectedEntry = starById.get(selectedStar.id || selectedStar.book.id);
    if (selectedEntry) {
      const pStart = screenPts[selectedEntry.index];

      for (let nIdx = 0; nIdx < selectedStar.neighbors.length; nIdx++) {
        const nb = selectedStar.neighbors[nIdx];
        const targetEntry = starById.get(nb.bookId);
        if (!targetEntry) {
          continue;
        }

        const pEnd = screenPts[targetEntry.index];
        const dx = pEnd.x - pStart.x;
        const dy = pEnd.y - pStart.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 2) {
          continue;
        }

        const nx = -dy / dist;
        const ny = dx / dist;
        const bendSign = nIdx % 2 === 0 ? 1 : -1;
        const arcOffset = Math.min(52, dist * 0.21) * bendSign;
        const ctrlX = (pStart.x + pEnd.x) * 0.5 + nx * arcOffset;
        const ctrlY = (pStart.y + pEnd.y) * 0.5 + ny * arcOffset;

        // Soft warm halo under arc
        ctx.save();
        ctx.strokeStyle = isDark
          ? 'rgba(217, 119, 6, 0.16)'
          : 'rgba(154, 52, 18, 0.12)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, pEnd.x, pEnd.y);
        ctx.stroke();

        // Engraved dashed terracotta / brass filament
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle =
          nIdx === 0
            ? isDark
              ? '#F59E0B'
              : '#9A3412'
            : isDark
              ? '#D97706'
              : '#854D0E';
        ctx.lineWidth = nIdx === 0 ? 1.75 : 1.3;
        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, pEnd.x, pEnd.y);
        ctx.stroke();
        ctx.restore();

        // Parchment-framed midpoint affinity badge
        if (dist > 64) {
          const midX = 0.25 * pStart.x + 0.5 * ctrlX + 0.25 * pEnd.x;
          const midY = 0.25 * pStart.y + 0.5 * ctrlY + 0.25 * pEnd.y;
          const pctLabel = `${Math.round(nb.similarity * 100)}%`;

          ctx.save();
          ctx.font = '600 10px "JetBrains Mono", monospace';
          const textW = ctx.measureText(pctLabel).width;
          const boxW = textW + 10;
          const boxH = 16;

          ctx.fillStyle = isDark
            ? 'rgba(28, 25, 23, 0.94)'
            : 'rgba(250, 247, 242, 0.95)';
          ctx.strokeStyle = isDark
            ? 'rgba(217, 119, 6, 0.55)'
            : 'rgba(154, 52, 18, 0.45)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.roundRect(midX - boxW * 0.5, midY - boxH * 0.5, boxW, boxH, 4);
          ctx.fill();
          ctx.stroke();

          ctx.fillStyle = isDark ? '#FDE68A' : '#9A3412';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(pctLabel, midX, midY + 0.5);
          ctx.restore();
        }
      }
    }
  }

  // =======================================================================
  // LAYER 5: Cartographic Star Nodes, Alpha Hub Hierarchy & Calipers
  // =======================================================================
  const anchorStarSet = new Set<number>();
  for (const cluster of clustersGeometry) {
    if (cluster.anchorIndices) {
      for (const aIdx of cluster.anchorIndices) {
        anchorStarSet.add(aIdx);
      }
    }
  }

  const defaultStarBase =
    plotData.length > 500 ? 2.6 : plotData.length > 200 ? 3.1 : 3.6;
  const starScaleMult = lod ? lod.starScaleMultiplier : 1;

  for (let i = 0; i < plotData.length; i++) {
    const pt = plotData[i];
    const sp = screenPts[i];
    if (sp.x < -30 || sp.x > width + 30 || sp.y < -30 || sp.y > height + 30) {
      continue;
    }

    const id = pt.id || pt.book.id;
    const isSelected = id === selectedStarId;
    const isHovered = id === hoveredStarId;
    const isNeighbor = selectedNeighborMap.has(id);
    const isSearchMatch = matchingStarIds ? matchingStarIds.has(id) : false;
    const isAlphaHub = anchorStarSet.has(i);

    const primaryColor =
      pt.clusterId >= 0
        ? CLUSTER_COLORS[pt.clusterId % CLUSTER_COLORS.length]
        : '#78716C';

    const hasSecondaryAffinity =
      typeof pt.secondaryClusterId === 'number' &&
      pt.secondaryClusterId >= 0 &&
      typeof pt.secondaryWeight === 'number' &&
      pt.secondaryWeight >= 0.14;

    const secondaryColor = hasSecondaryAffinity
      ? CLUSTER_COLORS[pt.secondaryClusterId! % CLUSTER_COLORS.length]
      : primaryColor;

    const baseColor = hasSecondaryAffinity
      ? blendHexColors(primaryColor, secondaryColor, pt.secondaryWeight!)
      : primaryColor;

    let alpha = 1;
    if (hasSearchFilter && !isSearchMatch && !isSelected) {
      alpha = 0.18;
    } else if (selectedStarId) {
      if (!isSelected && !isNeighbor && !isHovered) {
        alpha = pt.clusterId === selectedStar?.clusterId ? 0.52 : 0.22;
      }
    } else if (
      focusedClusterId !== null &&
      pt.clusterId !== focusedClusterId &&
      !isHovered
    ) {
      alpha =
        hasSecondaryAffinity && pt.secondaryClusterId === focusedClusterId
          ? 0.68
          : 0.22;
    }

    const rawRadius = isSelected
      ? 6.6
      : isHovered
        ? 5.8
        : isNeighbor || isSearchMatch
          ? 4.9
          : Math.max(
              2.4,
              Math.min(
                5.6,
                (defaultStarBase + (isAlphaHub ? 0.95 : 0)) *
                  Math.pow(cam.zoom, 0.25),
              ),
            );

    const coreRadius =
      isSelected || isHovered ? rawRadius : rawRadius * starScaleMult;

    // Soft warm pigment wash halo (dual-tone for transitional border books)
    const haloRadius =
      coreRadius * (isSelected || isHovered ? 3.8 : isAlphaHub ? 3.05 : 2.65);
    const glowGrad = ctx.createRadialGradient(
      sp.x,
      sp.y,
      coreRadius * 0.2,
      sp.x,
      sp.y,
      haloRadius,
    );
    glowGrad.addColorStop(
      0,
      hexToRgba(primaryColor, (isAlphaHub ? 0.42 : 0.36) * alpha),
    );
    glowGrad.addColorStop(
      0.55,
      hexToRgba(
        hasSecondaryAffinity ? secondaryColor : primaryColor,
        0.14 * alpha,
      ),
    );
    glowGrad.addColorStop(1, hexToRgba(secondaryColor, 0));
    ctx.fillStyle = glowGrad;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, haloRadius, 0, Math.PI * 2);
    ctx.fill();

    // Subtle Alpha Hub Star orbital ring & 4-point starlight ticks at Overview/Neighborhood zoom
    if (
      isAlphaHub &&
      !isSelected &&
      !isHovered &&
      alpha > 0.45 &&
      starScaleMult > 0.7
    ) {
      ctx.strokeStyle = hexToRgba(baseColor, 0.35 * alpha);
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius + 2.8, 0, Math.PI * 2);
      ctx.stroke();

      const tickLen = coreRadius + 5.2;
      ctx.strokeStyle = hexToRgba(baseColor, 0.42 * alpha);
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(sp.x - tickLen, sp.y);
      ctx.lineTo(sp.x + tickLen, sp.y);
      ctx.moveTo(sp.x, sp.y - tickLen);
      ctx.lineTo(sp.x, sp.y + tickLen);
      ctx.stroke();
    }

    // Search match ring
    if (isSearchMatch && !isSelected) {
      ctx.strokeStyle = isDark ? '#F59E0B' : '#B45309';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Neighbor kinship ring
    if (isNeighbor && !isSelected) {
      ctx.strokeStyle = isDark ? '#D97706' : '#9A3412';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Locked Selection Double-Ring Brass / Terracotta Caliper
    if (isSelected) {
      ctx.save();
      ctx.strokeStyle = isDark ? '#F59E0B' : '#9A3412';
      ctx.lineWidth = 1.75;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius + 5.5, 0, Math.PI * 2);
      ctx.stroke();

      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = isDark
        ? 'rgba(245, 158, 11, 0.65)'
        : 'rgba(154, 52, 18, 0.55)';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius + 10.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 4-Point Cartographic Compass Rosette on Hover / Selection
    if (isSelected || isHovered) {
      const spikeLen = isSelected ? 15 : 12;
      ctx.strokeStyle = isSelected
        ? isDark
          ? '#F59E0B'
          : '#9A3412'
        : hexToRgba(baseColor, 0.8);
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(sp.x - spikeLen, sp.y);
      ctx.lineTo(sp.x + spikeLen, sp.y);
      ctx.moveTo(sp.x, sp.y - spikeLen);
      ctx.lineTo(sp.x, sp.y + spikeLen);
      ctx.stroke();
    }

    // Warm Paper Collar Ring (separates star cleanly from web filaments)
    ctx.fillStyle = isDark
      ? `rgba(24, 21, 18, ${0.9 * alpha})`
      : `rgba(250, 247, 240, ${0.95 * alpha})`;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, coreRadius + 1.4, 0, Math.PI * 2);
    ctx.fill();

    // Mineral Pigment Star Core (blended for transitional border books)
    ctx.fillStyle = hexToRgba(baseColor, Math.min(1, alpha * 1.05));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    // Warm Cream Center Pinpoint
    if (alpha > 0.4) {
      ctx.fillStyle = isDark
        ? `rgba(250, 247, 242, ${0.85 * alpha})`
        : `rgba(255, 252, 245, ${0.9 * alpha})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // =======================================================================
  // LAYER 6: Semantic Zoom Typography (Skipped when DOM Overlay is active)
  // =======================================================================
  if (!skipCanvasLabels) {
    const placedBoxes: Array<{
      x1: number;
      y1: number;
      x2: number;
      y2: number;
    }> = [];

    const overlapsPlaced = (x1: number, y1: number, x2: number, y2: number) => {
      for (const b of placedBoxes) {
        if (x1 < b.x2 && x2 > b.x1 && y1 < b.y2 && y2 > b.y1) {
          return true;
        }
      }
      return false;
    };

    if (cam.zoom >= 0.95 && cam.zoom < 2.6) {
      const fadeIn = Math.min(1, (cam.zoom - 0.92) / 0.22);
      const fadeOut =
        cam.zoom > 2.15 ? Math.max(0, 1 - (cam.zoom - 2.15) / 0.45) : 1;
      const zoomEnvelope = fadeIn * fadeOut;

      ctx.save();
      ctx.font = '600 11.5px "Plus Jakarta Sans", "Manrope", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      for (const cluster of clustersGeometry) {
        const cScreen = worldToScreen(
          cluster.centroid.x,
          cluster.centroid.y,
          cam,
          width,
          height,
        );
        if (
          cScreen.x < 30 ||
          cScreen.x > width - 30 ||
          cScreen.y < 24 ||
          cScreen.y > height - 24
        ) {
          continue;
        }

        const isClusterActive =
          focusedClusterId === null || focusedClusterId === cluster.clusterId;
        const alpha =
          (isClusterActive ? 0.78 : 0.32) * Math.max(0.28, zoomEnvelope);

        const spacedTitle = cluster.name.toUpperCase().split('').join('\u200A');
        const textW = ctx.measureText(spacedTitle).width;
        const bx1 = cScreen.x - textW * 0.5 - 6;
        const by1 = cScreen.y - 10;
        const bx2 = cScreen.x + textW * 0.5 + 6;
        const by2 = cScreen.y + 10;

        if (overlapsPlaced(bx1, by1, bx2, by2)) {
          continue;
        }
        placedBoxes.push({x1: bx1, y1: by1, x2: bx2, y2: by2});

        ctx.strokeStyle = isDark
          ? `rgba(24, 21, 18, ${Math.min(0.88, alpha * 1.35)})`
          : `rgba(248, 244, 235, ${Math.min(0.94, alpha * 1.4)})`;
        ctx.lineWidth = 3.8;
        ctx.lineJoin = 'round';
        ctx.strokeText(spacedTitle, cScreen.x, cScreen.y);

        const labelColor = blendHexColors(
          cluster.color,
          isDark ? '#F5F0E6' : '#29231E',
          isDark ? 0.38 : 0.35,
        );
        ctx.fillStyle = hexToRgba(labelColor, Math.min(0.9, alpha * 1.15));
        ctx.fillText(spacedTitle, cScreen.x, cScreen.y);
      }
      ctx.restore();
    }

    const labelCandidates: number[] = [];
    for (let i = 0; i < plotData.length; i++) {
      const id = plotData[i].id || plotData[i].book.id;
      const isPriority =
        id === selectedStarId ||
        id === hoveredStarId ||
        (selectedStarId !== null && selectedNeighborMap.has(id)) ||
        (matchingStarIds ? matchingStarIds.has(id) : false);
      if (isPriority || cam.zoom >= 2.55) {
        labelCandidates.push(i);
      }
    }

    labelCandidates.sort((a, b) => {
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

    ctx.save();
    ctx.font = '600 11px "Manrope", sans-serif';
    for (const idx of labelCandidates) {
      const pt = plotData[idx];
      const sp = screenPts[idx];
      if (sp.x < 10 || sp.x > width - 10 || sp.y < 10 || sp.y > height - 10) {
        continue;
      }

      const id = pt.id || pt.book.id;
      const isSelected = id === selectedStarId;
      const isHovered = id === hoveredStarId;
      const isNeighbor = selectedNeighborMap.has(id);
      const isSearchMatch = matchingStarIds ? matchingStarIds.has(id) : false;

      const rawTitle = pt.book.title || 'Untitled';
      const truncated =
        rawTitle.length > 28 ? `${rawTitle.slice(0, 26)}…` : rawTitle;
      const textW = ctx.measureText(truncated).width;
      const lx1 = sp.x + 10;
      const ly1 = sp.y - 9.5;
      const lx2 = lx1 + textW + 12;
      const ly2 = ly1 + 19;

      if (
        !isSelected &&
        !isHovered &&
        overlapsPlaced(lx1 - 6, ly1 - 4, lx2 + 6, ly2 + 4)
      ) {
        continue;
      }
      placedBoxes.push({
        x1: lx1 - 6,
        y1: ly1 - 4,
        x2: lx2 + 6,
        y2: ly2 + 4,
      });

      ctx.fillStyle = isDark
        ? isSelected || isHovered
          ? 'rgba(28, 25, 23, 0.96)'
          : 'rgba(24, 21, 18, 0.88)'
        : isSelected || isHovered
          ? 'rgba(255, 255, 255, 0.96)'
          : 'rgba(250, 247, 242, 0.92)';

      ctx.strokeStyle = isSelected
        ? isDark
          ? 'rgba(245, 158, 11, 0.75)'
          : 'rgba(154, 52, 18, 0.65)'
        : isNeighbor
          ? isDark
            ? 'rgba(217, 119, 6, 0.55)'
            : 'rgba(133, 77, 14, 0.45)'
          : isSearchMatch
            ? 'rgba(180, 83, 9, 0.55)'
            : isDark
              ? 'rgba(214, 206, 190, 0.2)'
              : 'rgba(120, 108, 92, 0.28)';

      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(lx1, ly1, textW + 12, 19, 4);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = isDark
        ? '#F5F2EB'
        : isSelected || isHovered
          ? '#1C1917'
          : '#292524';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(truncated, lx1 + 6, sp.y + 0.5);
    }
    ctx.restore();
  }

  ctx.restore();
}
