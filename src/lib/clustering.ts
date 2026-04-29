export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function dbscan(
  points: number[][],
  eps: number,
  minPts: number,
): number[] {
  const labels = new Array(points.length).fill(undefined); // undefined means unvisited
  let clusterId = 0;

  for (let i = 0; i < points.length; i++) {
    if (labels[i] !== undefined) continue;

    const neighbors = getNeighbors(points, i, eps);

    if (neighbors.length < minPts) {
      labels[i] = -1; // -1 means noise
      continue;
    }

    clusterId++;
    labels[i] = clusterId;

    // Seed set
    const seedSet = new Set(neighbors);
    seedSet.delete(i);

    for (const q of seedSet) {
      if (labels[q] === -1) {
        labels[q] = clusterId; // change noise to border point
      }
      if (labels[q] !== undefined) continue;

      labels[q] = clusterId;

      const qNeighbors = getNeighbors(points, q, eps);
      if (qNeighbors.length >= minPts) {
        for (const n of qNeighbors) {
          seedSet.add(n);
        }
      }
    }
  }

  // Normalize cluster IDs to 0-indexed (excluding noise -1)
  const uniqueClusters = Array.from(new Set(labels.filter(l => l !== -1))).sort(
    (a, b) => a - b,
  );
  const clusterMap = new Map();
  uniqueClusters.forEach((c, i) => clusterMap.set(c, i));

  return labels.map(l => (l === -1 ? -1 : clusterMap.get(l)));
}

export function kmeans(
  points: number[][],
  k: number,
  maxIterations: number = 100,
): number[] {
  if (points.length === 0) return [];
  if (k <= 0) return points.map(() => -1);
  if (k >= points.length) return points.map((_, i) => i);

  // Initialize centroids
  let centroids: number[][] = [];
  const indices = new Set<number>();
  while (indices.size < k && indices.size < points.length) {
    indices.add(Math.floor(Math.random() * points.length));
  }
  for (const idx of indices) {
    centroids.push([...points[idx]]);
  }

  const labels = new Array(points.length).fill(-1);
  let hasChanged = true;
  let iterations = 0;

  while (hasChanged && iterations < maxIterations) {
    hasChanged = false;
    iterations++;

    // Assign points to the closest centroid
    for (let i = 0; i < points.length; i++) {
      let minDistance = Infinity;
      let closestCluster = -1;

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
    const newCentroids = new Array(k)
      .fill(0)
      .map(() => new Array(points[0].length).fill(0));
    const counts = new Array(k).fill(0);

    for (let i = 0; i < points.length; i++) {
      const cluster = labels[i];
      if (cluster !== -1) {
        counts[cluster]++;
        for (let d = 0; d < points[i].length; d++) {
          newCentroids[cluster][d] += points[i][d];
        }
      }
    }

    for (let j = 0; j < k; j++) {
      if (counts[j] > 0) {
        for (let d = 0; d < newCentroids[j].length; d++) {
          newCentroids[j][d] /= counts[j];
        }
      } else {
        // Re-initialize centroid randomly if a cluster becomes empty
        const randomIdx = Math.floor(Math.random() * points.length);
        newCentroids[j] = [...points[randomIdx]];
      }
    }
    centroids = newCentroids;
  }

  return labels;
}

function getNeighbors(
  points: number[][],
  pointIdx: number,
  eps: number,
): number[] {
  const neighbors: number[] = [];
  const point = points[pointIdx];
  for (let i = 0; i < points.length; i++) {
    if (euclideanDistance(point, points[i]) <= eps) {
      neighbors.push(i);
    }
  }
  return neighbors;
}
