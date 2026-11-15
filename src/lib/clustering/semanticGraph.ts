import type {
  CrossClusterBridge,
  Point2D,
  SemanticNeighborIndex,
  SemanticWebEdge,
} from './types';

/**
 * Computes a unified semantic web across the entire library:
 * 1. Builds a global Minimum Spanning Tree (Prim's algorithm) weighted by hybrid 2D manifold
 *    distance and semantic similarity so the constellation skeleton flows continuously across
 *    touching cluster boundaries.
 * 2. Augments the global backbone with high-affinity local neighborhood filaments (bounded degree)
 *    so clusters feel like an interconnected organic mesh rather than isolated stick figures.
 */
export function computeUnifiedSemanticWeb(
  points: Point2D[],
  clusterIds: number[],
  neighborIndexLists?: SemanticNeighborIndex[][],
): SemanticWebEdge[] {
  const n = points.length;
  if (n < 2) {
    return [];
  }

  const simLookup = new Map<string, number>();
  if (neighborIndexLists && neighborIndexLists.length === n) {
    for (let u = 0; u < n; u++) {
      const list = neighborIndexLists[u] || [];
      for (const nb of list) {
        const minIdx = Math.min(u, nb.index);
        const maxIdx = Math.max(u, nb.index);
        const key = `${minIdx}:${maxIdx}`;
        const prev = simLookup.get(key) || 0;
        if (nb.similarity > prev) {
          simLookup.set(key, nb.similarity);
        }
      }
    }
  }

  const visited = new Array<boolean>(n).fill(false);
  const minWeight = new Array<number>(n).fill(Infinity);
  const parent = new Array<number>(n).fill(-1);
  minWeight[0] = 0;

  const rawMstEdges: Array<{
    u: number;
    v: number;
    dist2D: number;
    sim: number;
  }> = [];

  for (let step = 0; step < n; step++) {
    let u = -1;
    let bestW = Infinity;
    for (let i = 0; i < n; i++) {
      if (!visited[i] && minWeight[i] < bestW) {
        bestW = minWeight[i];
        u = i;
      }
    }
    if (u === -1) {
      break;
    }
    visited[u] = true;

    if (parent[u] !== -1) {
      const p = parent[u];
      const dist2D = Math.hypot(
        points[p].x - points[u].x,
        points[p].y - points[u].y,
      );
      const key = `${Math.min(p, u)}:${Math.max(p, u)}`;
      const sim = simLookup.get(key) ?? Math.max(0.45, 1 - dist2D / 140);
      rawMstEdges.push({u: p, v: u, dist2D, sim});
    }

    const pu = points[u];
    const cu = clusterIds[u] ?? -1;
    for (let v = 0; v < n; v++) {
      if (!visited[v]) {
        const pv = points[v];
        const dist2D = Math.hypot(pu.x - pv.x, pu.y - pv.y);
        const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
        const sim = simLookup.get(key) || 0;
        const cv = clusterIds[v] ?? -1;
        const crossPenalty = cu !== cv ? 1.12 : 1.0;
        const simDiscount = sim > 0 ? 1 - sim * 0.28 : 1.0;
        const weight = dist2D * crossPenalty * simDiscount;
        if (weight < minWeight[v]) {
          minWeight[v] = weight;
          parent[v] = u;
        }
      }
    }
  }

  const sortedDists = rawMstEdges.map(e => e.dist2D).sort((a, b) => a - b);
  const medianDist = sortedDists[Math.floor(sortedDists.length * 0.5)] || 6;
  const maxAllowedMstDist = Math.max(40, medianDist * 2.8);

  const webEdges: SemanticWebEdge[] = [];
  const edgeSet = new Set<string>();
  const meshDegree = new Int32Array(n);

  for (let idx = 0; idx < rawMstEdges.length; idx++) {
    const e = rawMstEdges[idx];
    if (rawMstEdges.length >= 5 && idx > 0 && e.dist2D > maxAllowedMstDist) {
      continue;
    }
    const minIdx = Math.min(e.u, e.v);
    const maxIdx = Math.max(e.u, e.v);
    const key = `${minIdx}:${maxIdx}`;
    edgeSet.add(key);

    const cu = clusterIds[minIdx] ?? -1;
    const cv = clusterIds[maxIdx] ?? -1;
    webEdges.push({
      u: minIdx,
      v: maxIdx,
      sourceClusterId: cu,
      targetClusterId: cv,
      isCrossCluster: cu !== cv && cu >= 0 && cv >= 0,
      similarity: e.sim,
    });
  }

  if (neighborIndexLists && neighborIndexLists.length === n) {
    const maxMeshDist = Math.max(24, medianDist * 2.25);
    const candidateMesh: Array<{
      u: number;
      v: number;
      sim: number;
      dist2D: number;
      score: number;
    }> = [];

    for (let u = 0; u < n; u++) {
      const list = neighborIndexLists[u] || [];
      for (const nb of list) {
        const v = nb.index;
        if (v < 0 || v >= n || u === v) {
          continue;
        }
        const minIdx = Math.min(u, v);
        const maxIdx = Math.max(u, v);
        const key = `${minIdx}:${maxIdx}`;
        if (edgeSet.has(key)) {
          continue;
        }
        const dist2D = Math.hypot(
          points[minIdx].x - points[maxIdx].x,
          points[minIdx].y - points[maxIdx].y,
        );
        if (dist2D > maxMeshDist || nb.similarity < 0.6) {
          continue;
        }
        const isCross =
          clusterIds[minIdx] !== clusterIds[maxIdx] &&
          clusterIds[minIdx] >= 0 &&
          clusterIds[maxIdx] >= 0;
        const score =
          nb.similarity * (1 - dist2D / (maxMeshDist * 1.4)) +
          (isCross ? 0.08 : 0);
        candidateMesh.push({
          u: minIdx,
          v: maxIdx,
          sim: nb.similarity,
          dist2D,
          score,
        });
      }
    }

    candidateMesh.sort((a, b) => b.score - a.score);
    const maxExtraPerStar = n > 300 ? 1 : 2;

    for (const cand of candidateMesh) {
      const key = `${cand.u}:${cand.v}`;
      if (edgeSet.has(key)) {
        continue;
      }
      if (
        meshDegree[cand.u] >= maxExtraPerStar ||
        meshDegree[cand.v] >= maxExtraPerStar
      ) {
        continue;
      }
      edgeSet.add(key);
      meshDegree[cand.u]++;
      meshDegree[cand.v]++;

      const cu = clusterIds[cand.u] ?? -1;
      const cv = clusterIds[cand.v] ?? -1;
      webEdges.push({
        u: cand.u,
        v: cand.v,
        sourceClusterId: cu,
        targetClusterId: cv,
        isCrossCluster: cu !== cv && cu >= 0 && cv >= 0,
        similarity: cand.sim,
      });
    }
  }

  return webEdges;
}

