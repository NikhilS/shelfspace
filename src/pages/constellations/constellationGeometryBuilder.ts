import type {ScatterPoint} from '../../hooks/useConstellationData';
import {
  type Point2D,
  type SemanticNeighborIndex,
  type SemanticWebEdge,
  computeClusterMST,
  computePaddedConvexHull,
  computeUnifiedSemanticWeb,
  createSeededRng,
} from '../../lib/clustering';
import {
  CLUSTER_COLORS,
  type ClusterGeometry,
  type NebulaKernel,
  type StippleGrain,
} from './types';

export function buildPaperStipples(seed = 90210): StippleGrain[] {
  const rng = createSeededRng(seed);
  return Array.from({length: 140}, () => ({
    x: (rng() - 0.5) * 320,
    y: (rng() - 0.5) * 320,
    radius: 0.6 + rng() * 1.1,
    alpha: 0.08 + rng() * 0.16,
  }));
}

export function buildStarByIdMap(
  plotData: ScatterPoint[],
): Map<string, {point: ScatterPoint; index: number}> {
  const map = new Map<string, {point: ScatterPoint; index: number}>();
  plotData.forEach((point, index) => {
    const id = point.id || point.book.id;
    map.set(id, {point, index});
  });
  return map;
}

export function buildClustersGeometry(
  plotData: ScatterPoint[],
  clusterNames: Record<number, string>,
  clusterTheses: Record<number, string>,
): ClusterGeometry[] {
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
        const bucketIdx = Math.min(2, Math.floor((angle / (Math.PI * 2)) * 3));
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
}

export function buildConstellationSemanticWebEdges(
  plotData: ScatterPoint[],
  starById: Map<string, {point: ScatterPoint; index: number}>,
  propSemanticWebEdges?: SemanticWebEdge[],
): SemanticWebEdge[] {
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
}
