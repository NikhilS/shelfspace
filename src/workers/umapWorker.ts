import {UMAP} from 'umap-js';

self.onmessage = function (e) {
  const {embeddings, nNeighbors} = e.data;
  
  if (!embeddings || embeddings.length < 2) {
    self.postMessage({error: 'Not enough data points for UMAP'});
    return;
  }
  
  try {
    const umap = new UMAP({
      nNeighbors,
      minDist: 0.1,
      nComponents: 2,
      nEpochs: 400,
    });
    
    // We could do it sequentially and post progress:
    // const nEpochs = umap.initializeFit(embeddings);
    // for (let i = 0; i < nEpochs; i++) {
    //   umap.step();
    // }
    // const embedding = umap.getEmbedding();
    
    // For simplicity, just fit:
    const reduced = umap.fit(embeddings);
    
    self.postMessage({reduced});
  } catch (error) {
    self.postMessage({error: String(error)});
  }
};
