import {useMemo, useState, useEffect, useRef} from 'react';
import {
  collection,
  doc,
  addDoc,
  onSnapshot,
  increment,
  writeBatch,
  deleteField,
  DocumentData,
  serverTimestamp,
} from 'firebase/firestore';
import {auth, db, handleFirestoreError, OperationType} from '../../firebase';
import {Book, BookDetailsPayload} from '../../types';
import {getTieredMetadata} from '../../lib/metadataUtils';
import {mergeBookMetadata} from '../../lib/utils';
import {classifyBooks} from '../../services/gemini';
import {toast} from 'sonner';
import {logger} from '../../contexts/DebugContext';

const getFingerprints = (b: Book) => {
  const cleanIsbn = (b.isbn || '').trim().replace(/[^0-9X]/gi, '');
  const cleanTitle = (b.title || '').trim().toLowerCase();
  const cleanAuthor = (b.author || '').trim().toLowerCase();
  const format = b.format || 'physical';
  return {cleanIsbn, cleanTitle, cleanAuthor, format};
};

function findDuplicates(books: Book[]): Book[][] {
  const adjList: Record<string, Set<string>> = {};

  const addEdge = (id1: string, id2: string) => {
    if (!adjList[id1]) adjList[id1] = new Set();
    if (!adjList[id2]) adjList[id2] = new Set();
    adjList[id1].add(id2);
    adjList[id2].add(id1);
  };

  const isbnGroups: Record<string, string[]> = {};
  const titleAuthorGroups: Record<string, string[]> = {};

  for (const b of books) {
    const {cleanIsbn, cleanTitle, cleanAuthor, format} = getFingerprints(b);

    if (cleanIsbn) {
      const key = `${cleanIsbn}:${format}`;
      if (!isbnGroups[key]) isbnGroups[key] = [];
      isbnGroups[key].push(b.id);
    }

    if (cleanTitle && cleanAuthor) {
      const key = `${cleanTitle}|${cleanAuthor}:${format}`;
      if (!titleAuthorGroups[key]) titleAuthorGroups[key] = [];
      titleAuthorGroups[key].push(b.id);
    }
  }

  const connectGroup = (group: string[]) => {
    if (group.length > 1) {
      const first = group[0];
      for (let i = 1; i < group.length; i++) {
        addEdge(first, group[i]);
      }
    }
  };

  Object.values(isbnGroups).forEach(connectGroup);
  Object.values(titleAuthorGroups).forEach(connectGroup);

  const visited = new Set<string>();
  const duplicateGroups: Book[][] = [];
  const bookMap = new Map(books.map(b => [b.id, b]));

  for (const node of Object.keys(adjList)) {
    if (!visited.has(node)) {
      const groupIds: string[] = [];
      const queue = [node];
      visited.add(node);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        groupIds.push(curr);
        for (const neighbor of adjList[curr] || []) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      if (groupIds.length > 1) {
        duplicateGroups.push(
          groupIds.map(id => bookMap.get(id)!).filter(Boolean),
        );
      }
    }
  }

  return duplicateGroups;
}

