import {UMAP} from 'umap-js';
import {
  createSeededRng,
  optimalKMeans,
  normalizeAndRelaxPositions,
  computeSemanticNeighbors,
  computeSoftClusterMemberships,
  Point2D,
} from '../lib/clustering';

export interface UmapWorkerRequest {
  mode?: 'full' | 'geometryOnly';
  embeddings?: Array<number[] | undefined>;
  nNeighbors?: number;
  seed?: number;
  rawCoords?: Point2D[];
  clusterIds?: number[];
}

self.onmessage = function (e: MessageEvent<UmapWorkerRequest>) {
  const {
    mode = 'full',
    embeddings,
    nNeighbors,
    seed = 42,
    rawCoords,
    clusterIds,
  } = e.data;

  try {
    if (mode === 'geometryOnly') {
      if (!rawCoords || rawCoords.length === 0) {
        self.postMessage({
          relaxedCoords: [],
          neighborIndexLists: [],
          softMemberships: [],
        });
        return;
      }

      const relaxedCoords = normalizeAndRelaxPositions(rawCoords, {
        clusterIds,
      });
      const neighborIndexLists = computeSemanticNeighbors(
        relaxedCoords,
        embeddings || rawCoords.map(() => undefined),
        5,
      );
      const softMemberships = computeSoftClusterMemberships(
        relaxedCoords,
        clusterIds || rawCoords.map(() => 0),
        embeddings,
      );

      self.postMessage({
        relaxedCoords,
        neighborIndexLists,
        softMemberships,
      });
      return;
    }

    const validEmbeddings = (embeddings || []).filter(
      (emb): emb is number[] => Array.isArray(emb) && emb.length > 0,
    );

    if (validEmbeddings.length < 2) {
      self.postMessage({error: 'Not enough data points for UMAP'});
      return;
    }

    const rng = createSeededRng(seed);
    const effectiveNeighbors = Math.max(
      2,
      Math.min(validEmbeddings.length - 1, Math.min(40, nNeighbors || 15)),
    );
    const umap = new UMAP({
      nNeighbors: effectiveNeighbors,
      minDist: 0.24,
      spread: 1.0,
      nComponents: 2,
      nEpochs: 400,
      random: rng,
    });

    const reduced = umap.fit(validEmbeddings);
    const {labels} = optimalKMeans(reduced, seed, validEmbeddings);

    const rawPoints: Point2D[] = reduced.map(pt => ({x: pt[0], y: pt[1]}));
    const relaxedCoords = normalizeAndRelaxPositions(rawPoints, {
      clusterIds: labels,
    });
    const neighborIndexLists = computeSemanticNeighbors(
      relaxedCoords,
      validEmbeddings,
      5,
    );
    const softMemberships = computeSoftClusterMemberships(
      relaxedCoords,
      labels,
      validEmbeddings,
    );

    self.postMessage({
      reduced,
      labels,
      relaxedCoords,
      neighborIndexLists,
      softMemberships,
    });
  } catch (error) {
    self.postMessage({error: String(error)});
  }
};
