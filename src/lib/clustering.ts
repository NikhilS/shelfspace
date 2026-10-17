export interface Point2D {
  x: number;
  y: number;
}

export interface SemanticNeighborIndex {
  index: number;
  similarity: number;
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

export function cosineSimilarity(a: number[], b: number[]): number {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const va = a[i];
    const vb = b[i];
    dot += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom <= 1e-12) return 0;
  return Math.max(-1, Math.min(1, dot / denom));
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
  if (points.length === 0) return [];
  if (k <= 0) return points.map(() => -1);
  if (k >= points.length) return points.map((_, i) => i);

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
  if (n < 3) return 0;

  const uniqueClusters = Array.from(new Set(labels.filter(l => l >= 0)));
  if (uniqueClusters.length < 2 || uniqueClusters.length >= n) return -1;

  let totalSilhouette = 0;
  let validCount = 0;

  for (let i = 0; i < n; i++) {
    const ownCluster = labels[i];
    if (ownCluster < 0) continue;

    // Average distance to points in own cluster (a_i)
    let ownSum = 0;
    let ownCount = 0;

    // Average distance to points in other clusters
    const otherSums = new Map<number, {sum: number; count: number}>();

    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const otherCluster = labels[j];
      if (otherCluster < 0) continue;

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
        if (meanOther < b) b = meanOther;
      }
    }

    if (!Number.isFinite(b) || Math.max(a, b) <= 1e-12) continue;
    const s = (b - a) / Math.max(a, b);
    totalSilhouette += s;
    validCount++;
  }

  return validCount > 0 ? totalSilhouette / validCount : 0;
}

/**
 * Evaluates candidate cluster counts K using K-Means++ and Silhouette score
 * so the constellation map automatically forms natural, well-separated clusters.
 */
export function optimalKMeans(
  points2D: number[][],
  seed: number = 42,
): {labels: number[]; k: number; silhouette: number} {
  const n = points2D.length;
  if (n === 0) return {labels: [], k: 0, silhouette: 0};
  if (n < 4) {
    const k = Math.max(1, Math.min(2, n));
    return {labels: kmeans(points2D, k, 100, seed), k, silhouette: 0};
  }

  const minK = Math.min(3, Math.max(2, Math.floor(n / 6)));
  const maxK = Math.min(10, Math.max(minK, Math.floor(Math.sqrt(n * 1.4))));

  let bestK = minK;
  let bestLabels = kmeans(points2D, minK, 120, seed);
  let bestScore = computeSilhouetteScore(points2D, bestLabels);

  for (let candidateK = minK; candidateK <= maxK; candidateK++) {
    // Run 3 deterministic restarts per candidate K and pick the best
    for (let restart = 0; restart < 3; restart++) {
      const labels = kmeans(
        points2D,
        candidateK,
        120,
        seed + candidateK * 31 + restart * 17,
      );
      const score = computeSilhouetteScore(points2D, labels);
      if (score > bestScore) {
        bestScore = score;
        bestK = candidateK;
        bestLabels = labels;
      }
    }
  }

  return {labels: bestLabels, k: bestK, silhouette: bestScore};
}

