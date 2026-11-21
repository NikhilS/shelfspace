import type {MutableRefObject} from 'react';
import {
  type CrossClusterBridge,
  type Point2D,
  type SemanticNeighborIndex,
  type SoftClusterMembership,
  computeCrossClusterBridges,
  computeSemanticNeighbors,
  computeSoftClusterMemberships,
  normalizeAndRelaxPositions,
} from '../lib/clustering';
import {DebugTelemetryEngine} from '../lib/telemetry';
import type {
  BookDoc,
  ConstellationNeighbor,
  ScatterPoint,
} from './useConstellationData';

export interface WorkerTopologyResponse {
  reduced?: number[][];
  labels?: number[];
  relaxedCoords?: Point2D[];
  neighborIndexLists?: SemanticNeighborIndex[][];
  softMemberships?: SoftClusterMembership[];
  error?: string;
}

export interface RawScatterItem {
  rawX: number;
  rawY: number;
  book: BookDoc;
  clusterId: number;
}

export function assembleScatterPoints(
  rawItems: RawScatterItem[],
  precomputed?: {
    relaxedCoords?: Point2D[];
    neighborIndexLists?: SemanticNeighborIndex[][];
    softMemberships?: SoftClusterMembership[];
  },
): {points: ScatterPoint[]; bridges: CrossClusterBridge[]} {
  if (rawItems.length === 0) {
    return {points: [], bridges: []};
  }

  const clusterIds = rawItems.map(item => item.clusterId);
  const embeddings = rawItems.map(item => item.book.embedding);
  const relaxedCoords =
    precomputed?.relaxedCoords &&
    precomputed.relaxedCoords.length === rawItems.length
      ? precomputed.relaxedCoords
      : normalizeAndRelaxPositions(
          rawItems.map(item => ({x: item.rawX, y: item.rawY})),
          {
            clusterIds,
          },
        );

  const neighborIndexLists =
    precomputed?.neighborIndexLists &&
    precomputed.neighborIndexLists.length === rawItems.length
      ? precomputed.neighborIndexLists
      : computeSemanticNeighbors(relaxedCoords, embeddings, 5);

  const softMemberships =
    precomputed?.softMemberships &&
    precomputed.softMemberships.length === rawItems.length
      ? precomputed.softMemberships
      : computeSoftClusterMemberships(relaxedCoords, clusterIds, embeddings);

  const bridges = computeCrossClusterBridges(clusterIds, neighborIndexLists, {
    genres: rawItems.map(item => item.book.primaryGenre),
  });

  const points = rawItems.map((item, idx) => {
    const pos = relaxedCoords[idx] || {x: item.rawX, y: item.rawY};
    const soft = softMemberships[idx];
    const neighborIndices = neighborIndexLists[idx] || [];
    const neighbors: ConstellationNeighbor[] = neighborIndices
      .map((n): ConstellationNeighbor | null => {
        const target = rawItems[n.index];
        if (!target) {
          return null;
        }
        return {
          bookId: target.book.id,
          title: target.book.title,
          author: target.book.author || 'Unknown Author',
          clusterId: target.clusterId,
          similarity: n.similarity,
          coverUrl: target.book.coverUrl,
        };
      })
      .filter((n): n is ConstellationNeighbor => n !== null);

    return {
      id: item.book.id,
      x: pos.x,
      y: pos.y,
      book: item.book,
      clusterId: item.clusterId,
      secondaryClusterId:
        soft && soft.secondaryClusterId >= 0
          ? soft.secondaryClusterId
          : undefined,
      secondaryWeight:
        soft && soft.secondaryWeight > 0 ? soft.secondaryWeight : undefined,
      neighbors,
    };
  });

  return {points, bridges};
}

