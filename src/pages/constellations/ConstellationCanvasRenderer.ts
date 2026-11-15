import type {ScatterPoint} from '../../hooks/useConstellationData';
import type {
  CrossClusterBridge,
  Point2D,
  SemanticWebEdge,
} from '../../lib/clustering';
import {renderSemanticCanvasLabels} from './constellationCanvasLabels';
import {
  OFFSCREEN_WORLD_SPAN,
  getOrBuildStaticWorldLayer,
  renderDirectNebulaAndWebFallback,
  traceSmoothClosedHull,
} from './constellationWorldCache';
import {
  CLUSTER_COLORS,
  type ClusterGeometry,
  type SemanticLodWeights,
  type StippleGrain,
  blendHexColors,
  hexToRgba,
} from './types';

export {traceSmoothClosedHull};

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
}: RenderConstellationParams): void {
  ctx.save();
  ctx.scale(dpr, dpr);

  // LAYER 1: Warm Archival Parchment / Vellum Plate & Astrolabe Graticule
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

  ctx.strokeStyle = isDark
    ? 'rgba(214, 206, 190, 0.05)'
    : 'rgba(120, 108, 92, 0.09)';
  ctx.beginPath();
  ctx.moveTo(0, originScreen.y);
  ctx.lineTo(width, originScreen.y);
  ctx.moveTo(originScreen.x, 0);
  ctx.lineTo(originScreen.x, height);
  ctx.stroke();

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

  // LAYER 2 & 3: Offscreen-Cached Nebula Glow Fields & Semantic Web Filaments
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
    renderDirectNebulaAndWebFallback({
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
    });
  }

  // LAYER 3.5: Cross-Cluster Bridge Filaments
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

  // LAYER 4: Warm Terracotta & Brass Semantic Kinship Arcs
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

        ctx.save();
        ctx.strokeStyle = isDark
          ? 'rgba(217, 119, 6, 0.16)'
          : 'rgba(154, 52, 18, 0.12)';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(pStart.x, pStart.y);
        ctx.quadraticCurveTo(ctrlX, ctrlY, pEnd.x, pEnd.y);
        ctx.stroke();

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

  // LAYER 5: Cartographic Star Nodes, Alpha Hub Hierarchy & Calipers
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

    if (isSearchMatch && !isSelected) {
      ctx.strokeStyle = isDark ? '#F59E0B' : '#B45309';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius + 5, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (isNeighbor && !isSelected) {
      ctx.strokeStyle = isDark ? '#D97706' : '#9A3412';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius + 4, 0, Math.PI * 2);
      ctx.stroke();
    }

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

    ctx.fillStyle = isDark
      ? `rgba(24, 21, 18, ${0.9 * alpha})`
      : `rgba(250, 247, 240, ${0.95 * alpha})`;
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, coreRadius + 1.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hexToRgba(baseColor, Math.min(1, alpha * 1.05));
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    if (alpha > 0.4) {
      ctx.fillStyle = isDark
        ? `rgba(250, 247, 242, ${0.85 * alpha})`
        : `rgba(255, 252, 245, ${0.9 * alpha})`;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, coreRadius * 0.38, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // LAYER 6: Semantic Zoom Typography (Skipped when DOM Overlay is active)
  if (!skipCanvasLabels) {
    renderSemanticCanvasLabels({
      ctx,
      width,
      height,
      isDark,
      cam,
      plotData,
      clustersGeometry,
      screenPts,
      focusedClusterId,
      selectedStarId,
      hoveredStarId,
      selectedNeighborMap,
      matchingStarIds,
      worldToScreen,
    });
  }

  ctx.restore();
}
