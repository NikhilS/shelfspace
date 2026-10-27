import {ScatterPoint} from '../../hooks/useConstellationData';
import {ClusterGeometry} from './types';

export interface StarHitResult {
  star: ScatterPoint;
  index: number;
  distanceWorld: number;
}

export interface ClusterHitResult {
  cluster: ClusterGeometry;
  distanceWorld: number;
}

/**
 * O(1) 2D Spatial Grid Index for fast star hit-testing, viewport frustum culling,
 * and constellation territory centroid lookup on 1,000+ volume libraries.
 */
export class SpatialGridIndex {
  private readonly cellSize: number;
  private readonly buckets = new Map<string, number[]>();
  private readonly points: ScatterPoint[];
  private readonly clusters: ClusterGeometry[];

  constructor(
    points: ScatterPoint[],
    clusters: ClusterGeometry[] = [],
    cellSize = 16,
  ) {
    this.points = points;
    this.clusters = clusters;
    this.cellSize = Math.max(4, cellSize);

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const key = this.getCellKey(pt.x, pt.y);
      const bucket = this.buckets.get(key);
      if (bucket) {
        bucket.push(i);
      } else {
        this.buckets.set(key, [i]);
      }
    }
  }

  private getCellCoords(x: number, y: number): [number, number] {
    return [Math.floor(x / this.cellSize), Math.floor(y / this.cellSize)];
  }

  private getCellKey(x: number, y: number): string {
    const [cx, cy] = this.getCellCoords(x, y);
    return `${cx}:${cy}`;
  }

  /**
   * Finds the closest book star within `maxWorldRadius` of `(worldX, worldY)`.
   */
  queryNearestStar(
    worldX: number,
    worldY: number,
    maxWorldRadius: number,
  ): StarHitResult | null {
    if (this.points.length === 0 || maxWorldRadius <= 0) {
      return null;
    }

    const [minCx, minCy] = this.getCellCoords(
      worldX - maxWorldRadius,
      worldY - maxWorldRadius,
    );
    const [maxCx, maxCy] = this.getCellCoords(
      worldX + maxWorldRadius,
      worldY + maxWorldRadius,
    );

    let bestIdx = -1;
    let bestDist = maxWorldRadius;

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(`${cx}:${cy}`);
        if (!bucket) {
          continue;
        }
        for (const idx of bucket) {
          const pt = this.points[idx];
          const d = Math.hypot(pt.x - worldX, pt.y - worldY);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = idx;
          }
        }
      }
    }

    if (bestIdx === -1) {
      return null;
    }

    return {
      star: this.points[bestIdx],
      index: bestIdx,
      distanceWorld: bestDist,
    };
  }

  /**
   * Returns all star indices whose world coordinates fall inside `[minX, maxX] x [minY, maxY]`.
   */
  queryStarIndicesInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): number[] {
    if (this.points.length === 0) {
      return [];
    }

    const [minCx, minCy] = this.getCellCoords(minX, minY);
    const [maxCx, maxCy] = this.getCellCoords(maxX, maxY);
    const indices: number[] = [];

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const bucket = this.buckets.get(`${cx}:${cy}`);
        if (!bucket) {
          continue;
        }
        for (const idx of bucket) {
          const pt = this.points[idx];
          if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
            indices.push(idx);
          }
        }
      }
    }

    return indices;
  }

  /**
   * Finds the nearest constellation centroid within `maxWorldRadius`.
   */
  queryNearestClusterCentroid(
    worldX: number,
    worldY: number,
    maxWorldRadius: number,
  ): ClusterHitResult | null {
    let bestCluster: ClusterGeometry | null = null;
    let bestDist = maxWorldRadius;

    for (const cluster of this.clusters) {
      const d = Math.hypot(
        cluster.centroid.x - worldX,
        cluster.centroid.y - worldY,
      );
      if (d < bestDist) {
        bestDist = d;
        bestCluster = cluster;
      }
    }

    if (!bestCluster) {
      return null;
    }

    return {
      cluster: bestCluster,
      distanceWorld: bestDist,
    };
  }
}