export function selectRepresentativeClusterSample(
  clusterPoints: ScatterPoint[],
  maxSample = 18,
): Array<{
  title: string;
  author?: string;
  primaryGenre?: string;
  synopsis?: string;
}> {
  if (clusterPoints.length === 0) {
    return [];
  }

  let sumX = 0;
  let sumY = 0;
  for (const pt of clusterPoints) {
    sumX += pt.x;
    sumY += pt.y;
  }
  const cx = sumX / clusterPoints.length;
  const cy = sumY / clusterPoints.length;

  const sortedByCentroid = [...clusterPoints].sort((a, b) => {
    const da = Math.hypot(a.x - cx, a.y - cy);
    const db = Math.hypot(b.x - cx, b.y - cy);
    return da - db;
  });

  const chosen: ScatterPoint[] = [];
  const chosenIds = new Set<string>();
  const authorCounts = new Map<string, number>();

  for (const pt of sortedByCentroid) {
    if (chosen.length >= maxSample) {
      break;
    }
    const authorKey = (pt.book.author || 'unknown').trim().toLowerCase();
    const count = authorCounts.get(authorKey) || 0;
    if (count >= 2) {
      continue;
    }
    chosen.push(pt);
    chosenIds.add(pt.id);
    authorCounts.set(authorKey, count + 1);
  }

  for (const pt of sortedByCentroid) {
    if (chosen.length >= maxSample) {
      break;
    }
    if (!chosenIds.has(pt.id)) {
      chosen.push(pt);
      chosenIds.add(pt.id);
    }
  }

  return chosen.map(pt => {
    const rawSyn = pt.book.synopsis;
    return {
      title: pt.book.title,
      author: pt.book.author,
      primaryGenre: pt.book.primaryGenre,
      synopsis:
        typeof rawSyn === 'string' && rawSyn.trim()
          ? rawSyn.replace(/\s+/g, ' ').trim().slice(0, 180)
          : undefined,
    };
  });
}

export function buildFallbackClusterTheme(
  clusterId: number,
  members: BookDoc[],
): {name: string; thesis: string} {
  const subgenreCounts = new Map<string, number>();
  const genreCounts = new Map<string, number>();

  for (const m of members) {
    const g = m.primaryGenre;
    if (g && g !== 'Unclassified') {
      genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
    }
    if (Array.isArray(m.subgenres)) {
      for (const sub of m.subgenres) {
        if (sub && sub.trim()) {
          subgenreCounts.set(
            sub.trim(),
            (subgenreCounts.get(sub.trim()) || 0) + 1,
          );
        }
      }
    }
  }

  const topSubgenres = Array.from(subgenreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([s]) => s);
  const topGenres = Array.from(genreCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([g]) => g);

  const name =
    topSubgenres.length >= 2
      ? `${topSubgenres[0]} & ${topSubgenres[1]}`
      : topSubgenres.length === 1
        ? `${topSubgenres[0]} Currents`
        : topGenres.length >= 2
          ? `${topGenres[0]} & ${topGenres[1]} Crossroads`
          : `Constellation ${clusterId + 1}`;

  const sampleTitles = members
    .slice(0, 2)
    .map(m => `"${m.title}"`)
    .filter(Boolean);
  const thesis =
    topSubgenres.length > 0 && topGenres.length > 0
      ? `Unites ${members.length} volumes through shared ${topSubgenres.join(' and ').toLowerCase()} motifs across ${topGenres.join(' and ')}.`
      : sampleTitles.length >= 2
        ? `Connects ${sampleTitles.join(' and ')} alongside kindred works sharing narrative tone and thematic resonance.`
        : `A thematic constellation of ${members.length} kindred works grouped by semantic similarity.`;

  return {name, thesis};
}

