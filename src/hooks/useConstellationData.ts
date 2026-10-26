import {useState, useEffect, useRef} from 'react';
import {
  Point2D,
  SemanticNeighborIndex,
  CrossClusterBridge,
  SoftClusterMembership,
  optimalKMeans,
  getOptimalClusterBounds,
  normalizeAndRelaxPositions,
  computeSemanticNeighbors,
  computeCrossClusterBridges,
  computeSoftClusterMemberships,
  isLegacyIslandLayout,
} from '../lib/clustering';
import {trpc, trpcVanilla} from '../lib/trpc';
import {useCollectionScope} from './useCollectionScope';
import {useAppPermissions} from './useAppPermissions';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {BookDetails, BookDetailsMetadata} from '../types';

export interface BookDoc extends Omit<
  BookDetails,
  'isbn' | 'coverUrl' | 'publishedDate'
> {
  id: string;
  libraryId?: string;
  libraryName?: string;
  isbn?: string;
  coverUrl?: string;
  publishedDate?: string;
  pageCount?: number;
  embedding?: number[];
  clusterCoordinates?: {
    x: number;
    y: number;
    clusterId?: number;
    clusterName?: string;
    clusterThesis?: string;
  };
  bookDetailsMetadata?: BookDetailsMetadata;
}

export interface ConstellationNeighbor {
  bookId: string;
  title: string;
  author: string;
  clusterId: number;
  similarity: number;
  coverUrl?: string;
}

export interface ScatterPoint {
  id: string;
  x: number;
  y: number;
  book: BookDoc;
  clusterId: number;
  secondaryClusterId?: number;
  secondaryWeight?: number;
  neighbors: ConstellationNeighbor[];
}

interface WorkerTopologyResponse {
  reduced?: number[][];
  labels?: number[];
  relaxedCoords?: Point2D[];
  neighborIndexLists?: SemanticNeighborIndex[][];
  softMemberships?: SoftClusterMembership[];
  error?: string;
}

