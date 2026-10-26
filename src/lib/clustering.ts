export interface Point2D {
  x: number;
  y: number;
}

/**
 * Deterministic Mulberry32 PRNG so K-Means++ and force relaxation
 * produce stable, repeatable results across runs.
 */
export function createSeededRng(seed: number = 1337): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Deterministic K-Means++ clustering implementation.
 * Uses D^2 weighted centroid seeding so clusters never collapse onto adjacent points.
 */
export function kmeans(
  points: number[][],
  k: number,
  maxIterations: number = 100,
  seed: number = 42,
): number[] {
  if (points.length === 0) {
    return [];
  }
  if (k <= 0) {
    return points.map(() => -1);
  }
  if (k >= points.length) {
    return points.map((_, i) => i);
  }

  const rng = createSeededRng(seed);
  const dim = points[0].length;

  // 1. K-Means++ initialization
  const centroids: number[][] = [];
  const firstIdx = Math.floor(rng() * points.length);
  centroids.push([...points[firstIdx]]);

  const minSqDistances = new Array<number>(points.length).fill(Infinity);

  while (centroids.length < k) {
    const lastCentroid = centroids[centroids.length - 1];
    let totalWeight = 0;

    for (let i = 0; i < points.length; i++) {
      const dist = euclideanDistance(points[i], lastCentroid);
      const sqDist = dist * dist;
      if (sqDist < minSqDistances[i]) {
        minSqDistances[i] = sqDist;
      }
      totalWeight += minSqDistances[i];
    }

    if (totalWeight <= 1e-12) {
      const fallbackIdx = centroids.length % points.length;
      centroids.push([...points[fallbackIdx]]);
      continue;
    }

    let target = rng() * totalWeight;
    let chosenIdx = points.length - 1;
    for (let i = 0; i < points.length; i++) {
      target -= minSqDistances[i];
      if (target <= 0) {
        chosenIdx = i;
        break;
      }
    }
    centroids.push([...points[chosenIdx]]);
  }

  const labels = new Array<number>(points.length).fill(-1);
  let hasChanged = true;
  let iterations = 0;

  while (hasChanged && iterations < maxIterations) {
    hasChanged = false;
    iterations++;

    // Assign points to the closest centroid
    for (let i = 0; i < points.length; i++) {
      let minDistance = Infinity;
      let closestCluster = 0;

      for (let j = 0; j < centroids.length; j++) {
        const dist = euclideanDistance(points[i], centroids[j]);
        if (dist < minDistance) {
          minDistance = dist;
          closestCluster = j;
        }
      }

      if (labels[i] !== closestCluster) {
        labels[i] = closestCluster;
        hasChanged = true;
      }
    }

    // Update centroids
    const newCentroids = Array.from({length: k}, () =>
      new Array<number>(dim).fill(0),
    );
    const counts = new Array<number>(k).fill(0);

    for (let i = 0; i < points.length; i++) {
      const cluster = labels[i];
      if (cluster >= 0 && cluster < k) {
        counts[cluster]++;
        for (let d = 0; d < dim; d++) {
          newCentroids[cluster][d] += points[i][d];
        }
      }
    }

    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        for (let d = 0; d < dim; d++) {
          newCentroids[j][d] /= counts[j];
        }
      } else {
        // Re-seed empty cluster to the point farthest from its assigned centroid
        let farthestIdx = Math.floor(rng() * points.length);
        let maxDist = -1;
        for (let i = 0; i < points.length; i++) {
          const assigned = labels[i];
          if (assigned >= 0) {
            const d = euclideanDistance(points[i], centroids[assigned]);
            if (d > maxDist) {
              maxDist = d;
              farthestIdx = i;
            }
          }
        }
        newCentroids[j] = [...points[farthestIdx]];
      }
    }

    for (let j = 0; j < k; j++) {
      centroids[j] = newCentroids[j];
    }
  }

  return labels;
}

/**
 * Computes the average Silhouette Score in [-1, 1] for a given clustering assignment.
 */