/**
 * Computes an intra-cluster Minimum Spanning Tree (MST) using Prim's algorithm,
 * pruning outlier bridge edges so each constellation forms an authentic celestial figure.
 */
export function computeClusterMST(
  allPoints: Point2D[],
  clusterPointIndices: number[],
): Array<[number, number]> {
  const m = clusterPointIndices.length;
  if (m < 2) {
    return [];
  }
  if (m === 2) {
    return [[clusterPointIndices[0], clusterPointIndices[1]]];
  }

  const visited = new Array<boolean>(m).fill(false);
  const minWeight = new Array<number>(m).fill(Infinity);
  const parent = new Array<number>(m).fill(-1);

  minWeight[0] = 0;
  const rawEdges: Array<{u: number; v: number; dist: number}> = [];

  for (let step = 0; step < m; step++) {
    let u = -1;
    let bestW = Infinity;
    for (let i = 0; i < m; i++) {
      if (!visited[i] && minWeight[i] < bestW) {
        bestW = minWeight[i];
        u = i;
      }
    }

    if (u === -1) {
      break;
    }
    visited[u] = true;

    if (parent[u] !== -1) {
      rawEdges.push({
        u: clusterPointIndices[parent[u]],
        v: clusterPointIndices[u],
        dist: bestW,
      });
    }

    const pu = allPoints[clusterPointIndices[u]];
    for (let v = 0; v < m; v++) {
      if (!visited[v]) {
        const pv = allPoints[clusterPointIndices[v]];
        const dist = Math.hypot(pu.x - pv.x, pu.y - pv.y);
        if (dist < minWeight[v]) {
          minWeight[v] = dist;
          parent[v] = u;
        }
      }
    }
  }

  if (rawEdges.length <= 2) {
    return rawEdges.map(e => [e.u, e.v]);
  }

  const sortedDists = rawEdges.map(e => e.dist).sort((a, b) => a - b);
  const medianDist = sortedDists[Math.floor(sortedDists.length / 2)] || 1;
  const maxAllowedDist = Math.max(38, medianDist * 2.6);

  return rawEdges
    .filter(
      (e, idx) => rawEdges.length < 4 || idx === 0 || e.dist <= maxAllowedDist,
    )
    .map(e => [e.u, e.v]);
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom <= 1e-12 ? 0 : dot / denom;
}

