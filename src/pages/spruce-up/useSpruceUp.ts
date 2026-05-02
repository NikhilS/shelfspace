import {useMemo, useState, useEffect} from 'react';
import {
  collection,
  doc,
  deleteDoc,
  updateDoc,
  addDoc,
  onSnapshot,
  increment,
  writeBatch,
  deleteField,
  DocumentData,
  serverTimestamp,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {BookDetails} from '../../services/bookApi';
import {Book, BookDetailsPayload} from '../../types';
import {getTieredMetadata} from '../../lib/metadataUtils';
import {toast} from 'sonner';

export function useSpruceUp(libraryId: string | undefined) {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookDetailsMap, setBookDetailsMap] = useState<
    Record<string, BookDetailsPayload>
  >({});
  const [allowedDuplicateGroups, setAllowedDuplicateGroups] = useState<
    string[][]
  >([]);
  const [loading, setLoading] = useState(true);
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
        console.error('Failed to listen to resync job:', error);
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
          doc => ({...doc.data(), id: doc.id}) as BookDetails & {id: string},
        );
        setBooks(loaded);
        setLoading(false);
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/books`,
        );
        setLoading(false);
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
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/bookDetails`,
        );
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
      },
      error => {
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}/allowedDuplicates`,
        );
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
    const dupes: Record<string, Book[]> = {};
    const seen: Record<string, Book> = {};

    for (const b of booksWithDetails) {
      const cleanIsbn = (b.isbn || '').trim().replace(/[^0-9X]/gi, '');
      const cleanTitle = (b.title || '').trim().toLowerCase();
      const cleanAuthor = (b.author || '').trim().toLowerCase();
      const format = b.format;

      // Find if it matches any existing seen book
      let matchedKey = null;
      for (const [key, seenBook] of Object.entries(seen)) {
        const seenCleanIsbn = (seenBook.isbn || '')
          .trim()
          .replace(/[^0-9X]/gi, '');
        const seenCleanTitle = (seenBook.title || '').trim().toLowerCase();
        const seenCleanAuthor = (seenBook.author || '').trim().toLowerCase();
        const seenFormat = seenBook.format;

        const hasSameIsbn =
          cleanIsbn && seenCleanIsbn && cleanIsbn === seenCleanIsbn;
        const hasSameTitleAndAuthor =
          cleanTitle &&
          cleanAuthor &&
          cleanTitle === seenCleanTitle &&
          cleanAuthor === seenCleanAuthor;

        const formatConflict = format && seenFormat && format !== seenFormat;

        if ((hasSameIsbn || hasSameTitleAndAuthor) && !formatConflict) {
          matchedKey = key;
          break;
        }
      }

      if (matchedKey) {
        if (!dupes[matchedKey]) {
          dupes[matchedKey] = [seen[matchedKey]];
        }
        dupes[matchedKey].push(b);
      } else {
        const newKey = b.id;
        seen[newKey] = b;
      }
    }

    return Object.values(dupes).filter(group => {
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
      await deleteDoc(doc(db, 'libraries', libraryId, 'books', id));
      await updateDoc(doc(db, 'libraries', libraryId), {
        bookCount: increment(-1),
      });
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
      const response = await fetch(`/api/libraries/${libraryId}/resync`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
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