export function computeSilhouetteScore(
  points: number[][],
  labels: number[],
): number {
  const n = points.length;
  if (n < 3) {
    return 0;
  }

  const uniqueClusters = Array.from(new Set(labels.filter(l => l >= 0)));
  if (uniqueClusters.length < 2 || uniqueClusters.length >= n) {
    return -1;
  }

  let totalSilhouette = 0;
  let validCount = 0;

  for (let i = 0; i < n; i++) {
    const ownCluster = labels[i];
    if (ownCluster < 0) {
      continue;
    }

    // Average distance to points in own cluster (a_i)
    let ownSum = 0;
    let ownCount = 0;

    // Average distance to points in other clusters
    const otherSums = new Map<number, {sum: number; count: number}>();

    for (let j = 0; j < n; j++) {
      if (i === j) {
        continue;
      }
      const otherCluster = labels[j];
      if (otherCluster < 0) {
        continue;
      }

      const dist = euclideanDistance(points[i], points[j]);
      if (otherCluster === ownCluster) {
        ownSum += dist;
        ownCount++;
      } else {
        const entry = otherSums.get(otherCluster);
        if (entry) {
          entry.sum += dist;
          entry.count++;
        } else {
          otherSums.set(otherCluster, {sum: dist, count: 1});
        }
      }
    }

    if (ownCount === 0) {
      totalSilhouette += 0;
      validCount++;
      continue;
    }

    const a = ownSum / ownCount;
    let b = Infinity;
    for (const entry of otherSums.values()) {
      if (entry.count > 0) {
        const meanOther = entry.sum / entry.count;
        if (meanOther < b) {
          b = meanOther;
        }
      }
    }

    if (!Number.isFinite(b) || Math.max(a, b) <= 1e-12) {
      continue;
    }
    const s = (b - a) / Math.max(a, b);
    totalSilhouette += s;
    validCount++;
  }

  return validCount > 0 ? totalSilhouette / validCount : 0;
}

/**
 * Computes collection-scaled [minK, maxK] bounds using a sub-linear power curve
 * so small/medium libraries form 4–10 micro-constellations while large collections
 * (e.g. 800–1,000+ books) scale into 10–16 substantial constellations (~50–90 books each)
 * without splintering into dozens of tiny clusters.
 */
export function getOptimalClusterBounds(n: number): {
  minK: number;
  maxK: number;
} {
  if (n <= 0) {
    return {minK: 0, maxK: 0};
  }
  if (n < 4) {
    const k = Math.max(1, Math.min(2, n));
    return {minK: k, maxK: k};
  }
  if (n < 9) {
    const minK = 2;
    const maxK = Math.min(3, n - 1);
    return {minK, maxK};
  }
  if (n < 18) {
    const minK = 3;
    const maxK = Math.max(minK, Math.min(5, Math.floor(n / 3)));
    return {minK, maxK};
  }
  if (n < 50) {
    const minK = 4;
    const maxK = Math.max(minK + 1, Math.min(8, Math.round(Math.sqrt(n))));
    return {minK, maxK};
  }
  if (n < 200) {
    const minK = Math.max(5, Math.min(9, Math.round(Math.pow(n, 0.34) * 1.3)));
    const maxK = Math.min(
      12,
      Math.max(minK + 2, Math.round(Math.pow(n, 0.36) * 1.7)),
    );
    return {minK, maxK};
  }

  // Large libraries (200 to 1,000+ books, e.g. Sterling Place at 881 books -> K in [10, 16])
  const minK = Math.min(14, Math.max(8, Math.round(Math.pow(n, 0.33) * 1.1)));
  const maxK = Math.min(
    18,
    Math.max(minK + 3, Math.round(Math.pow(n, 0.35) * 1.45)),
  );
  return {minK, maxK};
}

/**
 * Fast Silhouette Score evaluation using a precomputed flat N x N Euclidean distance matrix.
 * Avoids recomputing O(N^2) square roots across every candidate K and restart.
 */
function computeSilhouetteFromMatrix(
  distMatrix: Float64Array,
  n: number,
  labels: number[],
  k: number,
): number {
  if (n < 3 || k < 2 || k >= n) {
    return 0;
  }

  const clusterCounts = new Int32Array(k);
  for (let i = 0; i < n; i++) {
    const c = labels[i];
    if (c >= 0 && c < k) {
      clusterCounts[c]++;
    }
  }

  let activeClusters = 0;
  for (let c = 0; c < k; c++) {
    if (clusterCounts[c] > 0) {
      activeClusters++;
    }
  }
  if (activeClusters < 2 || activeClusters >= n) {
    return -1;
  }

  const otherSums = new Float64Array(k);
  let totalSilhouette = 0;
  let validCount = 0;

  for (let i = 0; i < n; i++) {
    const ownCluster = labels[i];
    if (ownCluster < 0 || ownCluster >= k) {
      continue;
    }

    const ownCount = clusterCounts[ownCluster] - 1;
    if (ownCount <= 0) {
      validCount++;
      continue;
    }

    otherSums.fill(0);
    const rowOffset = i * n;
    for (let j = 0; j < n; j++) {
      if (i === j) {
        continue;
      }
      const cj = labels[j];
      if (cj >= 0 && cj < k) {
        otherSums[cj] += distMatrix[rowOffset + j];
      }
    }

    const a = otherSums[ownCluster] / ownCount;
    let b = Infinity;
    for (let c = 0; c < k; c++) {
      if (c !== ownCluster && clusterCounts[c] > 0) {
        const meanOther = otherSums[c] / clusterCounts[c];
        if (meanOther < b) {
          b = meanOther;
        }
      }
    }

    if (!Number.isFinite(b) || Math.max(a, b) <= 1e-12) {
      continue;
    }
    totalSilhouette += (b - a) / Math.max(a, b);
    validCount++;
  }

  return validCount > 0 ? totalSilhouette / validCount : 0;
}