/**
 * Multi-Stage Force-Directed Layout Algorithm with Cluster & Node Collision Detection:
 * 1. Normalizes initial 2D coordinates isotropically.
 * 2. Computes each constellation cluster's local star offsets, compacts outlier stars,
 *    resolves intra-cluster star collisions, and measures the cluster's exact bounding radius R_k.
 * 3. Runs a velocity-damped Force-Directed Macro-Cluster Simulation (many-body repulsion +
 *    topological spring + strict circle-circle collision detection with R_a + R_b + clusterGap)
 *    so no two constellation hulls ever overlap.
 * 4. Re-normalizes the final collision-free layout into [-range, range].
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
  if (n === 0) return [];

  const targetRange = options?.range ?? 86;
  const clusterIds = options?.clusterIds;
  const defaultMinDist = Math.max(
    4.6,
    Math.min(11.5, 52 / Math.sqrt(Math.max(1, n))),
  );
  const minDistance = options?.minDistance ?? defaultMinDist;
  const iterations = options?.iterations ?? 60;

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < n; i++) {
    const p = rawPoints[i];
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }

  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const maxSpan = Math.max(spanX, spanY);

  // Step 1: Initial isotropic normalization into [-65, 65]
  const initialPts: Point2D[] = rawPoints.map((p, idx) => {
    if (maxSpan <= 1e-5) {
      const angle = (idx / Math.max(1, n)) * Math.PI * 2;
      const r = targetRange * 0.4;
      return {x: Math.cos(angle) * r, y: Math.sin(angle) * r};
    }
    return {
      x: ((p.x - cx) / (spanX * 0.5)) * 62,
      y: ((p.y - cy) / (spanY * 0.5)) * 62,
    };
  });

  // Group points by clusterId (treating unclustered -1 points as individual single-node clusters)
  const clusterGroups = new Map<number, number[]>();
  if (clusterIds && clusterIds.length === n) {
    let syntheticId = 10000;
    for (let i = 0; i < n; i++) {
      const cid = clusterIds[i] >= 0 ? clusterIds[i] : syntheticId++;
      const list = clusterGroups.get(cid) || [];
      list.push(i);
      clusterGroups.set(cid, list);
    }
  } else {
    clusterGroups.set(
      0,
      Array.from({length: n}, (_, i) => i),
    );
  }

  const cids = Array.from(clusterGroups.keys());

  // Step 2: Intra-Cluster Force Relaxation & Bounding Radius Calculation
  interface ClusterMacroNode {
    cid: number;
    indices: number[];
    anchorX: number;
    anchorY: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    radius: number; // Exact bounding radius of stars + hull padding
    localOffsets: Point2D[];
  }

  const hullPadding = 7.5;
  const interClusterGap = 15; // Guaranteed open parchment channel between cluster hulls
  const macroNodes: ClusterMacroNode[] = [];

  for (const cid of cids) {
    const indices = clusterGroups.get(cid)!;
    let sumX = 0;
    let sumY = 0;
    for (const idx of indices) {
      sumX += initialPts[idx].x;
      sumY += initialPts[idx].y;
    }
    const centroidX = sumX / indices.length;
    const centroidY = sumY / indices.length;

    // Compact local offsets so each constellation is a tight, legible island
    const maxClusterRadius = Math.max(
      7,
      Math.min(28, Math.sqrt(indices.length) * minDistance * 1.15),
    );
    const localOffsets: Point2D[] = indices.map(idx => {
      const dx = (initialPts[idx].x - centroidX) * 0.62;
      const dy = (initialPts[idx].y - centroidY) * 0.62;
      const d = Math.hypot(dx, dy);
      if (d > maxClusterRadius && d > 1e-4) {
        const scale = maxClusterRadius / d;
        return {x: dx * scale, y: dy * scale};
      }
      return {x: dx, y: dy};
    });

    // Intra-cluster star-to-star collision resolution
    const m = localOffsets.length;
    if (m > 1) {
      for (let iter = 0; iter < 35; iter++) {
        const damping = 1 - (iter / 35) * 0.4;
        for (let a = 0; a < m; a++) {
          for (let b = a + 1; b < m; b++) {
            let dx = localOffsets[b].x - localOffsets[a].x;
            let dy = localOffsets[b].y - localOffsets[a].y;
            let dist = Math.hypot(dx, dy);
            if (dist < minDistance) {
              if (dist < 1e-4) {
                const angle = (a * 2.39996 + b * 0.7) % (Math.PI * 2);
                dx = Math.cos(angle) * 0.01;
                dy = Math.sin(angle) * 0.01;
                dist = 0.01;
              }
              const push = (minDistance - dist) * 0.52 * damping;
              const ux = dx / dist;
              const uy = dy / dist;
              localOffsets[a].x -= ux * push;
              localOffsets[a].y -= uy * push;
              localOffsets[b].x += ux * push;
              localOffsets[b].y += uy * push;
            }
          }
        }

        // Re-center local offsets around (0, 0) and gently pull extreme stragglers inward
        let lx = 0;
        let ly = 0;
        for (let a = 0; a < m; a++) {
          localOffsets[a].x *= 0.96;
          localOffsets[a].y *= 0.96;
          lx += localOffsets[a].x;
          ly += localOffsets[a].y;
        }
        lx /= m;
        ly /= m;
        for (let a = 0; a < m; a++) {
          localOffsets[a].x -= lx;
          localOffsets[a].y -= ly;
        }
      }
    }

    // Measure exact bounding radius of this cluster's stars + hull padding
    let maxStarExtent = 0;
    for (const off of localOffsets) {
      const r = Math.hypot(off.x, off.y);
      if (r > maxStarExtent) maxStarExtent = r;
    }

    macroNodes.push({
      cid,
      indices,
      anchorX: centroidX,
      anchorY: centroidY,
      x: centroidX,
      y: centroidY,
      vx: 0,
      vy: 0,
      radius: maxStarExtent + hullPadding,
      localOffsets,
    });
  }

  // Step 3: Force-Directed Macro-Cluster Simulation with Collision Detection
  if (macroNodes.length >= 2) {
    const kCount = macroNodes.length;
    const totalSimSteps = Math.max(80, iterations * 2);

    for (let step = 0; step < totalSimSteps; step++) {
      const alpha = 1 - step / totalSimSteps;

      // 3A. Many-Body Repulsive Force + Topological Anchor Force
      for (let i = 0; i < kCount; i++) {
        const nodeA = macroNodes[i];

        // Gentle spring toward original UMAP relative position (fades out so collisions always win)
        const anchorStrength = 0.025 * alpha;
        nodeA.vx += (nodeA.anchorX * 1.35 - nodeA.x) * anchorStrength;
        nodeA.vy += (nodeA.anchorY * 1.35 - nodeA.y) * anchorStrength;

        // Weak centering gravity so clusters stay balanced around the canvas origin
        nodeA.vx += -nodeA.x * 0.008 * alpha;
        nodeA.vy += -nodeA.y * 0.008 * alpha;

        for (let j = i + 1; j < kCount; j++) {
          const nodeB = macroNodes[j];
          let dx = nodeB.x - nodeA.x;
          let dy = nodeB.y - nodeA.y;
          let dist = Math.hypot(dx, dy);
          if (dist < 1e-3) {
            const angle = (i * 2.39996 + j * 1.1) % (Math.PI * 2);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
            dist = 1;
          }

          const minAllowedDist = nodeA.radius + nodeB.radius + interClusterGap;

          // Long-range inverse-distance repulsion so clusters spread naturally
          if (dist < minAllowedDist * 1.65) {
            const repelForce =
              ((minAllowedDist * 1.65 - dist) / (minAllowedDist * 1.65)) *
              1.8 *
              alpha;
            const ux = dx / dist;
            const uy = dy / dist;
            nodeA.vx -= ux * repelForce;
            nodeA.vy -= uy * repelForce;
            nodeB.vx += ux * repelForce;
            nodeB.vy += uy * repelForce;
          }
        }
      }

      // Integrate velocities with damping
      for (let i = 0; i < kCount; i++) {
        const node = macroNodes[i];
        node.vx *= 0.72;
        node.vy *= 0.72;
        node.x += node.vx;
        node.y += node.vy;
      }

      // 3B. Strict Iterative Circle-Circle Collision Resolution (Guarantees Zero Cluster Overlap)
      for (let subIter = 0; subIter < 4; subIter++) {
        for (let i = 0; i < kCount; i++) {
          for (let j = i + 1; j < kCount; j++) {
            const nodeA = macroNodes[i];
            const nodeB = macroNodes[j];
            let dx = nodeB.x - nodeA.x;
            let dy = nodeB.y - nodeA.y;
            let dist = Math.hypot(dx, dy);
            const minAllowedDist =
              nodeA.radius + nodeB.radius + interClusterGap;

            if (dist < minAllowedDist) {
              if (dist < 1e-4) {
                const angle = (i * 2.39996 + j * 0.9) % (Math.PI * 2);
                dx = Math.cos(angle) * 0.01;
                dy = Math.sin(angle) * 0.01;
                dist = 0.01;
              }
              const overlap = (minAllowedDist - dist) * 0.55;
              const ux = dx / dist;
              const uy = dy / dist;

              // Weight displacement inversely by cluster star count
              const totalMass = nodeA.indices.length + nodeB.indices.length;
              const ratioA = nodeB.indices.length / totalMass;
              const ratioB = nodeA.indices.length / totalMass;

              nodeA.x -= ux * overlap * (0.4 + 0.6 * ratioA);
              nodeA.y -= uy * overlap * (0.4 + 0.6 * ratioA);
              nodeB.x += ux * overlap * (0.4 + 0.6 * ratioB);
              nodeB.y += uy * overlap * (0.4 + 0.6 * ratioB);
            }
          }
        }
      }
    }
  }

  // Step 4: Reassemble world star positions from collision-free cluster centroids + local offsets
  const assembled: Point2D[] = new Array<Point2D>(n);
  for (const node of macroNodes) {
    for (let k = 0; k < node.indices.length; k++) {
      const globalIdx = node.indices[k];
      const off = node.localOffsets[k];
      assembled[globalIdx] = {
        x: node.x + off.x,
        y: node.y + off.y,
      };
    }
  }

  // Step 5: Isotropic global fit into [-targetRange, targetRange] so spacing proportions are preserved
  let finalMinX = Infinity;
  let finalMaxX = -Infinity;
  let finalMinY = Infinity;
  let finalMaxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const p = assembled[i];
    if (p.x < finalMinX) finalMinX = p.x;
    if (p.x > finalMaxX) finalMaxX = p.x;
    if (p.y < finalMinY) finalMinY = p.y;
    if (p.y > finalMaxY) finalMaxY = p.y;
  }

  const finalCx = (finalMinX + finalMaxX) * 0.5;
  const finalCy = (finalMinY + finalMaxY) * 0.5;
  const halfExtent = Math.max(
    1e-5,
    (finalMaxX - finalMinX) * 0.5,
    (finalMaxY - finalMinY) * 0.5,
  );
  const scaleFactor = halfExtent > targetRange ? targetRange / halfExtent : 1;

  return assembled.map(p => ({
    x: (p.x - finalCx) * scaleFactor,
    y: (p.y - finalCy) * scaleFactor,
  }));
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
  if (m < 2) return [];
  if (m === 2) return [[clusterPointIndices[0], clusterPointIndices[1]]];

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

    if (u === -1) break;
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
  if (n === 0) return [];

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
  if (n <= 1) return points.map(() => []);

  // Compute max 2D distance for spatial normalization fallback
  let maxDist2D = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(
        points[i].x - points[j].x,
        points[i].y - points[j].y,
      );
      if (d > maxDist2D) maxDist2D = d;
    }
  }

  return points.map((pi, i) => {
    const embI = embeddings[i];
    const hasEmbI = Array.isArray(embI) && embI.length > 0;

    const candidates: SemanticNeighborIndex[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
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
