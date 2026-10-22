import {useState, useEffect, useRef} from 'react';
import {
  Point2D,
  SemanticNeighborIndex,
  optimalKMeans,
  normalizeAndRelaxPositions,
  computeSemanticNeighbors,
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
  neighbors: ConstellationNeighbor[];
}

interface WorkerTopologyResponse {
  reduced?: number[][];
  labels?: number[];
  relaxedCoords?: Point2D[];
  neighborIndexLists?: SemanticNeighborIndex[][];
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
  },
): ScatterPoint[] {
  if (rawItems.length === 0) {
    return [];
  }

  const relaxedCoords =
    precomputed?.relaxedCoords &&
    precomputed.relaxedCoords.length === rawItems.length
      ? precomputed.relaxedCoords
      : normalizeAndRelaxPositions(
          rawItems.map(item => ({x: item.rawX, y: item.rawY})),
          {
            clusterIds: rawItems.map(item => item.clusterId),
          },
        );

  const neighborIndexLists =
    precomputed?.neighborIndexLists &&
    precomputed.neighborIndexLists.length === rawItems.length
      ? precomputed.neighborIndexLists
      : computeSemanticNeighbors(
          relaxedCoords,
          rawItems.map(item => item.book.embedding),
          5,
        );

  return rawItems.map((item, idx) => {
    const pos = relaxedCoords[idx] || {x: item.rawX, y: item.rawY};
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
      neighbors,
    };
  });
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
  const [reclusterTrigger, setReclusterTrigger] = useState(0);
  const activeWorkerRef = useRef<Worker | null>(null);

  const generateClusterNamesMutation =
    trpc.gemini.generateClusterNames.useMutation();

  useEffect(() => {
    let isMounted = true;

    async function runWorkerGeometryOnly(
      rawItems: Array<{
        rawX: number;
        rawY: number;
        book: BookDoc;
        clusterId: number;
      }>,
    ): Promise<ScatterPoint[]> {
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

        // Group books by their source libraryId and query bookDetails in chunks of 50
        const detailsMap = new Map<string, Record<string, unknown>>();
        const chunkSize = 50;
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

        // Fast-path: In single-library mode, if every book already has persisted clusterCoordinates (and we are not re-clustering),
        // relax positions and compute nearest-neighbor graph off the main thread in the Web Worker.
        const allHaveSavedClusters =
          !isReadingMode &&
          reclusterTrigger === 0 &&
          allBooks.every(
            b =>
              b.clusterCoordinates &&
              typeof b.clusterCoordinates.x === 'number' &&
              typeof b.clusterCoordinates.y === 'number' &&
              typeof b.clusterCoordinates.clusterId === 'number',
          );

        if (allHaveSavedClusters) {
          const cachedNames: Record<number, string> = {};
          const rawItems = allBooks.map(book => {
            const coords = book.clusterCoordinates!;
            const cid = coords.clusterId ?? 0;
            if (coords.clusterName) {
              cachedNames[cid] = coords.clusterName;
            }
            return {
              rawX: coords.x,
              rawY: coords.y,
              book,
              clusterId: cid,
            };
          });

          if (Object.keys(cachedNames).length > 0 && isMounted) {
            const cachedPlotData = await runWorkerGeometryOnly(rawItems);
            if (!isMounted) {
              return;
            }
            setClusterNames(cachedNames);
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
                  await trpcVanilla.enrichment.trigger.mutate({
                    libraryId: targetLibId,
                    enrichmentType: 'embedding',
                    bookIds: booksGroup.map(b => b.id),
                    overwrite: false,
                  });

                  const refreshedDetails =
                    await trpcVanilla.book.getBookDetailsChunk.mutate({
                      libraryId: targetLibId,
                      bookIds: booksGroup.map(b => b.id),
                    });

                  if (refreshedDetails?.details) {
                    for (const b of booksGroup) {
                      const detail = refreshedDetails.details[b.id];
                      if (detail?.embedding) {
                        b.embedding = detail.embedding;
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

        const nNeighbors = Math.min(15, Math.max(2, validBooks.length - 1));
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
                      minDist: 0.18,
                      spread: 1.15,
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
                    minDist: 0.18,
                    spread: 1.15,
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
            : optimalKMeans(fittings, umapSeed).labels;

        const rawItems = validBooks.map((book, idx) => ({
          rawX: fittings[idx][0],
          rawY: fittings[idx][1],
          book,
          clusterId: clusters[idx],
        }));

        const newPlotData = assembleScatterPoints(rawItems, {
          relaxedCoords: workerResult.relaxedCoords,
          neighborIndexLists: workerResult.neighborIndexLists,
        });

        setProgress('Naming constellations with AI...');
        const groupedClusters: Record<number, BookDoc[]> = {};
        newPlotData.forEach(p => {
          if (p.clusterId !== -1) {
            if (!groupedClusters[p.clusterId]) {
              groupedClusters[p.clusterId] = [];
            }
            groupedClusters[p.clusterId].push(p.book);
          }
        });
        const clusterArray = Object.keys(groupedClusters).map(cid => ({
          id: parseInt(cid, 10),
          books: groupedClusters[parseInt(cid, 10)].map(b => ({
            title: b.title,
            author: b.author,
          })),
        }));

        let resolvedNames: Record<number, string> = {};
        if (clusterArray.length > 0) {
          if (canRunAiEnrichment) {
            setProgress('Naming constellations with AI...');
            try {
              resolvedNames = await generateClusterNamesMutation.mutateAsync({
                clusters: clusterArray,
              });
            } catch {
              // Fallback to deterministic names below
            }
          }
          if (Object.keys(resolvedNames).length === 0) {
            for (const c of clusterArray) {
              const members = groupedClusters[c.id] || [];
              const genreCounts = new Map<string, number>();
              for (const m of members) {
                const g =
                  (m as {primaryGenre?: string}).primaryGenre ||
                  (m as {genre?: string}).genre;
                if (g && g !== 'Unclassified') {
                  genreCounts.set(g, (genreCounts.get(g) || 0) + 1);
                }
              }
              let topGenre = '';
              let topCount = 0;
              for (const [g, count] of genreCounts.entries()) {
                if (count > topCount) {
                  topGenre = g;
                  topCount = count;
                }
              }
              resolvedNames[c.id] = topGenre || `Constellation ${c.id + 1}`;
            }
          }
          if (isMounted) {
            setClusterNames(resolvedNames);
          }
        }

        // Persist computed clusterCoordinates and clusterNames in single-library mode so subsequent visits load in O(N)
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
    setReclusterTrigger(prev => prev + 1);
  };

  return {
    loading,
    progress,
    plotData,
    clusterNames,
    handleRecluster,
    isReadingMode,
    includeWantToRead,
    setIncludeWantToRead,
    readAndReadingCount,
    wantToReadCount,
  };
}
