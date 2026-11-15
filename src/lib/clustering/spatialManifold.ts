import type {Point2D, SoftClusterMembership} from './types';

/**
 * Continuous Manifold Layout & Overlap-Only De-Crowding:
 * 1. Normalizes raw 2D UMAP coordinates isotropically so the global and local manifold
 *    topology (including smooth transitional zones between clusters) is preserved.
 * 2. Gently unstacks degenerate identical centroids if multiple clusters were initialized
 *    at the exact same coordinate.
 * 3. Runs a velocity-free, deterministic point-to-point overlap resolution pass anchored
 *    by a gentle topological spring to each point's natural UMAP coordinate.
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

  if (n > 1) {
    for (let step = 0; step < iterations; step++) {
      const alpha = 1 - step / iterations;
      const springStrength = 0.09 * alpha;

      for (let i = 0; i < n; i++) {
        pts[i].x += (anchors[i].x - pts[i].x) * springStrength;
        pts[i].y += (anchors[i].y - pts[i].y) * springStrength;
      }

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
 * rigid-island layout vs. a continuous semantic manifold where adjacent clusters touch.
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
      } else if (d < minCross) {
        minCross = d;
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

  return decileCross > Math.max(9.5, medianSame * 3.1);
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
    const rawWeight =
      ratio <= 0.7 ? 0 : Math.min(0.5, ((ratio - 0.7) / 0.3) * 0.5);

    return {
      primaryClusterId: primaryCid,
      secondaryClusterId: rawWeight >= 0.08 ? bestSecondaryCid : -1,
      secondaryWeight: Number(rawWeight.toFixed(3)),
    };
  });
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
  padding = 6.5,
): Point2D[] {
  const n = clusterPoints.length;
  if (n === 0) {
    return [];
  }

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