/**
 * Computes O(N * K * D) high-dimensional centroid cosine separation score in [-1, 1]
 * when book embeddings are available, ensuring clusters reflect genuine thematic separation
 * rather than 2D projection artifacts.
 */
function computeHighDimCentroidSeparation(
  unitEmbeddings: Float64Array[],
  labels: number[],
  k: number,
): number {
  const n = unitEmbeddings.length;
  if (n < 3 || k < 2) {
    return 0;
  }
  const dim = unitEmbeddings[0]?.length || 0;
  if (dim === 0) {
    return 0;
  }

  const centroids = Array.from({length: k}, () => new Float64Array(dim));
  const counts = new Int32Array(k);

  for (let i = 0; i < n; i++) {
    const c = labels[i];
    if (c >= 0 && c < k) {
      counts[c]++;
      const emb = unitEmbeddings[i];
      const cent = centroids[c];
      for (let d = 0; d < dim; d++) {
        cent[d] += emb[d];
      }
    }
  }

  for (let c = 0; c < k; c++) {
    if (counts[c] > 0) {
      let normSq = 0;
      const cent = centroids[c];
      for (let d = 0; d < dim; d++) {
        normSq += cent[d] * cent[d];
      }
      const invNorm = normSq > 1e-12 ? 1 / Math.sqrt(normSq) : 0;
      for (let d = 0; d < dim; d++) {
        cent[d] *= invNorm;
      }
    }
  }

  let totalSep = 0;
  let valid = 0;
  for (let i = 0; i < n; i++) {
    const ownC = labels[i];
    if (ownC < 0 || ownC >= k || counts[ownC] <= 1) {
      continue;
    }
    const emb = unitEmbeddings[i];
    const ownCent = centroids[ownC];
    let ownSim = 0;
    for (let d = 0; d < dim; d++) {
      ownSim += emb[d] * ownCent[d];
    }

    let bestOtherSim = -1;
    for (let c = 0; c < k; c++) {
      if (c === ownC || counts[c] === 0) {
        continue;
      }
      const otherCent = centroids[c];
      let sim = 0;
      for (let d = 0; d < dim; d++) {
        sim += emb[d] * otherCent[d];
      }
      if (sim > bestOtherSim) {
        bestOtherSim = sim;
      }
    }

    if (bestOtherSim > -1) {
      totalSep += ownSim - bestOtherSim;
      valid++;
    }
  }

  return valid > 0 ? totalSep / valid : 0;
}

/**
 * Evaluates cluster size distribution to prevent either a single giant mega-cluster
 * swallowing the library or tiny 1–2 book splinter clusters in large libraries.
 */
function computeClusterBalanceAdjustment(
  labels: number[],
  k: number,
  minK: number,
  maxK: number,
): number {
  const n = labels.length;
  if (n < 12 || k < 2) {
    return 0;
  }

  const counts = new Int32Array(k);
  for (let i = 0; i < n; i++) {
    const c = labels[i];
    if (c >= 0 && c < k) {
      counts[c]++;
    }
  }

  let maxCount = 0;
  let splinterCount = 0;
  const minHealthyClusterSize = Math.max(2, Math.floor(n / (k * 3.5)));

  for (let c = 0; c < k; c++) {
    if (counts[c] > maxCount) {
      maxCount = counts[c];
    }
    if (counts[c] < minHealthyClusterSize) {
      splinterCount++;
    }
  }

  let adjustment = 0;

  // Penalize mega-clusters that swallow > max(32%, 2.15 / K) of the library
  const maxAllowedShare = Math.max(0.32, 2.15 / k);
  const largestShare = maxCount / n;
  if (largestShare > maxAllowedShare) {
    adjustment -= (largestShare - maxAllowedShare) * 0.45;
  }

  // Penalize splinter clusters in medium/large libraries
  if (splinterCount > 0) {
    adjustment -= (splinterCount / k) * 0.25;
  }

  // Gentle granularity prior so continuous semantic manifolds don't trivially collapse to minK
  // when finer constellations have comparable cohesion
  if (maxK > minK) {
    const progress = (k - minK) / (maxK - minK);
    adjustment += Math.sin(progress * Math.PI * 0.85) * 0.045;
  }

  return adjustment;
}

