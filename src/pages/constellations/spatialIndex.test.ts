import {describe, it, expect} from 'vitest';
import {SpatialGridIndex} from './spatialIndex';
import {ScatterPoint} from '../../hooks/useConstellationData';
import {ClusterGeometry} from './types';

function makePoint(
  id: string,
  x: number,
  y: number,
  clusterId = 0,
): ScatterPoint {
  return {
    id,
    x,
    y,
    clusterId,
    book: {
      id,
      title: `Book ${id}`,
      author: 'Author',
    },
    neighbors: [],
  };
}

describe('SpatialGridIndex', () => {
  const samplePoints: ScatterPoint[] = [
    makePoint('b1', -40, -30, 0),
    makePoint('b2', -38, -28, 0),
    makePoint('b3', 45, 50, 1),
  ];

  const sampleClusters: ClusterGeometry[] = [
    {
      clusterId: 0,
      name: 'Northern Sky',
      color: '#9A3412',
      centroid: {x: -39, y: -29},
      pointIndices: [0, 1],
      mstEdges: [[0, 1]],
      hullPoints: [],
      dominantGenres: ['Fiction'],
    },
    {
      clusterId: 1,
      name: 'Southern Cross',
      color: '#1F5D73',
      centroid: {x: 45, y: 50},
      pointIndices: [2],
      mstEdges: [],
      hullPoints: [],
      dominantGenres: ['History'],
    },
  ];

  it('queries nearest star accurately within radius and returns null outside radius', () => {
    const index = new SpatialGridIndex(samplePoints, sampleClusters, 16);

    const hit = index.queryNearestStar(-39.5, -29.5, 5);
    expect(hit).not.toBeNull();
    expect(hit?.star.id).toBe('b1');

    const miss = index.queryNearestStar(0, 0, 10);
    expect(miss).toBeNull();
  });

  it('queries star indices within a viewport bounding box', () => {
    const index = new SpatialGridIndex(samplePoints, sampleClusters, 16);
    const inBounds = index.queryStarIndicesInBounds(-45, -35, -30, -20);
    expect(inBounds.sort()).toEqual([0, 1]);
  });

  it('queries nearest constellation centroid within radius', () => {
    const index = new SpatialGridIndex(samplePoints, sampleClusters, 16);
    const clusterHit = index.queryNearestClusterCentroid(43, 48, 8);
    expect(clusterHit?.cluster.name).toBe('Southern Cross');
  });
});
