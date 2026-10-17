import {UMAP} from 'umap-js';
import {createSeededRng} from '../lib/clustering';

self.onmessage = function (e) {
  const {embeddings, nNeighbors, seed = 42} = e.data;

  if (!embeddings || embeddings.length < 2) {
    self.postMessage({error: 'Not enough data points for UMAP'});
    return;
  }

  try {
    const rng = createSeededRng(seed);
    const umap = new UMAP({
      nNeighbors: Math.max(2, Math.min(15, nNeighbors || 10)),
      minDist: 0.18,
      spread: 1.15,
      nComponents: 2,
      nEpochs: 400,
      random: rng,
    });

    const reduced = umap.fit(embeddings);

    self.postMessage({reduced});
  } catch (error) {
    self.postMessage({error: String(error)});
  }
};
