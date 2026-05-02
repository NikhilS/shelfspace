import {useMemo, useState, useEffect} from 'react';
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
import {toast} from 'sonner';

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
        !b.synopsis ||
        !b.publishedDate ||
        !b.genres ||
        b.genres.length === 0
      );
    });
  }, [booksWithDetails]);

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

  const processBooksMetadata = async (
    booksToProcess: Book[],
    isForceResync: boolean,
  ) => {
    let successCount = 0;
    try {
      const concurrencyLimit = 5;
      for (let i = 0; i < booksToProcess.length; i += concurrencyLimit) {
        const chunk = booksToProcess.slice(i, i + concurrencyLimit);

        const newProcessingIds: Record<string, boolean> = {};
        chunk.forEach(b => (newProcessingIds[b.id] = true));
        setProcessingIds(prev => ({...prev, ...newProcessingIds}));

        await Promise.all(
          chunk.map(async b => {
            try {
              const bookArg = isForceResync
                ? {title: b.title, author: b.author, isbn: b.isbn}
                : b;

              const enriched = await getTieredMetadata(bookArg);

              const newData: Partial<Book> = {};
              const heavyData: BookDetailsPayload = {};

              if (enriched) {
                if ((isForceResync || !b.coverUrl) && enriched.coverUrl)
                  newData.coverUrl = enriched.coverUrl;
                if ((isForceResync || !b.synopsis) && enriched.synopsis) {
                  heavyData.synopsis = enriched.synopsis;
                }
                if ((isForceResync || !b.authorBio) && enriched.authorBio)
                  heavyData.authorBio = enriched.authorBio;
                if (
                  (isForceResync || !b.publishedDate) &&
                  enriched.publishedDate
                )
                  newData.publishedDate = enriched.publishedDate;
                if (
                  (isForceResync || !b.genres || b.genres.length === 0) &&
                  enriched.genres &&
                  enriched.genres.length > 0
                )
                  newData.genres = enriched.genres;
              }

              const hasNewLightData = Object.keys(newData).length > 0;
              const hasNewHeavyData = Object.keys(heavyData).length > 0;

              let hasLegacyData = false;

              if (!isForceResync) {
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
              } else {
                hasLegacyData = true;
              }

              if (
                hasNewLightData ||
                hasNewHeavyData ||
                hasLegacyData ||
                isForceResync
              ) {
                const batch = writeBatch(db);

                const fbNewData: DocumentData = {...newData};
                if (hasLegacyData || isForceResync) {
                  fbNewData.synopsis = deleteField();
                  fbNewData.authorBio = deleteField();
                  fbNewData.embedding = deleteField();
                  fbNewData.clusterCoordinates = deleteField();
                }

                batch.update(
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
                  batch.set(detailsRef, heavyData, {merge: true});

                  setBookDetailsMap(prev => ({
                    ...prev,
                    [b.id]: {
                      ...(prev[b.id] || {}),
                      ...heavyData,
                    },
                  }));
                }

                await batch.commit();

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
              handleFirestoreError(
                error,
                OperationType.UPDATE,
                `libraries/${libraryId}/books/${b.id}`,
              );
            } finally {
              setProcessingIds(prev => ({...prev, [b.id]: false}));
              setFixingProgress(prev => prev + 1);
            }
          }),
        );
      }
    } finally {
      if (successCount > 0) {
        toast.success(
          isForceResync
            ? `Force resynced ${successCount} books`
            : `Fixed metadata for ${successCount} books`,
        );
      }
    }
  };

  const handleFixMetadata = async (b: Book) => {
    if (!libraryId || processingIds[b.id]) return;
    await processBooksMetadata([b], false);
  };

  const handleFixAllMetadata = async () => {
    if (fixingAll || activeJob?.status === 'running') return;
    setFixingAll(true);
    setFixingProgress(0);
    await processBooksMetadata(missingMetadata, false);
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
    loading,
    duplicates,
    missingMetadata,
    processingIds,
    fixingAll,
    fixingProgress,
    activeJob,
    handleDelete,
    handleAllowDuplicateGroup,
    handleFixMetadata,
    handleFixAllMetadata,
    handleForceResyncAllMetadata,
  };
}