function assembleScatterPoints(
  rawItems: Array<{
    rawX: number;
    rawY: number;
    book: BookDoc;
    clusterId: number;
  }>,
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

function selectRepresentativeClusterSample(
  clusterPoints: ScatterPoint[],
  maxSample: number = 18,
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

  // First pass: up to 2 books per author, prioritizing books closest to the constellation core
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

  // Second pass: fill remaining sample slots if needed
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
    const rawSyn = pt.book.synopsis || pt.book.description;
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

function buildFallbackClusterTheme(
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

export function useConstellationData(libraryId: string | undefined) {
  const {
    isReadingMode,
    books: libraryBooks,
    isBooksLoading,
    canEdit,
    includeWantToRead,
    setIncludeWantToRead,
    readAndReadingCount,
    wantToReadCount,
  } = useCollectionScope(libraryId);
  const {hasAiPlan} = useAppPermissions();
  const canRunAiEnrichment = Boolean((canEdit || isReadingMode) && hasAiPlan);

  const [, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<string>('Loading books...');
  const [plotData, setPlotData] = useState<ScatterPoint[]>([]);
  const [clusterNames, setClusterNames] = useState<Record<number, string>>({});
  const [clusterTheses, setClusterTheses] = useState<Record<number, string>>(
    {},
  );
  const [crossClusterBridges, setCrossClusterBridges] = useState<
    CrossClusterBridge[]
  >([]);
  const [reclusterTrigger, setReclusterTrigger] = useState(0);
  const activeWorkerRef = useRef<Worker | null>(null);

  const generateClusterThemesMutation =
    trpc.gemini.generateClusterThemes.useMutation();

  useEffect(() => {
    let isMounted = true;

    async function runWorkerGeometryOnly(
      rawItems: Array<{
        rawX: number;
        rawY: number;
        book: BookDoc;
        clusterId: number;
      }>,
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
              reject(err);
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

    async function processMap() {
      if (!libraryId && !isReadingMode) {
        return;
      }

      if (isBooksLoading) {
        setLoading(true);
        setProgress('Loading books...');
        return;
      }

      if (!libraryBooks || libraryBooks.length < 3) {
        setBooks([]);
        setPlotData([]);
        setProgress(
          'Constellations connect books with kindred themes. Track or add at least 3 books to chart your literary sky.',
        );
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setProgress('Fetching book details...');

        // Group books by their source libraryId and query bookDetails in chunks of 250
        const detailsMap = new Map<string, Record<string, unknown>>();
        const chunkSize = 250;
        const chunks: Array<{targetLibId: string; items: typeof libraryBooks}> =
          [];

        const booksByLib = new Map<string, typeof libraryBooks>();
        for (const book of libraryBooks) {
          const targetLibId = book.libraryId || libraryId;
          if (!targetLibId) {
            continue;
          }
          const list = booksByLib.get(targetLibId) || [];
          list.push(book);
          booksByLib.set(targetLibId, list);
        }

        for (const [targetLibId, items] of booksByLib.entries()) {
          for (let i = 0; i < items.length; i += chunkSize) {
            chunks.push({
              targetLibId,
              items: items.slice(i, i + chunkSize),
            });
          }
        }

        let completedCount = 0;
        const isTelemetryActive = DebugTelemetryEngine.isHudActive();

        await Promise.all(
          chunks.map(async ({targetLibId, items: chunk}) => {
            const res = await trpcVanilla.book.getBookDetailsChunk.mutate({
              libraryId: targetLibId,
              bookIds: chunk.map(b => b.id),
            });

            let chunkBytes = 0;
            let docCount = 0;
            if (res?.details) {
              for (const [id, data] of Object.entries(res.details)) {
                detailsMap.set(`${targetLibId}:${id}`, data);
                detailsMap.set(id, data);
                if (isTelemetryActive) {
                  chunkBytes += calculatePayloadBytes(data);
                }
                docCount++;
              }
            }

            completedCount += chunk.length;
            if (isMounted) {
              setProgress(
                `Fetching book details (${Math.min(completedCount, libraryBooks.length)}/${libraryBooks.length})...`,
              );
            }

            if (isTelemetryActive) {
              DebugTelemetryEngine.getInstance().addLog(
                'db_read',
                `Queried bookDetails chunk (${chunk.length} docs, ${(chunkBytes / 1024).toFixed(1)} KB)`,
                {
                  path: `libraries/${targetLibId}/bookDetails`,
                  size: chunk.length,
                  bytes: chunkBytes,
                  docCount,
                },
              );
            }
          }),
        );

        const allBooks: BookDoc[] = [];
        libraryBooks.forEach(b => {
          const targetLibId = b.libraryId || libraryId || '';
          const detail =
            detailsMap.get(`${targetLibId}:${b.id}`) ||
            detailsMap.get(b.id) ||
            {};
          const merged = {
            ...b,
            ...detail,
            id: b.id,
            libraryId: targetLibId || b.libraryId,
          };
          allBooks.push(merged as BookDoc);
        });

        if (!isMounted) {
          return;
        }
        setBooks(allBooks);

        if (allBooks.length < 3) {
          setPlotData([]);
          setProgress(
            'Constellations connect books with kindred themes. Track or add at least 3 books to chart your literary sky.',
          );
          setLoading(false);
          return;
        }

        // Fast-path: In single-library mode, if every book already has persisted clusterCoordinates
        // that meet the collection's minimum cluster granularity, form a continuous manifold (not legacy island moats),
        // and include curatorial theses when AI is enabled, relax positions and compute nearest-neighbor graph in the Web Worker.
        const {minK} = getOptimalClusterBounds(allBooks.length);
        const savedClusterIds = new Set(
          allBooks
            .map(b => b.clusterCoordinates?.clusterId)
            .filter(
              (cid): cid is number => typeof cid === 'number' && cid >= 0,
            ),
        );
        const hasSavedTheses = allBooks.some(b =>
          Boolean(b.clusterCoordinates?.clusterThesis?.trim()),
        );
        const hasEnoughEmbeddings =
          allBooks.filter(b => b.embedding && b.embedding.length > 0).length >=
          3;
        const everyBookHasSavedCoords = allBooks.every(
          b =>
            b.clusterCoordinates &&
            typeof b.clusterCoordinates.x === 'number' &&
            typeof b.clusterCoordinates.y === 'number' &&
            typeof b.clusterCoordinates.clusterId === 'number',
        );
        const savedLayoutHasIslandMoats =
          everyBookHasSavedCoords &&
          hasEnoughEmbeddings &&
          isLegacyIslandLayout(
            allBooks.map(b => ({
              x: b.clusterCoordinates!.x,
              y: b.clusterCoordinates!.y,
            })),
            allBooks.map(b => b.clusterCoordinates!.clusterId ?? 0),
          );
        const isSavedLayoutUpToDate =
          savedClusterIds.size >= minK &&
          !savedLayoutHasIslandMoats &&
          (!canRunAiEnrichment || hasSavedTheses);

        const allHaveSavedClusters =
          !isReadingMode &&
          reclusterTrigger === 0 &&
          (isSavedLayoutUpToDate ||
            (!hasEnoughEmbeddings && !canRunAiEnrichment)) &&
          everyBookHasSavedCoords;

        if (allHaveSavedClusters) {
          const cachedNames: Record<number, string> = {};
          const cachedTheses: Record<number, string> = {};
          const groupedByCid: Record<number, BookDoc[]> = {};

          const rawItems = allBooks.map(book => {
            const coords = book.clusterCoordinates!;
            const cid = coords.clusterId ?? 0;
            if (coords.clusterName) {
              cachedNames[cid] = coords.clusterName;
            }
            if (coords.clusterThesis) {
              cachedTheses[cid] = coords.clusterThesis;
            }
            if (cid >= 0) {
              if (!groupedByCid[cid]) {
                groupedByCid[cid] = [];
              }
              groupedByCid[cid].push(book);
            }
            return {
              rawX: coords.x,
              rawY: coords.y,
              book,
              clusterId: cid,
            };
          });

          for (const [cidStr, members] of Object.entries(groupedByCid)) {
            const cid = Number(cidStr);
            if (!cachedTheses[cid]) {
              cachedTheses[cid] = buildFallbackClusterTheme(
                cid,
                members,
              ).thesis;
            }
          }

          if (Object.keys(cachedNames).length > 0 && isMounted) {
            const {points: cachedPlotData, bridges: cachedBridges} =
              await runWorkerGeometryOnly(rawItems);
            if (!isMounted) {
              return;
            }
            setClusterNames(cachedNames);
            setClusterTheses(cachedTheses);
            setCrossClusterBridges(cachedBridges);
            setPlotData(cachedPlotData);
            setLoading(false);
            return;
          }
        }

        const toEmbed = allBooks.filter(
          b => !b.embedding || b.embedding.length === 0,
        );

        if (toEmbed.length > 0 && canRunAiEnrichment) {
          setProgress(
            `Generating AI embeddings for ${toEmbed.length} books on server...`,
          );

          const toEmbedByLib = new Map<string, BookDoc[]>();
          for (const b of toEmbed) {
            const targetLibId = b.libraryId || libraryId;
            if (!targetLibId) {
              continue;
            }
            const list = toEmbedByLib.get(targetLibId) || [];
            list.push(b);
            toEmbedByLib.set(targetLibId, list);
          }

          await Promise.all(
            Array.from(toEmbedByLib.entries()).map(
              async ([targetLibId, booksGroup]) => {
                try {
                  const ENRICH_BATCH_SIZE = 100;
                  for (
                    let i = 0;
                    i < booksGroup.length;
                    i += ENRICH_BATCH_SIZE
                  ) {
                    const enrichSlice = booksGroup.slice(
                      i,
                      i + ENRICH_BATCH_SIZE,
                    );
                    await trpcVanilla.enrichment.trigger.mutate({
                      libraryId: targetLibId,
                      enrichmentType: 'embedding',
                      bookIds: enrichSlice.map(b => b.id),
                      overwrite: false,
                    });
                  }

                  for (let i = 0; i < booksGroup.length; i += chunkSize) {
                    const detailSlice = booksGroup.slice(i, i + chunkSize);
                    const refreshedDetails =
                      await trpcVanilla.book.getBookDetailsChunk.mutate({
                        libraryId: targetLibId,
                        bookIds: detailSlice.map(b => b.id),
                      });

                    if (refreshedDetails?.details) {
                      for (const b of detailSlice) {
                        const detail = refreshedDetails.details[b.id];
                        if (detail?.embedding) {
                          b.embedding = detail.embedding;
                        }
                      }
                    }
                  }
                } catch {
                  // Ignore enrichment errors on read-only shared libraries
                }
              },
            ),
          );
        }

        const validBooks = allBooks.filter(
          b => b.embedding && b.embedding.length > 0,
        );
        if (validBooks.length < 3) {
          setProgress(
            'We need at least 3 analyzed books to chart your constellations.',
          );
          setLoading(false);
          return;
        }

        const nNeighbors = Math.min(
          40,
          Math.max(
            5,
            Math.min(
              validBooks.length - 1,
              Math.round(Math.sqrt(validBooks.length) * 1.35),
            ),
          ),
        );
        const embeddingData = validBooks.map(b => b.embedding as number[]);
        const umapSeed = 42 + reclusterTrigger * 97;

        setProgress(
          'Projecting semantic space & clustering constellations in background worker...',
        );

        const workerResult = await new Promise<WorkerTopologyResponse>(
          (resolve, reject) => {
            try {
              if (typeof Worker !== 'undefined') {
                const workerStart = performance.now();
                if (DebugTelemetryEngine.isHudActive()) {
                  DebugTelemetryEngine.getInstance().addLog(
                    'worker',
                    `[Constellation] Spawned UMAP Web Worker (${validBooks.length} embeddings, nNeighbors=${nNeighbors})`,
                    {activeCount: 1, count: validBooks.length, nNeighbors},
                    {scope: 'Constellation'},
                  );
                }
                const worker = new Worker(
                  new URL('../workers/umap.worker.ts', import.meta.url),
                  {type: 'module'},
                );
                activeWorkerRef.current = worker;
                worker.onmessage = (
                  e: MessageEvent<WorkerTopologyResponse>,
                ) => {
                  worker.terminate();
                  activeWorkerRef.current = null;
                  const durationMs = Math.round(
                    performance.now() - workerStart,
                  );
                  if (DebugTelemetryEngine.isHudActive()) {
                    DebugTelemetryEngine.getInstance().addLog(
                      'worker',
                      `[Constellation] UMAP Web Worker completed (${durationMs}ms)`,
                      {activeCount: 0, durationMs, count: validBooks.length},
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
                  reject(err);
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
          },
        );

        const fittings = workerResult.reduced!;
        const clusters =
          workerResult.labels && workerResult.labels.length === fittings.length
            ? workerResult.labels
            : optimalKMeans(fittings, umapSeed, embeddingData).labels;

        const rawItems = validBooks.map((book, idx) => ({
          rawX: fittings[idx][0],
          rawY: fittings[idx][1],
          book,
          clusterId: clusters[idx],
        }));

        const {points: newPlotData, bridges: newBridges} =
          assembleScatterPoints(rawItems, {
            relaxedCoords: workerResult.relaxedCoords,
            neighborIndexLists: workerResult.neighborIndexLists,
            softMemberships: workerResult.softMemberships,
          });

        setProgress('Synthesizing constellation themes with AI...');
        const groupedClusters: Record<number, BookDoc[]> = {};
        const groupedPoints: Record<number, ScatterPoint[]> = {};
        newPlotData.forEach(p => {
          if (p.clusterId !== -1) {
            if (!groupedClusters[p.clusterId]) {
              groupedClusters[p.clusterId] = [];
              groupedPoints[p.clusterId] = [];
            }
            groupedClusters[p.clusterId].push(p.book);
            groupedPoints[p.clusterId].push(p);
          }
        });
        const clusterArray = Object.keys(groupedClusters).map(cid => {
          const numericId = parseInt(cid, 10);
          const pts = groupedPoints[numericId] || [];
          return {
            id: numericId,
            totalCount: pts.length,
            books: selectRepresentativeClusterSample(pts, 18),
          };
        });

        const resolvedNames: Record<number, string> = {};
        const resolvedTheses: Record<number, string> = {};
        if (clusterArray.length > 0) {
          if (canRunAiEnrichment) {
            setProgress('Synthesizing constellation themes with AI...');
            try {
              const aiThemes = await generateClusterThemesMutation.mutateAsync({
                clusters: clusterArray,
              });
              for (const [idStr, info] of Object.entries(aiThemes)) {
                const cid = Number(idStr);
                if (info?.name) {
                  resolvedNames[cid] = info.name;
                }
                if (info?.thesis) {
                  resolvedTheses[cid] = info.thesis;
                }
              }
            } catch {
              // Fallback to deterministic themes below
            }
          }
          for (const c of clusterArray) {
            if (!resolvedNames[c.id] || !resolvedTheses[c.id]) {
              const members = groupedClusters[c.id] || [];
              const fallback = buildFallbackClusterTheme(c.id, members);
              if (!resolvedNames[c.id]) {
                resolvedNames[c.id] = fallback.name;
              }
              if (!resolvedTheses[c.id]) {
                resolvedTheses[c.id] = fallback.thesis;
              }
            }
          }
          if (isMounted) {
            setClusterNames(resolvedNames);
            setClusterTheses(resolvedTheses);
          }
        }

        // Persist computed clusterCoordinates, clusterNames, and clusterTheses in single-library mode so subsequent visits load in O(N)
        if (canEdit && libraryId && !isReadingMode) {
          try {
            const validOps = newPlotData
              .filter(
                p =>
                  Boolean(p.book?.id) &&
                  Number.isFinite(p.x) &&
                  Number.isFinite(p.y),
              )
              .map(p => ({
                type: 'update' as const,
                bookId: p.book.id,
                data: {
                  bookDetailsMetadata: {
                    ...(typeof p.book.bookDetailsMetadata?.hasSynopsis ===
                    'boolean'
                      ? {hasSynopsis: p.book.bookDetailsMetadata.hasSynopsis}
                      : {}),
                    ...(typeof p.book.bookDetailsMetadata?.hasAuthorBio ===
                    'boolean'
                      ? {hasAuthorBio: p.book.bookDetailsMetadata.hasAuthorBio}
                      : {}),
                    ...(typeof p.book.bookDetailsMetadata?.hasDescription ===
                    'boolean'
                      ? {
                          hasDescription:
                            p.book.bookDetailsMetadata.hasDescription,
                        }
                      : {}),
                    hasEmbedding: true,
                    hasClusterCoordinates: true,
                  },
                },
                heavyData: {
                  clusterCoordinates: {
                    x: p.x,
                    y: p.y,
                    clusterId: p.clusterId,
                    clusterName: resolvedNames[p.clusterId]
                      ? String(resolvedNames[p.clusterId]).slice(0, 200)
                      : undefined,
                    clusterThesis: resolvedTheses[p.clusterId]
                      ? String(resolvedTheses[p.clusterId]).slice(0, 600)
                      : undefined,
                  },
                },
              }));

            const CHUNK_SIZE = 400;
            for (let i = 0; i < validOps.length; i += CHUNK_SIZE) {
              await trpcVanilla.book.batchUpsert.mutate({
                libraryId,
                operations: validOps.slice(i, i + CHUNK_SIZE),
              });
            }
          } catch (persistErr) {
            console.warn(
              'Could not persist constellation coordinates to server:',
              persistErr,
            );
          }
        }

        if (isMounted) {
          setCrossClusterBridges(newBridges);
          setPlotData(newPlotData);
          setLoading(false);
        }
      } catch (err: unknown) {
        console.error('Map generation error:', err);
        if (isMounted) {
          setProgress(
            err instanceof Error
              ? err.message
              : 'Error building constellation map.',
          );
          setLoading(false);
        }
      }
    }

    void processMap();

    return () => {
      isMounted = false;
      if (activeWorkerRef.current) {
        activeWorkerRef.current.terminate();
        activeWorkerRef.current = null;
      }
    };
  }, [
    libraryId,
    isReadingMode,
    isBooksLoading,
    libraryBooks,
    reclusterTrigger,
    canEdit,
    canRunAiEnrichment,
  ]);

  const handleRecluster = async () => {
    if ((!libraryId && !isReadingMode) || loading) {
      return;
    }
    setLoading(true);
    setProgress('Re-computing constellation topology...');
    setClusterNames({});
    setClusterTheses({});
    setCrossClusterBridges([]);
    setReclusterTrigger(prev => prev + 1);
  };

  return {
    loading,
    progress,
    plotData,
    clusterNames,
    clusterTheses,
    crossClusterBridges,
    handleRecluster,
    isReadingMode,
    includeWantToRead,
    setIncludeWantToRead,
    readAndReadingCount,
    wantToReadCount,
  };
}
