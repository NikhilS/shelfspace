/**
 * Deterministic Mulberry32 PRNG so K-Means++ and force relaxation
 * produce stable, repeatable results across runs.
 */
export function createSeededRng(seed = 1337): () => number {
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
  maxIterations = 100,
  seed = 42,
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

    let ownSum = 0;
    let ownCount = 0;
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
  const maxAllowedShare = Math.max(0.32, 2.15 / k);
  const largestShare = maxCount / n;
  if (largestShare > maxAllowedShare) {
    adjustment -= (largestShare - maxAllowedShare) * 0.45;
  }

  if (splinterCount > 0) {
    adjustment -= (splinterCount / k) * 0.25;
  }

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
  seed = 42,
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