/**
 * Evaluates candidate cluster counts K using K-Means++, precomputed 2D Silhouette score,
 * optional high-dimensional centroid cosine separation, and cluster balance scoring
 * so the constellation map automatically forms natural, well-proportioned clusters.
 */
export function optimalKMeans(
  points2D: number[][],
  seed: number = 42,
  embeddings?: Array<number[] | undefined>,
): {labels: number[]; k: number; silhouette: number} {
  const n = points2D.length;
  if (n === 0) {
    return {labels: [], k: 0, silhouette: 0};
  }
  if (n < 4) {
    const k = Math.max(1, Math.min(2, n));
    return {labels: kmeans(points2D, k, 100, seed), k, silhouette: 0};
  }

  const {minK, maxK} = getOptimalClusterBounds(n);

  // Precompute flat N x N 2D Euclidean distance matrix once in O(N^2)
  const distMatrix = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    const pi = points2D[i];
    for (let j = i + 1; j < n; j++) {
      const pj = points2D[j];
      const dx = pi[0] - pj[0];
      const dy = (pi[1] ?? 0) - (pj[1] ?? 0);
      const d = Math.hypot(dx, dy);
      distMatrix[i * n + j] = d;
      distMatrix[j * n + i] = d;
    }
  }

  // Pre-normalize high-dimensional embeddings once if available for all points
  let unitEmbeddings: Float64Array[] | null = null;
  if (embeddings && embeddings.length === n) {
    const firstDim = embeddings[0]?.length || 0;
    if (
      firstDim > 0 &&
      embeddings.every(e => Array.isArray(e) && e.length === firstDim)
    ) {
      unitEmbeddings = embeddings.map(emb => {
        const arr = new Float64Array(firstDim);
        let normSq = 0;
        for (let d = 0; d < firstDim; d++) {
          const v = emb![d];
          arr[d] = v;
          normSq += v * v;
        }
        const inv = normSq > 1e-12 ? 1 / Math.sqrt(normSq) : 0;
        for (let d = 0; d < firstDim; d++) {
          arr[d] *= inv;
        }
        return arr;
      });
    }
  }

  let bestK = minK;
  let bestLabels = kmeans(points2D, minK, 120, seed);
  let bestRawSilhouette = computeSilhouetteFromMatrix(
    distMatrix,
    n,
    bestLabels,
    minK,
  );
  let bestCompositeScore = -Infinity;

  for (let candidateK = minK; candidateK <= maxK; candidateK++) {
    // Run 3 deterministic restarts per candidate K and pick the best
    for (let restart = 0; restart < 3; restart++) {
      const labels = kmeans(
        points2D,
        candidateK,
        120,
        seed + candidateK * 31 + restart * 17,
      );
      const rawSil = computeSilhouetteFromMatrix(
        distMatrix,
        n,
        labels,
        candidateK,
      );
      const semSep = unitEmbeddings
        ? computeHighDimCentroidSeparation(unitEmbeddings, labels, candidateK)
        : 0;
      const balanceAdj = computeClusterBalanceAdjustment(
        labels,
        candidateK,
        minK,
        maxK,
      );

      const compositeScore =
        (unitEmbeddings ? rawSil * 0.72 + semSep * 0.28 : rawSil) + balanceAdj;

      if (compositeScore > bestCompositeScore) {
        bestCompositeScore = compositeScore;
        bestRawSilhouette = rawSil;
        bestK = candidateK;
        bestLabels = labels;
      }
    }
  }

  return {labels: bestLabels, k: bestK, silhouette: bestRawSilhouette};
}

/**
 * Continuous Manifold Layout & Overlap-Only De-Crowding:
 * 1. Normalizes raw 2D UMAP coordinates isotropically so the global and local manifold
 *    topology (including smooth transitional zones between clusters) is preserved.
 * 2. Gently unstacks degenerate identical centroids if multiple clusters were initialized
 *    at the exact same coordinate.
 * 3. Runs a velocity-free, deterministic point-to-point overlap resolution pass anchored
 *    by a gentle topological spring to each point's natural UMAP coordinate.
 *    Cross-cluster and same-cluster pairs use the exact same local de-crowding distance,
 *    allowing neighboring constellations to flow organically into one another without artificial moats.
 */
