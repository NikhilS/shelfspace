import {useState, useEffect, useRef} from 'react';
import {
  CrossClusterBridge,
  optimalKMeans,
  getOptimalClusterBounds,
  isLegacyIslandLayout,
} from '../lib/clustering';
import {trpc, trpcVanilla} from '../lib/trpc';
import {useCollectionScope} from './useCollectionScope';
import {useAppPermissions} from './useAppPermissions';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../lib/telemetry';
import {BookDetails, BookDetailsMetadata} from '../types';
import {
  assembleScatterPoints,
  buildFallbackClusterTheme,
  runConstellationWorkerFullTopology,
  runConstellationWorkerGeometryOnly,
  selectRepresentativeClusterSample,
} from './constellationDataHelpers';

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
          allBooks.push(merged);
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
              await runConstellationWorkerGeometryOnly(
                rawItems,
                activeWorkerRef,
              );
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
                  const enrichBatchSize = 100;
                  for (let i = 0; i < booksGroup.length; i += enrichBatchSize) {
                    const enrichSlice = booksGroup.slice(
                      i,
                      i + enrichBatchSize,
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

        const workerResult = await runConstellationWorkerFullTopology({
          embeddingData,
          nNeighbors,
          umapSeed,
          activeWorkerRef,
        });

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
                    hasEmbedding: true,
                    hasClusterCoordinates: true,
                  },
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

            const persistChunkSize = 400;
            for (let i = 0; i < validOps.length; i += persistChunkSize) {
              await trpcVanilla.book.batchUpsert.mutate({
                libraryId,
                operations: validOps.slice(i, i + persistChunkSize),
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
