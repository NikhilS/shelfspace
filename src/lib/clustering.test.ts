import {describe, it, expect} from 'vitest';
import {
  createSeededRng,
  euclideanDistance,
  kmeans,
  computeSilhouetteScore,
  getOptimalClusterBounds,
  optimalKMeans,
  normalizeAndRelaxPositions,
  isLegacyIslandLayout,
  computeSoftClusterMemberships,
  computeUnifiedSemanticWeb,
  computeClusterMST,
  computePaddedConvexHull,
  computeSemanticNeighbors,
  computeCrossClusterBridges,
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

    it('scales getOptimalClusterBounds sub-linearly so 881-book libraries form 10-16 constellations rather than 3 or 100+', () => {
      expect(getOptimalClusterBounds(0)).toEqual({minK: 0, maxK: 0});
      expect(getOptimalClusterBounds(25).minK).toBeGreaterThanOrEqual(4);
      expect(getOptimalClusterBounds(60).minK).toBeGreaterThanOrEqual(5);

      const sterlingBounds = getOptimalClusterBounds(881);
      expect(sterlingBounds.minK).toBeGreaterThanOrEqual(10);
      expect(sterlingBounds.maxK).toBeLessThanOrEqual(18);
      expect(sterlingBounds.maxK).toBeGreaterThan(sterlingBounds.minK);
    });

    it('discovers 6+ constellations when clustering 36 books across 6 distinct themes with embeddings', () => {
      const centers = [
        [-90, -90],
        [-90, 90],
        [0, -90],
        [0, 90],
        [90, -90],
        [90, 90],
      ];
      const points: number[][] = [];
      const embeddings: number[][] = [];

      centers.forEach(([cx, cy], cIdx) => {
        for (let i = 0; i < 6; i++) {
          points.push([cx + (i - 2.5) * 0.8, cy + ((i % 2) - 0.5) * 0.8]);
          const emb = new Array<number>(6).fill(0.02);
          emb[cIdx] = 1;
          embeddings.push(emb);
        }
      });

      const res = optimalKMeans(points, 42, embeddings);
      expect(res.k).toBe(6);
      expect(new Set(res.labels).size).toBe(6);
    });
  });

  describe('normalizeAndRelaxPositions (continuous manifold & overlap-only de-crowding)', () => {
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

    it('unstacks degenerate centroids while preserving continuous manifold proximity within [-range, range]', () => {
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
        iterations: 50,
      });

      expect(relaxed).toHaveLength(rawPoints.length);
      for (const pt of relaxed) {
        expect(Math.abs(pt.x)).toBeLessThanOrEqual(range + 1e-4);
        expect(Math.abs(pt.y)).toBeLessThanOrEqual(range + 1e-4);
      }

      // Compute centroids of clusters 0, 1, 2 and verify they unstacked cleanly
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

      expect(Math.hypot(c0.x - c1.x, c0.y - c1.y)).toBeGreaterThan(12);
      expect(Math.hypot(c1.x - c2.x, c1.y - c2.y)).toBeGreaterThan(12);
      expect(Math.hypot(c0.x - c2.x, c0.y - c2.y)).toBeGreaterThan(12);
    });

    it('detects legacy rigid-island moats vs continuous manifold layouts', () => {
      const islandPts: Point2D[] = [];
      const continuousPts: Point2D[] = [];
      const cids: number[] = [];

      for (let i = 0; i < 12; i++) {
        const cid = i < 6 ? 0 : 1;
        cids.push(cid);
        // Island layout: cluster 0 tightly around (-60, 0), cluster 1 tightly around (60, 0)
        islandPts.push({
          x: (cid === 0 ? -60 : 60) + (i % 3) * 1.2,
          y: Math.floor(i / 3) * 1.2,
        });
        // Continuous manifold: stars span smoothly from x = -30 to x = +30
        continuousPts.push({
          x: -30 + i * 5.5,
          y: (i % 2) * 3,
        });
      }

      expect(isLegacyIslandLayout(islandPts, cids)).toBe(true);
      expect(isLegacyIslandLayout(continuousPts, cids)).toBe(false);
    });
  });

  describe('computeSoftClusterMemberships & computeUnifiedSemanticWeb', () => {
    it('assigns higher secondaryWeight to transitional boundary books than deep core books', () => {
      const points: Point2D[] = [
        {x: -40, y: 0}, // deep in cluster 0
        {x: -36, y: 2}, // deep in cluster 0
        {x: -2, y: 0}, // transitional book right on the border between cluster 0 and 1
        {x: 36, y: -2}, // deep in cluster 1
        {x: 40, y: 0}, // deep in cluster 1
      ];
      const clusterIds = [0, 0, 0, 1, 1];
      const embeddings = [
        [1, 0],
        [0.98, 0.05],
        [0.72, 0.69], // blended embedding bridging cluster 0 and cluster 1
        [0.05, 0.98],
        [0, 1],
      ];

      const memberships = computeSoftClusterMemberships(
        points,
        clusterIds,
        embeddings,
      );
      expect(memberships).toHaveLength(5);
      // Transitional border book (index 2) has strong secondary affinity to cluster 1
      expect(memberships[2].secondaryClusterId).toBe(1);
      expect(memberships[2].secondaryWeight).toBeGreaterThan(0.25);
      expect(memberships[2].secondaryWeight).toBeGreaterThan(
        memberships[0].secondaryWeight,
      );
    });

    it('builds a unified semantic web with both intra-cluster and cross-cluster filaments', () => {
      const points: Point2D[] = [
        {x: -20, y: 0},
        {x: -10, y: 2},
        {x: -2, y: 0},
        {x: 4, y: 1},
        {x: 14, y: -1},
        {x: 22, y: 0},
      ];
      const clusterIds = [0, 0, 0, 1, 1, 1];
      const neighborLists = computeSemanticNeighbors(
        points,
        points.map(() => undefined),
        3,
      );

      const web = computeUnifiedSemanticWeb(points, clusterIds, neighborLists);
      expect(web.length).toBeGreaterThanOrEqual(5);
      expect(web.some(e => !e.isCrossCluster)).toBe(true);
      expect(web.some(e => e.isCrossCluster)).toBe(true);
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

  describe('computeSemanticNeighbors & computeCrossClusterBridges', () => {
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

    it('extracts deduplicated cross-cluster bridges and prioritizes cross-genre pairs', () => {
      const clusterIds = [0, 0, 1, 1, 2];
      const neighborIndexLists = [
        [
          {index: 1, similarity: 0.92}, // same cluster (ignored)
          {index: 2, similarity: 0.81}, // cross-cluster 0 -> 1
        ],
        [{index: 0, similarity: 0.92}],
        [
          {index: 0, similarity: 0.81}, // duplicate of 0 -> 2
          {index: 4, similarity: 0.79}, // cross-cluster 1 -> 2
        ],
        [{index: 2, similarity: 0.88}],
        [{index: 2, similarity: 0.79}],
      ];

      const bridges = computeCrossClusterBridges(
        clusterIds,
        neighborIndexLists,
        {
          genres: [
            'Science Fiction',
            'Science Fiction',
            'Philosophy',
            'Philosophy',
            'History',
          ],
        },
      );

      expect(bridges).toHaveLength(2);
      expect(bridges[0]).toMatchObject({
        sourceIndex: 0,
        targetIndex: 2,
        sourceClusterId: 0,
        targetClusterId: 1,
        similarity: 0.81,
      });
      expect(bridges[1]).toMatchObject({
        sourceIndex: 2,
        targetIndex: 4,
        sourceClusterId: 1,
        targetClusterId: 2,
        similarity: 0.79,
      });
    });
  });
});