export function normalizeAndRelaxPositions(
  rawPoints: Point2D[],
  options?: {
    range?: number;
    minDistance?: number;
    iterations?: number;
    clusterIds?: number[];
  },
): Point2D[] {
  const n = rawPoints.length;
  if (n === 0) {
    return [];
  }

  const targetRange = options?.range ?? 86;
  const clusterIds = options?.clusterIds;
  const defaultMinDist = Math.max(
    1.6,
    Math.min(9.5, 44 / Math.sqrt(Math.max(1, n))),
  );
  const minDistance = options?.minDistance ?? defaultMinDist;
  const iterations = options?.iterations ?? 50;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    const p = rawPoints[i];
    if (p.x < minX) {
      minX = p.x;
    }
    if (p.x > maxX) {
      maxX = p.x;
    }
    if (p.y < minY) {
      minY = p.y;
    }
    if (p.y > maxY) {
      maxY = p.y;
    }
  }

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const cx = (minX + maxX) * 0.5;
  const cy = (minY + maxY) * 0.5;
  const maxSpan = Math.max(spanX, spanY);

  // Preserve isotropic aspect ratio while gently preventing extreme 1D ribbon collapse
  const effectiveSpanX = Math.max(spanX, maxSpan * 0.55);
  const effectiveSpanY = Math.max(spanY, maxSpan * 0.55);
  const initialScale = targetRange * 0.88;

  const anchors: Point2D[] = rawPoints.map((p, idx) => {
    if (maxSpan <= 1e-5) {
      const angle = (idx / Math.max(1, n)) * Math.PI * 2;
      const r = targetRange * 0.35;
      return {x: Math.cos(angle) * r, y: Math.sin(angle) * r};
    }
    return {
      x: ((p.x - cx) / (effectiveSpanX * 0.5)) * initialScale,
      y: ((p.y - cy) / (effectiveSpanY * 0.5)) * initialScale,
    };
  });

  // If multiple clusters start stacked on the exact same degenerate coordinate,
  // apply a gentle radial offset to their anchors so they don't pile onto a single pixel,
  // while keeping their borders touching and overlapping.
  if (clusterIds && clusterIds.length === n) {
    const clusterGroups = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const cid = clusterIds[i];
      if (cid >= 0) {
        const list = clusterGroups.get(cid) || [];
        list.push(i);
        clusterGroups.set(cid, list);
      }
    }

    const cids = Array.from(clusterGroups.keys());
    if (cids.length >= 2) {
      const centroids = cids.map(cid => {
        const indices = clusterGroups.get(cid)!;
        let sx = 0;
        let sy = 0;
        for (const idx of indices) {
          sx += anchors[idx].x;
          sy += anchors[idx].y;
        }
        return {
          cid,
          indices,
          x: sx / indices.length,
          y: sy / indices.length,
        };
      });

      for (let pass = 0; pass < 12; pass++) {
        for (let a = 0; a < centroids.length; a++) {
          for (let b = a + 1; b < centroids.length; b++) {
            const ca = centroids[a];
            const cb = centroids[b];
            let dx = cb.x - ca.x;
            let dy = cb.y - ca.y;
            let dist = Math.hypot(dx, dy);
            const minCentroidTouchDist = Math.max(18, minDistance * 2.4);
            if (dist < minCentroidTouchDist) {
              if (dist < 1e-4) {
                const angle = (a * 2.39996 + b * 1.1) % (Math.PI * 2);
                dx = Math.cos(angle) * 0.01;
                dy = Math.sin(angle) * 0.01;
                dist = 0.01;
              }
              const push = (minCentroidTouchDist - dist) * 0.35;
              const ux = dx / dist;
              const uy = dy / dist;
              ca.x -= ux * push;
              ca.y -= uy * push;
              cb.x += ux * push;
              cb.y += uy * push;
              for (const idx of ca.indices) {
                anchors[idx].x -= ux * push;
                anchors[idx].y -= uy * push;
              }
              for (const idx of cb.indices) {
                anchors[idx].x += ux * push;
                anchors[idx].y += uy * push;
              }
            }
          }
        }
      }
    }
  }

  const pts: Point2D[] = anchors.map(a => ({x: a.x, y: a.y}));

  // Cluster-agnostic overlap-only de-crowding with topological manifold spring
  if (n > 1) {
    for (let step = 0; step < iterations; step++) {
      const alpha = 1 - step / iterations;
      const springStrength = 0.09 * alpha;

      // 1. Gentle spring toward natural manifold anchor
      for (let i = 0; i < n; i++) {
        pts[i].x += (anchors[i].x - pts[i].x) * springStrength;
        pts[i].y += (anchors[i].y - pts[i].y) * springStrength;
      }

      // 2. Pairwise overlap resolution (identical treatment for intra- and inter-cluster pairs)
      const pushFactor = 0.5 * (0.45 + 0.55 * alpha);
      for (let i = 0; i < n; i++) {
        const pi = pts[i];
        for (let j = i + 1; j < n; j++) {
          const pj = pts[j];
          let dx = pj.x - pi.x;
          let dy = pj.y - pi.y;
          const absDx = Math.abs(dx);
          const absDy = Math.abs(dy);
          if (absDx >= minDistance || absDy >= minDistance) {
            continue;
          }
          let dist = Math.hypot(dx, dy);
          if (dist < minDistance) {
            if (dist < 1e-4) {
              const angle = (i * 2.39996 + j * 0.7) % (Math.PI * 2);
              dx = Math.cos(angle) * 0.01;
              dy = Math.sin(angle) * 0.01;
              dist = 0.01;
            }
            const overlap = (minDistance - dist) * pushFactor;
            const ux = dx / dist;
            const uy = dy / dist;
            pi.x -= ux * overlap;
            pi.y -= uy * overlap;
            pj.x += ux * overlap;
            pj.y += uy * overlap;
          }
        }
      }
    }
  }

  // Final isotropic centering and fit within [-targetRange, targetRange]
  let finalMinX = Infinity;
  let finalMaxX = -Infinity;
  let finalMinY = Infinity;
  let finalMaxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    if (p.x < finalMinX) {
      finalMinX = p.x;
    }
    if (p.x > finalMaxX) {
      finalMaxX = p.x;
    }
    if (p.y < finalMinY) {
      finalMinY = p.y;
    }
    if (p.y > finalMaxY) {
      finalMaxY = p.y;
    }
  }

  const finalCx = (finalMinX + finalMaxX) * 0.5;
  const finalCy = (finalMinY + finalMaxY) * 0.5;
  const halfExtent = Math.max(
    1e-5,
    (finalMaxX - finalMinX) * 0.5,
    (finalMaxY - finalMinY) * 0.5,
  );
  const scaleFactor = halfExtent > targetRange ? targetRange / halfExtent : 1;

  return pts.map(p => ({
    x: (p.x - finalCx) * scaleFactor,
    y: (p.y - finalCy) * scaleFactor,
  }));
}