export function useSpruceUp(libraryId: string | undefined) {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookDetailsMap, setBookDetailsMap] = useState<
    Record<string, BookDetailsPayload>
  >({});
  const [allowedDuplicateGroups, setAllowedDuplicateGroups] = useState<
    string[][]
  >([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(true);
  const [allowedLoading, setAllowedLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Record<string, boolean>>(
    {},
  );
  const [fixingAll, setFixingAll] = useState(false);
  const [fixingProgress, setFixingProgress] = useState(0);
  const [activeJob, setActiveJob] = useState<{
    status: 'running' | 'completed' | 'failed' | 'none';
    progress: number;
    total: number;
  } | null>(null);

  // Selection & Filtering
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<
    | 'all'
    | 'missing_metadata'
    | 'missing_genre'
    | 'low_res_cover'
    | 'missing_cover'
  >('missing_metadata');
  const [emptyCoverUrls, setEmptyCoverUrls] = useState<Set<string>>(new Set());

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = (filteredBooks: Book[]) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      const allSelected = filteredBooks.every(b => next.has(b.id));
      if (allSelected) {
        filteredBooks.forEach(b => next.delete(b.id));
      } else {
        filteredBooks.forEach(b => next.add(b.id));
      }
      return next;
    });
  };

  useEffect(() => {
    if (!libraryId) return;

    const jobRef = doc(db, 'libraries', libraryId, 'jobs', 'resync');
    const unsubscribeJob = onSnapshot(
      jobRef,
      docSnap => {
        if (docSnap.exists()) {
          const data = docSnap.data();
          setActiveJob({
            status: data.status,
            progress: data.progress || 0,
            total: data.total || 0,
          });
        } else {
          setActiveJob({status: 'none', progress: 0, total: 0});
        }
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/jobs/resync`,
        );
      },
    );

    return () => unsubscribeJob();
  }, [libraryId]);

  useEffect(() => {
    if (!libraryId) return;

    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const unsubscribeBooks = onSnapshot(
      booksRef,
      booksSnap => {
        const loaded = booksSnap.docs.map(
          doc => ({...doc.data(), id: doc.id}) as Book,
        );
        setBooks(loaded);
        setBooksLoading(false);
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/books`,
        );
        setBooksLoading(false);
      },
    );

    const detailsRef = collection(db, 'libraries', libraryId, 'bookDetails');
    const unsubscribeDetails = onSnapshot(
      detailsRef,
      detailsSnap => {
        const details: Record<string, BookDetailsPayload> = {};
        detailsSnap.forEach(doc => {
          details[doc.id] = doc.data() as BookDetailsPayload;
        });
        setBookDetailsMap(details);
        setDetailsLoading(false);
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/bookDetails`,
        );
        setDetailsLoading(false);
      },
    );

    const allowedRef = collection(
      db,
      'libraries',
      libraryId,
      'allowedDuplicates',
    );
    const unsubscribeAllowed = onSnapshot(
      allowedRef,
      allowedSnap => {
        const allowed = allowedSnap.docs.map(
          doc => (doc.data().bookIds || []) as string[],
        );
        setAllowedDuplicateGroups(allowed);
        setAllowedLoading(false);
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/allowedDuplicates`,
        );
        setAllowedLoading(false);
      },
    );

    return () => {
      unsubscribeBooks();
      unsubscribeDetails();
      unsubscribeAllowed();
    };
  }, [libraryId]);

  const booksWithDetails = useMemo(() => {
    return books.map(b => ({
      ...b,
      ...(bookDetailsMap[b.id] || {}),
      _inBooks: {
        synopsis: !!b.synopsis,
        authorBio: !!b.authorBio,
        embedding: !!b.embedding,
        clusterCoordinates: !!b.clusterCoordinates,
      },
    }));
  }, [books, bookDetailsMap]);

  const checkedUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const googleCoverUrls = booksWithDetails
      .map(b => b.coverUrl)
      .filter(
        (url): url is string =>
          !!url &&
          (url.includes('google.com') || url.includes('googleapis.com')),
      );

    googleCoverUrls.forEach(url => {
      if (checkedUrlsRef.current.has(url)) return;
      checkedUrlsRef.current.add(url);

      const cacheKey = `bk_empty_google_cover_${url}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached !== null) {
        if (cached === 'true') {
          setEmptyCoverUrls(prev => {
            const next = new Set(prev);
            next.add(url);
            return next;
          });
        }
        return;
      }

      fetch(url, {method: 'GET', credentials: 'omit'})
        .then(async res => {
          if (!res.ok) return;
          const contentLength = res.headers.get('content-length');
          if (contentLength) {
            const sizeStatus = parseInt(contentLength, 10) === 9103;
            localStorage.setItem(cacheKey, String(sizeStatus));
            if (sizeStatus) {
              setEmptyCoverUrls(prev => {
                const next = new Set(prev);
                next.add(url);
                return next;
              });
            }
            return;
          }
          // Fallback to blob size
          const blob = await res.blob();
          const sizeStatus = blob.size === 9103;
          localStorage.setItem(cacheKey, String(sizeStatus));
          if (sizeStatus) {
            setEmptyCoverUrls(prev => {
              const next = new Set(prev);
              next.add(url);
              return next;
            });
          }
        })
        .catch(err => {
          console.warn('Error checking Google books empty cover url', url, err);
        });
    });
  }, [booksWithDetails]);

  const duplicates = useMemo(() => {
    const allDuplicates = findDuplicates(booksWithDetails);

    return allDuplicates.filter(group => {
      const groupIds = group.map(b => b.id);
      const isAllowed = allowedDuplicateGroups.some(allowedGroup =>
        groupIds.every(id => allowedGroup.includes(id)),
      );
      return !isAllowed;
    });
  }, [booksWithDetails, allowedDuplicateGroups]);

  const missingMetadata = useMemo(() => {
    return booksWithDetails.filter(b => {
      return (
        !b.coverUrl ||
        emptyCoverUrls.has(b.coverUrl) ||
        !b.synopsis ||
        !b.publishedDate ||
        !b.genres ||
        b.genres.length === 0
      );
    });
  }, [booksWithDetails, emptyCoverUrls]);

  const handleDelete = async (id: string) => {
    if (!libraryId) return;
    const originalBooks = [...books];
    try {
      setBooks(prev => prev.filter(b => b.id !== id));
      setProcessingIds(prev => ({...prev, [id]: true}));

      const batch = writeBatch(db);
      batch.delete(doc(db, 'libraries', libraryId, 'books', id));
      batch.delete(doc(db, 'libraries', libraryId, 'bookDetails', id));
      batch.update(doc(db, 'libraries', libraryId), {
        bookCount: increment(-1),
      });

      // Cleanup reviews (small scale deletion)
      try {
        const {getDocs} = await import('firebase/firestore');
        const reviewsRef = collection(
          db,
          'libraries',
          libraryId,
          'books',
          id,
          'reviews',
        );
        const reviewsSnap = await getDocs(reviewsRef);
        reviewsSnap.forEach(revDoc => {
          batch.delete(revDoc.ref);
        });
      } catch (e) {
        handleFirestoreError(
          e,
          OperationType.GET,
          `libraries/${libraryId}/books/${id}/reviews`,
        );
      }

      await batch.commit();

      toast.success('Book deleted');
    } catch (error) {
      setBooks(originalBooks);
      toast.error('Failed to delete book');
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `libraries/${libraryId}/books/${id}`,
      );
    } finally {
      setProcessingIds(prev => ({...prev, [id]: false}));
    }
  };

  const handleAllowDuplicateGroup = async (group: Book[]) => {
    if (!libraryId) return;
    const bookIds = group.map(b => b.id);
    const originalAllowed = [...allowedDuplicateGroups];
    try {
      setAllowedDuplicateGroups(prev => [...prev, bookIds]);
      await addDoc(
        collection(db, 'libraries', libraryId, 'allowedDuplicates'),
        {
          bookIds,
          createdAt: serverTimestamp(),
        },
      );
      toast.success('Duplicate suggestion dismissed');
    } catch (error) {
      setAllowedDuplicateGroups(originalAllowed);
      toast.error('Failed to dismiss suggestion');
      handleFirestoreError(
        error,
        OperationType.CREATE,
        `libraries/${libraryId}/allowedDuplicates`,
      );
    }
  };

  const handleBulkFixMetadata = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksMetadata(selectedBooks, false); // Fix missing only
    setFixingAll(false);
    setFixingProgress(0);
  };

  const handleBulkForceResync = async () => {
    const selectedBooks = booksWithDetails.filter(b => selectedIds.has(b.id));
    if (selectedBooks.length === 0 || fixingAll) return;
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksMetadata(selectedBooks, true); // Force resync everything
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

    try {
      const token = await auth.currentUser?.getIdToken();

      const response = await fetch(`/api/libraries/${libraryId}/resync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? {Authorization: `Bearer ${token}`} : {}),
        },
        body: JSON.stringify({isForceResync: true}),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to start resync');
      }

      toast.success('Resync task added to backend queue');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to start resync',
      );
    }
  };

  const loading = booksLoading || detailsLoading || allowedLoading;

  return {
    books,
    booksWithDetails,
    loading,
    duplicates,
    missingMetadata,
    processingIds,
    fixingAll,
    fixingProgress,
    activeJob,
    selectedIds,
    filter,
    setFilter,
    toggleSelect,
    toggleSelectAll,
    handleDelete,
    handleAllowDuplicateGroup,
    handleFixMetadata,
    handleFixAllMetadata,
    handleForceResyncAllMetadata,
    handleBulkFixMetadata,
    handleBulkForceResync,
    handleBulkFixGenreAPI,
    handleBulkForceGenreAPI,
    handleBulkFixGenreAI,
    handleBulkForceGenreAI,
    emptyCoverUrls,
  };
}
