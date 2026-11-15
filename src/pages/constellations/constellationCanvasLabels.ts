import type {ScatterPoint} from '../../hooks/useConstellationData';
import type {Point2D} from '../../lib/clustering';
import {type ClusterGeometry, blendHexColors, hexToRgba} from './types';

export function renderSemanticCanvasLabels(params: {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  isDark: boolean;
  cam: {x: number; y: number; zoom: number};
  plotData: ScatterPoint[];
  clustersGeometry: ClusterGeometry[];
  screenPts: Point2D[];
  focusedClusterId: number | null;
  selectedStarId: string | null;
  hoveredStarId: string | null;
  selectedNeighborMap: Map<string, number>;
  matchingStarIds: Set<string> | null;
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
    plotData,
    clustersGeometry,
    screenPts,
    focusedClusterId,
    selectedStarId,
    hoveredStarId,
    selectedNeighborMap,
    matchingStarIds,
    worldToScreen,
  } = params;

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