/**
 * Detects whether a set of persisted 2D cluster coordinates came from the legacy
 * rigid-island layout (where clusters were separated by artificial empty moats)
 * vs. a continuous semantic manifold where adjacent clusters touch along shared borders.
 */
export function isLegacyIslandLayout(
  points: Point2D[],
  clusterIds: number[],
): boolean {
  const n = points.length;
  if (n < 12 || clusterIds.length !== n) {
    return false;
  }

  const uniqueClusters = new Set(clusterIds.filter(c => c >= 0));
  if (uniqueClusters.size < 2) {
    return false;
  }

  const sameDists: number[] = [];
  const crossDists: number[] = [];

  for (let i = 0; i < n; i++) {
    const ci = clusterIds[i];
    if (ci < 0) {
      continue;
    }
    let minSame = Infinity;
    let minCross = Infinity;
    const pi = points[i];

    for (let j = 0; j < n; j++) {
      if (i === j) {
        continue;
      }
      const cj = clusterIds[j];
      if (cj < 0) {
        continue;
      }
      const d = Math.hypot(pi.x - points[j].x, pi.y - points[j].y);
      if (ci === cj) {
        if (d < minSame) {
          minSame = d;
        }
      } else {
        if (d < minCross) {
          minCross = d;
        }
      }
    }

    if (Number.isFinite(minSame)) {
      sameDists.push(minSame);
    }
    if (Number.isFinite(minCross)) {
      crossDists.push(minCross);
    }
  }

  if (sameDists.length === 0 || crossDists.length === 0) {
    return false;
  }

  sameDists.sort((a, b) => a - b);
  crossDists.sort((a, b) => a - b);

  const medianSame = sameDists[Math.floor(sameDists.length * 0.5)] || 1;
  const decileCross = crossDists[Math.floor(crossDists.length * 0.1)] || 0;

  // In the legacy rigid-island layout, even the closest 10% of boundary stars had a wide
  // artificial moat (> 3.2x median intra-cluster spacing) separating them from neighboring clusters.
  return decileCross > Math.max(9.5, medianSame * 3.1);
}

export interface SoftClusterMembership {
  primaryClusterId: number;
  secondaryClusterId: number;
  secondaryWeight: number;
}

/**
 * Computes soft dual-cluster membership for every point so transitional books
 * on the frontier between constellations blend colors and illuminate across boundaries.
 */
