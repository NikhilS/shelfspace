import {useState} from 'react';
import {
  doc,
  writeBatch,
  serverTimestamp,
  deleteField,
  DocumentData,
} from 'firebase/firestore';
import {db} from '../../firebase';
import {Book, BookDetailsPayload} from '../../types';
import {getTieredMetadata} from '../../lib/metadataUtils';
import {mergeBookMetadata} from '../../lib/utils';
import {classifyBooks} from '../../services/gemini';
import {toast} from 'sonner';
import {logger} from '../../contexts/DebugContext';

interface UseMetadataFillerProps {
  libraryId: string | undefined;
  booksWithDetails: Book[];
  selectedIds: Set<string>;
  setBooks: React.Dispatch<React.SetStateAction<Book[]>>;
  setBookDetailsMap: React.Dispatch<
    React.SetStateAction<Record<string, BookDetailsPayload>>
  >;
  activeJob: {
    status: 'running' | 'completed' | 'failed' | 'none';
    progress: number;
    total: number;
  } | null;
  missingMetadata: Book[];
}

export function useSpruceUpMetadataFiller({
  libraryId,
  booksWithDetails,
  selectedIds,
  setBooks,
  setBookDetailsMap,
  activeJob,
  missingMetadata,
}: UseMetadataFillerProps) {
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>(
    {},
  );
  const [fixingAll, setFixingAll] = useState(false);
  const [fixingProgress, setFixingProgress] = useState(0);

  const processBooksGenreAPI = async (booksToProcess: Book[]) => {
    const BATCH_SIZE = 5;
    let successCount = 0;

    for (let i = 0; i < booksToProcess.length; i += BATCH_SIZE) {
      const chunk = booksToProcess.slice(i, i + BATCH_SIZE);

      setProcessingIds(prev => {
        const next = {...prev};
        chunk.forEach(b => (next[b.id] = true));
        return next;
      });

      try {
        const results = await Promise.all(
          chunk.map(async b => {
            try {
              const enriched = await getTieredMetadata(b);
              if (enriched && enriched.genres && enriched.genres.length > 0) {
                return {id: b.id, genres: enriched.genres};
              }
            } catch (e) {
              console.warn(`Failed to fetch metadata for ${b.title}`, e);
            }
            return null;
          }),
        );

        const validResults = results.filter(
          (r): r is {id: string; genres: string[]} => r !== null,
        );

        if (validResults.length > 0) {
          const batch = writeBatch(db);
          validResults.forEach(res => {
            batch.update(doc(db, 'libraries', libraryId!, 'books', res.id), {
              genres: res.genres,
              updatedAt: serverTimestamp(),
            });
            successCount++;
          });
          await batch.commit();

          setBooks(prev =>
            prev.map(b => {
              const res = validResults.find(r => r.id === b.id);
              if (res) return {...b, genres: res.genres};
              return b;
            }),
          );
        }
      } catch (error) {
        console.error('Batch API Genre failed:', error);
      } finally {
        setProcessingIds(prev => {
          const next = {...prev};
          chunk.forEach(b => (next[b.id] = false));
          return next;
        });
        setFixingProgress(prev => prev + chunk.length);
      }
    }

    if (successCount > 0) {
      toast.success(`Updated genres for ${successCount} books via API`);
    }
  };

  const processAIGenre = async (booksToProcess: Book[]) => {
    const BATCH_SIZE = 20;
    let successCount = 0;

    for (let i = 0; i < booksToProcess.length; i += BATCH_SIZE) {
      const chunk = booksToProcess.slice(i, i + BATCH_SIZE);

      setProcessingIds(prev => {
        const next = {...prev};
        chunk.forEach(b => (next[b.id] = true));
        return next;
      });

      try {
        const results = await classifyBooks(chunk);

        const batch = writeBatch(db);
        results.forEach(res => {
          if (res.genres && res.genres.length > 0) {
            batch.update(doc(db, 'libraries', libraryId!, 'books', res.id), {
              genres: res.genres,
            });
            successCount++;
          }
        });

        await batch.commit();

        setBooks(prev =>
          prev.map(b => {
            const res = results.find(r => r.id === b.id);
            if (res && res.genres && res.genres.length > 0) {
              return {...b, genres: res.genres};
            }
            return b;
          }),
        );
      } catch (error) {
        console.error('Batch AI Genre failed:', error);
        toast.error('AI classification failed for some books');
      } finally {
        setProcessingIds(prev => {
          const next = {...prev};
          chunk.forEach(b => (next[b.id] = false));
          return next;
        });
        setFixingProgress(prev => prev + chunk.length);
      }
    }

    if (successCount > 0) {
      toast.success(`Updated genres for ${successCount} books using AI`);
    }
  };

  const processBooksMetadata = async (
    booksToProcess: Book[],
    forceResync = false,
  ) => {
    let successCount = 0;
    try {
      const {ClientBulkWriter} = await import('../../lib/clientBulkWriter');
      const writer = new ClientBulkWriter(db, 50); // Safe batchSize for client actions

      const concurrencyLimit = 5;
      for (let i = 0; i < booksToProcess.length; i += concurrencyLimit) {
        const chunk = booksToProcess.slice(i, i + concurrencyLimit);

        setProcessingIds(prev => {
          const next = {...prev};
          chunk.forEach(b => (next[b.id] = true));
          return next;
        });

        await Promise.all(
          chunk.map(async b => {
            try {
              const bookArg = b;
              logger.info(`Sprucing up metadata for "${bookArg.title}"...`);

              const enriched = await getTieredMetadata(bookArg);

              let newData: Partial<Book> = {};
              let heavyData: BookDetailsPayload = {};

              if (enriched) {
                const merged = mergeBookMetadata(b, enriched, forceResync);
                newData = merged.newData as Partial<Book>;
                heavyData = merged.heavyData as BookDetailsPayload;

                if (!forceResync) {
                  if (merged.newData.coverUrl) {
                    logger.info(`Found coverURL for "${bookArg.title}"`);
                  }
                  if (merged.heavyData.synopsis) {
                    logger.info(`Found synopsis for "${bookArg.title}"`);
                  }
                  if (merged.newData.genres) {
                    logger.info(
                      `Found genres for "${bookArg.title}": ${(merged.newData.genres as string[]).join(', ')}`,
                    );
                  }
                }
              }

              const hasNewLightData = Object.keys(newData).length > 0;
              const hasNewHeavyData = Object.keys(heavyData).length > 0;

              let hasLegacyData = false;

              if (b._inBooks?.synopsis) {
                heavyData.synopsis = heavyData.synopsis || b.synopsis;
                hasLegacyData = true;
              }
              if (b._inBooks?.authorBio) {
                heavyData.authorBio = heavyData.authorBio || b.authorBio;
                hasLegacyData = true;
              }
              if (b._inBooks?.embedding) {
                heavyData.embedding = heavyData.embedding || b.embedding;
                hasLegacyData = true;
              }
              if (b._inBooks?.clusterCoordinates) {
                heavyData.clusterCoordinates =
                  heavyData.clusterCoordinates || b.clusterCoordinates;
                hasLegacyData = true;
              }

              if (hasNewLightData || hasNewHeavyData || hasLegacyData) {
                const fbNewData: DocumentData = {...newData};
                if (hasLegacyData) {
                  fbNewData.synopsis = deleteField();
                  fbNewData.authorBio = deleteField();
                  fbNewData.embedding = deleteField();
                  fbNewData.clusterCoordinates = deleteField();
                }

                writer.update(
                  doc(db, 'libraries', libraryId!, 'books', b.id),
                  fbNewData,
                );

                if (Object.keys(heavyData).length > 0) {
                  const detailsRef = doc(
                    db,
                    'libraries',
                    libraryId!,
                    'bookDetails',
                    b.id,
                  );
                  writer.set(detailsRef, heavyData, {merge: true});

                  setBookDetailsMap(prev => ({
                    ...prev,
                    [b.id]: {
                      ...(prev[b.id] || {}),
                      ...heavyData,
                    },
                  }));
                }

                setBooks(prev =>
                  prev.map(bookItem => {
                    if (bookItem.id === b.id) {
                      const updated = {...bookItem, ...newData};
                      delete updated.synopsis;
                      delete updated.authorBio;
                      delete updated.embedding;
                      delete updated.clusterCoordinates;
                      return updated;
                    }
                    return bookItem;
                  }),
                );
                successCount++;
              }
            } catch (error) {
              console.error('Error fixing metadata for', b.title, error);
            } finally {
              setProcessingIds(prev => ({...prev, [b.id]: false}));
              setFixingProgress(prev => prev + 1);
            }
          }),
        );
      }

      await writer.close();
    } finally {
      if (successCount > 0) {
        toast.success(`Fixed metadata for ${successCount} books`);
      }
    }
  };

  const handleBulkFixMetadata = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksMetadata(selectedBooks, false);
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleBulkForceResync = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksMetadata(selectedBooks, true);
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleBulkFixGenreAPI = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    const targets = selectedBooks.filter(
      b => !b.genres || b.genres.length === 0,
    );
    if (targets.length === 0) {
      toast.info('Selected books already have genres');
      return;
    }
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksGenreAPI(targets);
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleBulkForceGenreAPI = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksGenreAPI(selectedBooks);
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleBulkFixGenreAI = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    const targets = selectedBooks.filter(
      b => !b.genres || b.genres.length === 0,
    );
    if (targets.length === 0) {
      toast.info('Selected books already have genres');
      return;
    }
    setFixingAll(true);
    setFixingProgress(0);
    await processAIGenre(targets);
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleBulkForceGenreAI = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    setFixingAll(true);
    setFixingProgress(0);
    await processAIGenre(selectedBooks);
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleFixMetadata = async (b: Book) => {
    if (!libraryId || processingIds[b.id]) return;
    await processBooksMetadata([b]);
  };

  const handleFixAllMetadata = async () => {
    if (fixingAll || activeJob?.status === 'running') return;
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksMetadata(missingMetadata);
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleForceResyncAllMetadata = async () => {
    if (fixingAll || activeJob?.status === 'running') return;

    setFixingAll(true);
    setFixingProgress(0);
    try {
      await processBooksMetadata(booksWithDetails, true);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to start resync',
      );
    } finally {
      setFixingAll(false);
      setFixingProgress(0);
    }
  };

  return {
    processingIds,
    fixingAll,
    fixingProgress,
    handleFixMetadata,
    handleFixAllMetadata,
    handleForceResyncAllMetadata,
    handleBulkFixMetadata,
    handleBulkForceResync,
    handleBulkFixGenreAPI,
    handleBulkForceGenreAPI,
    handleBulkFixGenreAI,
    handleBulkForceGenreAI,
  };
}
