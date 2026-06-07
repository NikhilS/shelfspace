import {useState, useEffect, useMemo, useRef} from 'react';
import {
  collection,
  doc,
  onSnapshot,
  increment,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {Book, BookDetailsPayload} from '../../types';
import {toast} from 'sonner';

export function useSpruceUpIntegrity(libraryId: string | undefined) {
  const [books, setBooks] = useState<Book[]>([]);
  const [bookDetailsMap, setBookDetailsMap] = useState<
    Record<string, BookDetailsPayload>
  >({});
  const [booksLoading, setBooksLoading] = useState(true);
  const [detailsLoading, setDetailsLoading] = useState(true);

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

  // Listen to Active resync job
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

  // Listen to books and bookDetails only
  useEffect(() => {
    if (!libraryId) return;

    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const unsubscribeBooks = onSnapshot(
      booksRef,
      booksSnap => {
        const loaded = booksSnap.docs.map(
          docSnap => ({...docSnap.data(), id: docSnap.id}) as Book,
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
        detailsSnap.forEach(docSnap => {
          details[docSnap.id] = docSnap.data() as BookDetailsPayload;
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

    return () => {
      unsubscribeBooks();
      unsubscribeDetails();
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

  // Check empty Google Books cover URLs
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

      const batch = writeBatch(db);
      batch.delete(doc(db, 'libraries', libraryId, 'books', id));
      batch.delete(doc(db, 'libraries', libraryId, 'bookDetails', id));
      batch.update(doc(db, 'libraries', libraryId), {
        bookCount: increment(-1),
        updatedAt: serverTimestamp(),
      });

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
    }
  };

  const integrityLoading = booksLoading || detailsLoading;

  return {
    books,
    setBooks,
    bookDetailsMap,
    setBookDetailsMap,
    booksWithDetails,
    integrityLoading,
    activeJob,
    selectedIds,
    filter,
    setFilter,
    toggleSelect,
    toggleSelectAll,
    emptyCoverUrls,
    missingMetadata,
    handleDelete,
  };
}
