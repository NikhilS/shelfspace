import {useState, useEffect, useRef} from 'react';
import {useNavigate} from 'react-router-dom';
import {
  optimalKMeans,
  normalizeAndRelaxPositions,
  computeSemanticNeighbors,
} from '../lib/clustering';
import {BookDetails} from '../services/bookApi';
import {trpc, trpcVanilla} from '../lib/trpc';
import {useAuth} from '../stores/authStore';
import {useLibraryData} from './useLibraryData';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {BookDetailsMetadata} from '../types';

export interface BookDoc extends Omit<
  BookDetails,
  'isbn' | 'coverUrl' | 'publishedDate'
> {
  id: string;
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

function buildScatterPointsWithGeometry(
  rawItems: Array<{
    rawX: number;
    rawY: number;
    book: BookDoc;
    clusterId: number;
  }>,
): ScatterPoint[] {
  if (rawItems.length === 0) return [];

  const relaxedCoords = normalizeAndRelaxPositions(
    rawItems.map(item => ({x: item.rawX, y: item.rawY})),
    {
      clusterIds: rawItems.map(item => item.clusterId),
    },
  );

  const neighborIndexLists = computeSemanticNeighbors(
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
        if (!target) return null;
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
  const {user} = useAuth();
  const navigate = useNavigate();

  // Consume the canonical ['books', libraryId] query provided by useLibraryData
  const {books: libraryBooks, isBooksLoading} = useLibraryData(
    libraryId,
    user?.uid,
    navigate,
  );

  const [, setBooks] = useState<BookDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<string>('Loading books...');
  const [plotData, setPlotData] = useState<ScatterPoint[]>([]);
  const [clusterNames, setClusterNames] = useState<Record<number, string>>({});
  const [reclusterTrigger, setReclusterTrigger] = useState(0);
  const activeWorkerRef = useRef<Worker | null>(null);

  const generateBookEmbeddingsMutation =
    trpc.gemini.generateBookEmbeddings.useMutation();
  const generateClusterNamesMutation =
    trpc.gemini.generateClusterNames.useMutation();

  useEffect(() => {
    let isMounted = true;

    async function processMap() {
      if (!libraryId) return;

      if (isBooksLoading) {
        setLoading(true);
        setProgress('Loading books...');
        return;
      }

      if (!libraryBooks || libraryBooks.length < 3) {
        setBooks([]);
        setProgress(
          'Not enough books to form a constellation (minimum 3 needed).',
        );
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setProgress('Fetching book details...');

        // Query bookDetails in chunks of 50 in parallel for fast initial load
        const detailsMap = new Map<string, Record<string, unknown>>();
        const chunkSize = 50;
        const chunks: Array<typeof libraryBooks> = [];

        for (let i = 0; i < libraryBooks.length; i += chunkSize) {
          chunks.push(libraryBooks.slice(i, i + chunkSize));
        }

        let completedCount = 0;
        await Promise.all(
          chunks.map(async chunk => {
            const res = await trpcVanilla.book.getBookDetailsChunk.mutate({
              libraryId,
              bookIds: chunk.map(b => b.id),
            });

            let chunkBytes = 0;
            let docCount = 0;
            if (res?.details) {
              for (const [id, data] of Object.entries(res.details)) {
                detailsMap.set(id, data);
                chunkBytes += calculatePayloadBytes(data);
                docCount++;
              }
            }

            completedCount += chunk.length;
            if (isMounted) {
              setProgress(
                `Fetching book details (${Math.min(completedCount, libraryBooks.length)}/${libraryBooks.length})...`,
              );
            }

            DebugTelemetryEngine.getInstance().addLog(
              'db_read',
              `Queried bookDetails chunk (${chunk.length} docs, ${(chunkBytes / 1024).toFixed(1)} KB)`,
              {
                path: `libraries/${libraryId}/bookDetails`,
                size: chunk.length,
                bytes: chunkBytes,
                docCount,
              },
            );
          }),
        );

        const allBooks: BookDoc[] = [];
        libraryBooks.forEach(b => {
          const detail = detailsMap.get(b.id) || {};
          const merged = {...b, ...detail, id: b.id};
          allBooks.push(merged as BookDoc);
        });

        if (!isMounted) return;
        setBooks(allBooks);

        if (allBooks.length < 3) {
          setProgress(
            'Not enough books to form a constellation (minimum 3 needed).',
          );
          setLoading(false);
          return;
        }

        // Fast-path: If every book already has persisted clusterCoordinates (and we are not re-clustering),
        // relax positions and compute nearest-neighbor graph immediately in O(N^2) without re-running UMAP or Gemini.
        const allHaveSavedClusters =
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
            const cachedPlotData = buildScatterPointsWithGeometry(rawItems);
            setClusterNames(cachedNames);
            setPlotData(cachedPlotData);
            setLoading(false);
            return;
          }
        }

        const toEmbed = allBooks.filter(
          b => !b.embedding || b.embedding.length === 0,
        );

        if (toEmbed.length > 0) {
          setProgress(
            `Generating AI embeddings for ${toEmbed.length} books... (0%)`,
          );
          const texts = toEmbed.map(b => {
            const parts = [b.title];
            if (b.author) parts.push(`by ${b.author}`);
            if (b.primaryGenre) {
              const genreStr =
                b.subgenres && b.subgenres.length > 0
                  ? `${b.primaryGenre}: ${b.subgenres.join(', ')}`
                  : b.primaryGenre;
              parts.push(`[${genreStr}]`);
            }
            if (b.synopsis) parts.push(b.synopsis);
            return parts.join(' - ');
          });

          const embeddings = await generateBookEmbeddingsMutation.mutateAsync(
            {texts},
            {
              onSuccess: () => {
                setProgress('Generating AI embeddings... (100%)');
              },
            },
          );
          if (!embeddings || embeddings.length !== toEmbed.length) {
            throw new Error('Failed to generate correct number of embeddings.');
          }

          setProgress(`Saving embeddings to library... (0/${toEmbed.length})`);

          await trpcVanilla.book.batchUpsert.mutate({
            libraryId,
            operations: toEmbed.map((b, j) => ({
              type: 'update',
              bookId: b.id,
              data: {
                bookDetailsMetadata: {
                  ...(b.bookDetailsMetadata || {}),
                  hasEmbedding: true,
                },
              },
              heavyData: {
                embedding: embeddings[j],
              },
            })),
          });

          for (let j = 0; j < toEmbed.length; j++) {
            toEmbed[j].embedding = embeddings[j];
          }

          setProgress(
            `Saving embeddings to library... (${toEmbed.length}/${toEmbed.length})`,
          );
        }

        setProgress('Running UMAP dimensionality reduction...');
        await new Promise(r => setTimeout(r, 60));

        const validBooks = allBooks.filter(
          b => b.embedding && b.embedding.length > 0,
        );
        if (validBooks.length < 3) {
          setProgress('Not enough valid embeddings to map.');
          setLoading(false);
          return;
        }

        const nNeighbors = Math.min(15, Math.max(2, validBooks.length - 1));
        const embeddingData = validBooks.map(b => b.embedding as number[]);
        const umapSeed = 42 + reclusterTrigger * 97;

        setProgress('Projecting semantic space with UMAP...');
        await new Promise(r => setTimeout(r, 40));

        const fittings = await new Promise<number[][]>((resolve, reject) => {
          try {
            if (typeof Worker !== 'undefined') {
              const worker = new Worker(
                new URL('../workers/umapWorker.ts', import.meta.url),
                {type: 'module'},
              );
              activeWorkerRef.current = worker;
              worker.onmessage = e => {
                worker.terminate();
                activeWorkerRef.current = null;
                if (e.data.error) {
                  reject(new Error(e.data.error));
                } else if (e.data.reduced) {
                  resolve(e.data.reduced);
                } else {
                  reject(new Error('Invalid response from UMAP worker'));
                }
              };
              worker.onerror = err => {
                worker.terminate();
                activeWorkerRef.current = null;
                reject(err);
              };
              worker.postMessage({
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
                  resolve(umap.fit(embeddingData));
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
                resolve(umap.fit(embeddingData));
              })
              .catch(reject);
          }
        });

        setProgress('Evaluating optimal constellations via K-Means++...');
        await new Promise(r => setTimeout(r, 50));

        const {labels: clusters} = optimalKMeans(fittings, umapSeed);

        const rawItems = validBooks.map((book, idx) => ({
          rawX: fittings[idx][0],
          rawY: fittings[idx][1],
          book,
          clusterId: clusters[idx],
        }));

        const newPlotData = buildScatterPointsWithGeometry(rawItems);

        setProgress('Naming constellations with AI...');
        await new Promise(r => setTimeout(r, 50));
        const groupedClusters: Record<number, BookDoc[]> = {};
        newPlotData.forEach(p => {
          if (p.clusterId !== -1) {
            if (!groupedClusters[p.clusterId])
              groupedClusters[p.clusterId] = [];
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
          resolvedNames = await generateClusterNamesMutation.mutateAsync({
            clusters: clusterArray,
          });
          if (isMounted) setClusterNames(resolvedNames);
        }

        // Persist computed clusterCoordinates and clusterNames so subsequent visits load in O(N)
        try {
          await trpcVanilla.book.batchUpsert.mutate({
            libraryId,
            operations: newPlotData.map(p => ({
              type: 'update',
              bookId: p.book.id,
              data: {
                bookDetailsMetadata: {
                  ...(p.book.bookDetailsMetadata || {}),
                  hasEmbedding: true,
                  hasClusterCoordinates: true,
                },
              },
              heavyData: {
                clusterCoordinates: {
                  x: p.x,
                  y: p.y,
                  clusterId: p.clusterId,
                  clusterName: resolvedNames[p.clusterId] || undefined,
                },
              },
            })),
          });
        } catch (persistErr) {
          console.warn(
            'Could not persist constellation coordinates to server:',
            persistErr,
          );
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
  }, [libraryId, isBooksLoading, libraryBooks, reclusterTrigger]);

  const handleRecluster = async () => {
    if (!libraryId || loading) return;
    setLoading(true);
    setProgress('Re-computing constellation topology...');
    setClusterNames({});
    setReclusterTrigger(prev => prev + 1);
  };

  return {loading, progress, plotData, clusterNames, handleRecluster};
}
