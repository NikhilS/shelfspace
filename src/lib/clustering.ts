function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
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