/**
 * Computes the top-K semantic nearest neighbors for each item.
 * Uses high-dimensional cosine similarity when embeddings are present,
 * blended with 2D spatial proximity so arcs reflect true thematic kinship.
 */
export function computeSemanticNeighbors(
  points: Point2D[],
  embeddings: Array<number[] | undefined>,
  topK = 5,
): SemanticNeighborIndex[][] {
  const n = points.length;
  if (n <= 1) {
    return points.map(() => []);
  }

  let maxDist2D = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(
        points[i].x - points[j].x,
        points[i].y - points[j].y,
      );
      if (d > maxDist2D) {
        maxDist2D = d;
      }
    }
  }

  return points.map((pi, i) => {
    const embI = embeddings[i];
    const hasEmbI = Array.isArray(embI) && embI.length > 0;

    const candidates: SemanticNeighborIndex[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) {
        continue;
      }
      const pj = points[j];
      const dist2D = Math.hypot(pi.x - pj.x, pi.y - pj.y);
      const spatialSim = Math.max(0.15, 1 - dist2D / (maxDist2D * 0.85));

      const embJ = embeddings[j];
      let similarity = spatialSim;
      if (hasEmbI && Array.isArray(embJ) && embJ.length === embI.length) {
        const cosSim = cosineSimilarity(embI, embJ);
        const normalizedCos = Math.max(
          0.35,
          Math.min(0.99, (cosSim - 0.25) / 0.72),
        );
        similarity = normalizedCos * 0.78 + spatialSim * 0.22;
      }

      candidates.push({
        index: j,
        similarity: Math.max(0.4, Math.min(0.99, similarity)),
      });
    }

    candidates.sort((a, b) => b.similarity - a.similarity);
    return candidates.slice(0, topK);
  });
}

/**
 * Extracts the strongest unexpected semantic bridges between books in DIFFERENT constellations.
 * Prioritizes pairs that also cross primary genre boundaries, deduplicates undirected edges,
 * and caps degree per star and per cluster-pair so the canvas stays clean and legible.
 */
