import {describe, it, expect} from 'vitest';
import {
  createSeededRng,
  euclideanDistance,
  kmeans,
  computeSilhouetteScore,
  optimalKMeans,
  normalizeAndRelaxPositions,
  computeClusterMST,
  computePaddedConvexHull,
  computeSemanticNeighbors,
  Point2D,
} from './clustering';

describe('clustering & constellation geometry engine', () => {
  describe('createSeededRng & euclideanDistance', () => {
    it('produces deterministic, repeatable sequences in [0, 1) for the same seed', () => {
      const rngA = createSeededRng(42);
      const rngB = createSeededRng(42);
      const rngC = createSeededRng(99);

      const seqA = Array.from({length: 10}, () => rngA());
      const seqB = Array.from({length: 10}, () => rngB());
      const seqC = Array.from({length: 10}, () => rngC());

      expect(seqA).toEqual(seqB);
      expect(seqA).not.toEqual(seqC);
      for (const val of seqA) {
        expect(val).toBeGreaterThanOrEqual(0);
        expect(val).toBeLessThan(1);
      }
    });

    it('computes exact Euclidean distances across dimensions and handles mismatched lengths', () => {
      expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
      expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
      expect(euclideanDistance([0, 0, 10], [3, 4])).toBe(5);
    });
  });

  describe('kmeans & empty-cluster recovery', () => {
    it('handles edge cases: empty input, k <= 0, k >= n, and identical points', () => {
      expect(kmeans([], 3)).toEqual([]);
      expect(
        kmeans(
          [
            [1, 2],
            [3, 4],
          ],
          0,
        ),
      ).toEqual([-1, -1]);
      expect(
        kmeans(
          [
            [1, 2],
            [3, 4],
          ],
          5,
        ),
      ).toEqual([0, 1]);

      const identical = [
        [5, 5],
        [5, 5],
        [5, 5],
        [5, 5],
      ];
      const labels = kmeans(identical, 2, 50, 42);
      expect(labels).toHaveLength(4);
      labels.forEach(l => {
        expect(l).toBeGreaterThanOrEqual(0);
        expect(l).toBeLessThan(2);
      });
    });

    it('deterministically separates well-isolated 2D clusters', () => {
      const points = [
        [-50, -50],
        [-51, -49],
        [-49, -51],
        [50, 50],
        [51, 49],
        [49, 51],
      ];
      const labelsA = kmeans(points, 2, 100, 1337);
      const labelsB = kmeans(points, 2, 100, 1337);

      expect(labelsA).toEqual(labelsB);
      expect(labelsA[0]).toBe(labelsA[1]);
      expect(labelsA[1]).toBe(labelsA[2]);
      expect(labelsA[3]).toBe(labelsA[4]);
      expect(labelsA[4]).toBe(labelsA[5]);
      expect(labelsA[0]).not.toBe(labelsA[3]);
    });

    it('recovers when duplicate coordinates cause an empty cluster during assignment', () => {
      const points = [
        [0, 0],
        [0, 0],
        [0, 0],
        [10, 10],
        [100, 100],
      ];
      const labels = kmeans(points, 3, 50, 7);
      expect(labels).toHaveLength(5);
      expect(new Set(labels).size).toBe(3);
    });
  });

  describe('computeSilhouetteScore & optimalKMeans', () => {
    it('returns boundary defaults for tiny datasets or degenerate cluster counts', () => {
      expect(
        computeSilhouetteScore(
          [
            [0, 0],
            [1, 1],
          ],
          [0, 1],
        ),
      ).toBe(0);
      expect(
        computeSilhouetteScore(
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
          [0, 0, 0],
        ),
      ).toBe(-1);
      expect(
        computeSilhouetteScore(
          [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
          [0, 1, 2],
        ),
      ).toBe(-1);
    });

    it('computes high silhouette score (> 0.85) for well-separated clusters and lower score for mixed labels', () => {
      const points = [
        [0, 0],
        [0, 1],
        [1, 0],
        [100, 100],
        [100, 101],
        [101, 100],
      ];
      const goodScore = computeSilhouetteScore(points, [0, 0, 0, 1, 1, 1]);
      const badScore = computeSilhouetteScore(points, [0, 1, 0, 1, 0, 1]);

      expect(goodScore).toBeGreaterThan(0.85);
      expect(goodScore).toBeLessThanOrEqual(1);
      expect(badScore).toBeLessThan(0.2);
      expect(badScore).toBeGreaterThanOrEqual(-1);
    });

    it('selects optimal K automatically across synthetic multi-cluster datasets', () => {
      expect(optimalKMeans([])).toEqual({labels: [], k: 0, silhouette: 0});
      expect(
        optimalKMeans([
          [0, 0],
          [1, 1],
        ]).k,
      ).toBe(2);

      // 3 well-separated clusters of 5 points each (15 points total)
      const clusterCenters = [
        [-80, -80],
        [0, 80],
        [80, -80],
      ];
      const points: number[][] = [];
      for (const [cx, cy] of clusterCenters) {
        for (let i = 0; i < 5; i++) {
          points.push([cx + (i - 2) * 0.5, cy + ((i % 2) - 0.5) * 0.5]);
        }
      }

      const result = optimalKMeans(points, 42);
      expect(result.k).toBe(3);
      expect(result.silhouette).toBeGreaterThan(0.8);
      expect(result.labels).toHaveLength(15);
    });
  });

  describe('normalizeAndRelaxPositions (force-directed layout & collision detection)', () => {
    it('handles empty and degenerate zero-span points', () => {
      expect(normalizeAndRelaxPositions([])).toEqual([]);

      const identicalPoints: Point2D[] = [
        {x: 10, y: 10},
        {x: 10, y: 10},
        {x: 10, y: 10},
      ];
      const relaxed = normalizeAndRelaxPositions(identicalPoints, {
        range: 80,
        clusterIds: [0, 0, 0],
      });
      expect(relaxed).toHaveLength(3);
      for (const pt of relaxed) {
        expect(Number.isFinite(pt.x)).toBe(true);
        expect(Number.isFinite(pt.y)).toBe(true);
        expect(Math.abs(pt.x)).toBeLessThanOrEqual(80.001);
        expect(Math.abs(pt.y)).toBeLessThanOrEqual(80.001);
      }
    });

    it('guarantees non-overlapping cluster centroids and fits output within [-range, range]', () => {
      // Three clusters initially stacked right on top of each other at (0, 0)
      const rawPoints: Point2D[] = [];
      const clusterIds: number[] = [];
      for (let c = 0; c < 3; c++) {
        for (let i = 0; i < 4; i++) {
          rawPoints.push({
            x: (c - 1) * 0.2 + i * 0.05,
            y: (c - 1) * 0.2 - i * 0.05,
          });
          clusterIds.push(c);
        }
      }
      // Also include an unclustered (-1) node
      rawPoints.push({x: 0, y: 0});
      clusterIds.push(-1);

      const range = 86;
      const relaxed = normalizeAndRelaxPositions(rawPoints, {
        range,
        clusterIds,
        iterations: 60,
      });

      expect(relaxed).toHaveLength(rawPoints.length);
      for (const pt of relaxed) {
        expect(Math.abs(pt.x)).toBeLessThanOrEqual(range + 1e-4);
        expect(Math.abs(pt.y)).toBeLessThanOrEqual(range + 1e-4);
      }

      // Compute centroids of clusters 0, 1, 2 and verify they pushed apart significantly
      const getCentroid = (cid: number): Point2D => {
        const pts = relaxed.filter((_, idx) => clusterIds[idx] === cid);
        return {
          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        };
      };

      const c0 = getCentroid(0);
      const c1 = getCentroid(1);
      const c2 = getCentroid(2);

      expect(Math.hypot(c0.x - c1.x, c0.y - c1.y)).toBeGreaterThan(15);
      expect(Math.hypot(c1.x - c2.x, c1.y - c2.y)).toBeGreaterThan(15);
      expect(Math.hypot(c0.x - c2.x, c0.y - c2.y)).toBeGreaterThan(15);
    });
  });

  describe('computeClusterMST', () => {
    it('handles < 2 points, 2 points, and prunes extreme outlier bridges in >= 5 star clusters', () => {
      const pts: Point2D[] = [
        {x: 0, y: 0},
        {x: 2, y: 0},
        {x: 4, y: 0},
        {x: 6, y: 0},
        {x: 500, y: 500}, // extreme outlier star
      ];

      expect(computeClusterMST(pts, [])).toEqual([]);
      expect(computeClusterMST(pts, [0])).toEqual([]);
      expect(computeClusterMST(pts, [0, 1])).toEqual([[0, 1]]);

      const edges = computeClusterMST(pts, [0, 1, 2, 3, 4]);
      // The 3 short edges (length 2) are preserved; the 4th bridge edge (~700 length) exceeds max(38, median * 2.6) and is pruned
      expect(edges).toHaveLength(3);
      for (const [u, v] of edges) {
        expect(u).not.toBe(4);
        expect(v).not.toBe(4);
      }
    });
  });

  describe('computePaddedConvexHull', () => {
    it('generates 0 points for empty input, 8-point halo for 1 star, 6-point capsule for 2 stars, and convex hull for >= 3 stars', () => {
      expect(computePaddedConvexHull([])).toEqual([]);

      const halo = computePaddedConvexHull([{x: 10, y: 20}], 5);
      expect(halo).toHaveLength(8);
      for (const pt of halo) {
        expect(Math.hypot(pt.x - 10, pt.y - 20)).toBeCloseTo(5, 5);
      }

      const capsule = computePaddedConvexHull(
        [
          {x: 0, y: 0},
          {x: 10, y: 0},
        ],
        4,
      );
      expect(capsule).toHaveLength(6);

      // Collinear 3 stars still produce a non-degenerate > 4 vertex hull due to hexagonal support points
      const collinearHull = computePaddedConvexHull(
        [
          {x: 0, y: 0},
          {x: 5, y: 0},
          {x: 10, y: 0},
        ],
        5,
      );
      expect(collinearHull.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('computeSemanticNeighbors', () => {
    it('blends high-dimensional cosine similarity with 2D spatial proximity and respects topK', () => {
      expect(computeSemanticNeighbors([{x: 0, y: 0}], [undefined])).toEqual([
        [],
      ]);

      const points: Point2D[] = [
        {x: 0, y: 0},
        {x: 2, y: 0},
        {x: 50, y: 0},
      ];
      const embeddings = [
        [1, 0, 0],
        [0, 1, 0], // orthogonal embedding, though close spatially
        [0.99, 0.01, 0], // nearly identical embedding to index 0
      ];

      const neighbors = computeSemanticNeighbors(points, embeddings, 2);
      expect(neighbors).toHaveLength(3);
      expect(neighbors[0]).toHaveLength(2);
      // Point 2 has much higher embedding cosine similarity to Point 0 than Point 1
      expect(neighbors[0][0].index).toBe(2);
      expect(neighbors[0][0].similarity).toBeGreaterThan(
        neighbors[0][1].similarity,
      );
    });
  });
});