export async function runConstellationWorkerGeometryOnly(
  rawItems: RawScatterItem[],
  activeWorkerRef: MutableRefObject<Worker | null>,
): Promise<{points: ScatterPoint[]; bridges: CrossClusterBridge[]}> {
  if (typeof Worker === 'undefined') {
    return assembleScatterPoints(rawItems);
  }

  try {
    const workerRes = await new Promise<WorkerTopologyResponse>(
      (resolve, reject) => {
        const worker = new Worker(
          new URL('../workers/umap.worker.ts', import.meta.url),
          {type: 'module'},
        );
        activeWorkerRef.current = worker;
        worker.onmessage = (e: MessageEvent<WorkerTopologyResponse>) => {
          worker.terminate();
          activeWorkerRef.current = null;
          if (e.data.error) {
            reject(new Error(e.data.error));
          } else {
            resolve(e.data);
          }
        };
        worker.onerror = err => {
          worker.terminate();
          activeWorkerRef.current = null;
          reject(new Error(err.message || 'UMAP geometry worker failed'));
        };
        worker.postMessage({
          mode: 'geometryOnly',
          rawCoords: rawItems.map(item => ({x: item.rawX, y: item.rawY})),
          clusterIds: rawItems.map(item => item.clusterId),
          embeddings: rawItems.map(item => item.book.embedding),
        });
      },
    );

    return assembleScatterPoints(rawItems, {
      relaxedCoords: workerRes.relaxedCoords,
      neighborIndexLists: workerRes.neighborIndexLists,
      softMemberships: workerRes.softMemberships,
    });
  } catch {
    return assembleScatterPoints(rawItems);
  }
}

export async function runConstellationWorkerFullTopology(params: {
  embeddingData: number[][];
  nNeighbors: number;
  umapSeed: number;
  activeWorkerRef: MutableRefObject<Worker | null>;
}): Promise<WorkerTopologyResponse> {
  const {embeddingData, nNeighbors, umapSeed, activeWorkerRef} = params;
  return new Promise<WorkerTopologyResponse>((resolve, reject) => {
    try {
      if (typeof Worker !== 'undefined') {
        const workerStart = performance.now();
        if (DebugTelemetryEngine.isHudActive()) {
          DebugTelemetryEngine.getInstance().addLog(
            'worker',
            `[Constellation] Spawned UMAP Web Worker (${embeddingData.length} embeddings, nNeighbors=${nNeighbors})`,
            {activeCount: 1, count: embeddingData.length, nNeighbors},
            {scope: 'Constellation'},
          );
        }
        const worker = new Worker(
          new URL('../workers/umap.worker.ts', import.meta.url),
          {type: 'module'},
        );
        activeWorkerRef.current = worker;
        worker.onmessage = (e: MessageEvent<WorkerTopologyResponse>) => {
          worker.terminate();
          activeWorkerRef.current = null;
          const durationMs = Math.round(performance.now() - workerStart);
          if (DebugTelemetryEngine.isHudActive()) {
            DebugTelemetryEngine.getInstance().addLog(
              'worker',
              `[Constellation] UMAP Web Worker completed (${durationMs}ms)`,
              {activeCount: 0, durationMs, count: embeddingData.length},
              {scope: 'Constellation', durationMs, status: 'ok'},
            );
          }
          if (e.data.error) {
            reject(new Error(e.data.error));
          } else if (e.data.reduced) {
            resolve(e.data);
          } else {
            reject(new Error('Invalid response from UMAP worker'));
          }
        };
        worker.onerror = err => {
          worker.terminate();
          activeWorkerRef.current = null;
          if (DebugTelemetryEngine.isHudActive()) {
            DebugTelemetryEngine.getInstance().addLog(
              'worker',
              '[Constellation] UMAP Web Worker error',
              {activeCount: 0},
              {scope: 'Constellation', status: 'error'},
            );
          }
          reject(new Error(err.message || 'UMAP Web Worker error'));
        };
        worker.postMessage({
          mode: 'full',
          embeddings: embeddingData,
          nNeighbors,
          seed: umapSeed,
        });
      } else {
        import('umap-js')
          .then(({UMAP}) => {
            const umap = new UMAP({
              nNeighbors,
              minDist: 0.24,
              spread: 1.0,
              nComponents: 2,
              nEpochs: 400,
            });
            resolve({reduced: umap.fit(embeddingData)});
          })
          .catch(reject);
      }
    } catch {
      import('umap-js')
        .then(({UMAP}) => {
          const umap = new UMAP({
            nNeighbors,
            minDist: 0.24,
            spread: 1.0,
            nComponents: 2,
            nEpochs: 400,
          });
          resolve({reduced: umap.fit(embeddingData)});
        })
        .catch(reject);
    }
  });
}