export function computeCrossClusterBridges(
  clusterIds: number[],
  neighborIndexLists: SemanticNeighborIndex[][],
  options?: {
    maxBridges?: number;
    maxPerStar?: number;
    maxPerClusterPair?: number;
    minSimilarity?: number;
    genres?: Array<string | undefined>;
  },
): CrossClusterBridge[] {
  const n = clusterIds.length;
  if (n < 2 || neighborIndexLists.length !== n) {
    return [];
  }

  const uniqueClusters = new Set(clusterIds.filter(c => c >= 0));
  if (uniqueClusters.size < 2) {
    return [];
  }

  const maxBridges =
    options?.maxBridges ?? Math.min(20, Math.max(6, uniqueClusters.size * 2));
  const maxPerStar = options?.maxPerStar ?? 2;
  const maxPerClusterPair = options?.maxPerClusterPair ?? 2;
  const minSimilarity = options?.minSimilarity ?? 0.62;
  const genres = options?.genres;

  interface CandidateBridge extends CrossClusterBridge {
    rankScore: number;
    pairKey: string;
    clusterPairKey: string;
  }

  const seenStarPairs = new Map<string, CandidateBridge>();

  for (let u = 0; u < n; u++) {
    const cu = clusterIds[u];
    if (cu < 0) {
      continue;
    }
    const neighbors = neighborIndexLists[u] || [];
    for (const nb of neighbors) {
      const v = nb.index;
      if (v < 0 || v >= n || u === v) {
        continue;
      }
      const cv = clusterIds[v];
      if (cv < 0 || cu === cv) {
        continue;
      }
      if (nb.similarity < minSimilarity) {
        continue;
      }

      const minIdx = Math.min(u, v);
      const maxIdx = Math.max(u, v);
      const pairKey = `${minIdx}:${maxIdx}`;
      const minCluster = Math.min(cu, cv);
      const maxCluster = Math.max(cu, cv);
      const clusterPairKey = `${minCluster}:${maxCluster}`;

      const genreU = genres?.[minIdx]?.trim().toLowerCase();
      const genreV = genres?.[maxIdx]?.trim().toLowerCase();
      const isCrossGenre = Boolean(genreU && genreV && genreU !== genreV);
      const rankScore = nb.similarity + (isCrossGenre ? 0.035 : 0);

      const existing = seenStarPairs.get(pairKey);
      if (!existing || rankScore > existing.rankScore) {
        seenStarPairs.set(pairKey, {
          sourceIndex: minIdx,
          targetIndex: maxIdx,
          sourceClusterId: clusterIds[minIdx],
          targetClusterId: clusterIds[maxIdx],
          similarity: nb.similarity,
          rankScore,
          pairKey,
          clusterPairKey,
        });
      }
    }
  }

  const candidates = Array.from(seenStarPairs.values()).sort(
    (a, b) => b.rankScore - a.rankScore || b.similarity - a.similarity,
  );

  const selected: CrossClusterBridge[] = [];
  const starDegree = new Int32Array(n);
  const clusterPairCount = new Map<string, number>();

  const selectedKeys = new Set<string>();
  for (const cand of candidates) {
    if (selected.length >= maxBridges) {
      break;
    }
    if (
      starDegree[cand.sourceIndex] >= maxPerStar ||
      starDegree[cand.targetIndex] >= maxPerStar
    ) {
      continue;
    }
    const cpCount = clusterPairCount.get(cand.clusterPairKey) || 0;
    if (cpCount >= 1) {
      continue;
    }

    selected.push({
      sourceIndex: cand.sourceIndex,
      targetIndex: cand.targetIndex,
      sourceClusterId: cand.sourceClusterId,
      targetClusterId: cand.targetClusterId,
      similarity: cand.similarity,
    });
    selectedKeys.add(cand.pairKey);
    starDegree[cand.sourceIndex]++;
    starDegree[cand.targetIndex]++;
    clusterPairCount.set(cand.clusterPairKey, cpCount + 1);
  }

  if (selected.length < maxBridges && maxPerClusterPair > 1) {
    for (const cand of candidates) {
      if (selected.length >= maxBridges) {
        break;
      }
      if (selectedKeys.has(cand.pairKey)) {
        continue;
      }
      if (
        starDegree[cand.sourceIndex] >= maxPerStar ||
        starDegree[cand.targetIndex] >= maxPerStar
      ) {
        continue;
      }
      const cpCount = clusterPairCount.get(cand.clusterPairKey) || 0;
      if (cpCount >= maxPerClusterPair) {
        continue;
      }

      selected.push({
        sourceIndex: cand.sourceIndex,
        targetIndex: cand.targetIndex,
        sourceClusterId: cand.sourceClusterId,
        targetClusterId: cand.targetClusterId,
        similarity: cand.similarity,
      });
      selectedKeys.add(cand.pairKey);
      starDegree[cand.sourceIndex]++;
      starDegree[cand.targetIndex]++;
      clusterPairCount.set(cand.clusterPairKey, cpCount + 1);
    }
  }

  return selected;
}