export function computeSoftClusterMemberships(
  points: Point2D[],
  clusterIds: number[],
  embeddings?: Array<number[] | undefined>,
): SoftClusterMembership[] {
  const n = points.length;
  if (n === 0) {
    return [];
  }

  const validCids = Array.from(
    new Set(clusterIds.filter(cid => typeof cid === 'number' && cid >= 0)),
  ).sort((a, b) => a - b);

  if (validCids.length < 2) {
    return points.map((_, i) => ({
      primaryClusterId: clusterIds[i] ?? -1,
      secondaryClusterId: -1,
      secondaryWeight: 0,
    }));
  }

  // Compute 2D centroids and member lists per cluster
  const clusterMembers = new Map<number, number[]>();
  const centroids2D = new Map<number, Point2D>();

  for (const cid of validCids) {
    clusterMembers.set(cid, []);
  }
  for (let i = 0; i < n; i++) {
    const cid = clusterIds[i];
    if (cid >= 0 && clusterMembers.has(cid)) {
      clusterMembers.get(cid)!.push(i);
    }
  }

  for (const cid of validCids) {
    const indices = clusterMembers.get(cid)!;
    let sx = 0;
    let sy = 0;
    for (const idx of indices) {
      sx += points[idx].x;
      sy += points[idx].y;
    }
    centroids2D.set(cid, {
      x: sx / Math.max(1, indices.length),
      y: sy / Math.max(1, indices.length),
    });
  }

  // Optional unit-normalized high-dimensional embedding centroids
  const firstDim = embeddings?.[0]?.length || 0;
  const hasEmbeddings =
    Boolean(embeddings) &&
    embeddings!.length === n &&
    firstDim > 0 &&
    embeddings!.every(e => Array.isArray(e) && e.length === firstDim);

  const unitEmbeddings: Float64Array[] | null = hasEmbeddings
    ? embeddings!.map(emb => {
        const arr = new Float64Array(firstDim);
        let normSq = 0;
        for (let d = 0; d < firstDim; d++) {
          const v = emb![d];
          arr[d] = v;
          normSq += v * v;
        }
        const inv = normSq > 1e-12 ? 1 / Math.sqrt(normSq) : 0;
        for (let d = 0; d < firstDim; d++) {
          arr[d] *= inv;
        }
        return arr;
      })
    : null;

  const embCentroids = new Map<number, Float64Array>();
  if (unitEmbeddings) {
    for (const cid of validCids) {
      const indices = clusterMembers.get(cid)!;
      const cent = new Float64Array(firstDim);
      for (const idx of indices) {
        const u = unitEmbeddings[idx];
        for (let d = 0; d < firstDim; d++) {
          cent[d] += u[d];
        }
      }
      let normSq = 0;
      for (let d = 0; d < firstDim; d++) {
        normSq += cent[d] * cent[d];
      }
      const inv = normSq > 1e-12 ? 1 / Math.sqrt(normSq) : 0;
      for (let d = 0; d < firstDim; d++) {
        cent[d] *= inv;
      }
      embCentroids.set(cid, cent);
    }
  }

  return points.map((pt, i) => {
    const primaryCid = clusterIds[i] ?? -1;
    if (primaryCid < 0) {
      return {
        primaryClusterId: -1,
        secondaryClusterId: -1,
        secondaryWeight: 0,
      };
    }

    let primaryAffinity = 0;
    let bestSecondaryCid = -1;
    let bestSecondaryAffinity = -Infinity;

    for (const cid of validCids) {
      const c2d = centroids2D.get(cid)!;
      const distCentroid = Math.hypot(pt.x - c2d.x, pt.y - c2d.y);

      // Also check distance to closest 2 members of cluster cid for local frontier sensitivity
      const members = clusterMembers.get(cid)!;
      let d1 = Infinity;
      let d2 = Infinity;
      for (const mIdx of members) {
        if (mIdx === i) {
          continue;
        }
        const d = Math.hypot(pt.x - points[mIdx].x, pt.y - points[mIdx].y);
        if (d < d1) {
          d2 = d1;
          d1 = d;
        } else if (d < d2) {
          d2 = d;
        }
      }
      const localDist = Number.isFinite(d2)
        ? (d1 + d2) * 0.5
        : Number.isFinite(d1)
          ? d1
          : distCentroid;

      const effectiveDist = distCentroid * 0.45 + localDist * 0.55;
      const spatialAffinity = 1 / (1 + effectiveDist * 0.045);

      let affinity = spatialAffinity;
      if (unitEmbeddings && embCentroids.has(cid)) {
        const u = unitEmbeddings[i];
        const cent = embCentroids.get(cid)!;
        let cos = 0;
        for (let d = 0; d < firstDim; d++) {
          cos += u[d] * cent[d];
        }
        const normCos = Math.max(0.05, (cos + 1) * 0.5);
        affinity = normCos * 0.55 + spatialAffinity * 0.45;
      }

      if (cid === primaryCid) {
        primaryAffinity = affinity;
      } else if (affinity > bestSecondaryAffinity) {
        bestSecondaryAffinity = affinity;
        bestSecondaryCid = cid;
      }
    }

    if (bestSecondaryCid < 0 || primaryAffinity <= 1e-6) {
      return {
        primaryClusterId: primaryCid,
        secondaryClusterId: -1,
        secondaryWeight: 0,
      };
    }

    const ratio = bestSecondaryAffinity / primaryAffinity;
    // Map ratio in [0.70, 1.0] smoothly onto secondaryWeight in [0, 0.5]
    const rawWeight =
      ratio <= 0.7 ? 0 : Math.min(0.5, ((ratio - 0.7) / 0.3) * 0.5);

    return {
      primaryClusterId: primaryCid,
      secondaryClusterId: rawWeight >= 0.08 ? bestSecondaryCid : -1,
      secondaryWeight: Number(rawWeight.toFixed(3)),
    };
  });
}

