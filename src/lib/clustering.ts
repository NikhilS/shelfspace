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