export interface SemanticWebEdge {
  u: number;
  v: number;
  sourceClusterId: number;
  targetClusterId: number;
  isCrossCluster: boolean;
  similarity: number;
}

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

  // Build quick lookup of semantic similarities for neighbor pairs
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

  // Step 1: Global Minimum Spanning Tree across all points
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

  // Step 2: Augment with local semantic kNN filaments for organic mesh continuity
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

  // Prune extreme outlier edges (> 2.6x median edge length) if cluster has >= 5 stars
  const sortedDists = rawEdges.map(e => e.dist).sort((a, b) => a - b);
  const medianDist = sortedDists[Math.floor(sortedDists.length / 2)] || 1;
  const maxAllowedDist = Math.max(38, medianDist * 2.6);

  return rawEdges
    .filter(
      (e, idx) => rawEdges.length < 4 || idx === 0 || e.dist <= maxAllowedDist,
    )
    .map(e => [e.u, e.v]);
}

function crossProduct(o: Point2D, a: Point2D, b: Point2D): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * Computes a padded, organic convex hull boundary around a cluster's stars
 * suitable for closed Catmull-Rom spline rendering on an HTML5 Canvas.
 */
export function computePaddedConvexHull(
  clusterPoints: Point2D[],
  padding: number = 6.5,
): Point2D[] {
  const n = clusterPoints.length;
  if (n === 0) {
    return [];
  }

  // For 1 star: generate an 8-point circular territory halo
  if (n === 1) {
    const c = clusterPoints[0];
    return Array.from({length: 8}, (_, i) => {
      const angle = (i / 8) * Math.PI * 2;
      return {
        x: c.x + Math.cos(angle) * padding,
        y: c.y + Math.sin(angle) * padding,
      };
    });
  }

  // For 2 stars: generate a smooth capsule boundary around the pair
  if (n === 2) {
    const p0 = clusterPoints[0];
    const p1 = clusterPoints[1];
    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    return [
      {x: p0.x - ux * padding, y: p0.y - uy * padding},
      {x: p0.x + nx * padding * 0.9, y: p0.y + ny * padding * 0.9},
      {x: p1.x + nx * padding * 0.9, y: p1.y + ny * padding * 0.9},
      {x: p1.x + ux * padding, y: p1.y + uy * padding},
      {x: p1.x - nx * padding * 0.9, y: p1.y - ny * padding * 0.9},
      {x: p0.x - nx * padding * 0.9, y: p0.y - ny * padding * 0.9},
    ];
  }

  // Generate support points around each star so even collinear stars produce a rich hull
  const expanded: Point2D[] = [];
  const supportSides = 6;
  for (const p of clusterPoints) {
    for (let s = 0; s < supportSides; s++) {
      const angle = (s / supportSides) * Math.PI * 2;
      expanded.push({
        x: p.x + Math.cos(angle) * padding,
        y: p.y + Math.sin(angle) * padding,
      });
    }
  }

  // Monotone Chain Convex Hull
  const sorted = [...expanded].sort((a, b) =>
    a.x === b.x ? a.y - b.y : a.x - b.x,
  );

  const lower: Point2D[] = [];
  for (const p of sorted) {
    while (
      lower.length >= 2 &&
      crossProduct(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point2D[] = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (
      upper.length >= 2 &&
      crossProduct(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

export interface SemanticNeighborIndex {
  index: number;
  similarity: number;
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
  topK: number = 5,
): SemanticNeighborIndex[][] {
  const n = points.length;
  if (n <= 1) {
    return points.map(() => []);
  }

  // Compute max 2D distance for spatial normalization fallback
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

export interface CrossClusterBridge {
  sourceIndex: number;
  targetIndex: number;
  sourceClusterId: number;
  targetClusterId: number;
  similarity: number;
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

  // Pass 1: At most 1 bridge per cluster pair so every constellation gets representation first
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

  // Pass 2: Allow up to maxPerClusterPair if capacity remains
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
