import {useMemo, useState, useEffect} from 'react';
import {
  collection,
  doc,
  onSnapshot,
  increment,
  writeBatch,
  serverTimestamp,
  addDoc,
} from 'firebase/firestore';
import {useNavigate} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {Book} from '../../types';
import {toast} from 'sonner';
import {useAuth} from '../../stores/authStore';
import {useLibraryData} from '../../hooks/useLibraryData';
import {DebugTelemetryEngine, calculatePayloadBytes} from '../../lib/telemetry';

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
  const {user} = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Consume the canonical ['books', libraryId] query provided by useLibraryData
  const {books, isBooksLoading: booksLoading} = useLibraryData(
    libraryId,
    user?.uid,
    navigate,
  );

  const [allowedDuplicateGroups, setAllowedDuplicateGroups] = useState<
    string[][]
  >([]);
  const [allowedLoading, setAllowedLoading] = useState(true);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!libraryId) return;

    const allowedRef = collection(
      db,
      'libraries',
      libraryId,
      'allowedDuplicates',
    );
    const unregisterAllowed =
      DebugTelemetryEngine.getInstance().registerListener(
        'useSpruceUp:allowedDuplicates',
        `libraries/${libraryId}/allowedDuplicates`,
      );
    const unsubscribeAllowed = onSnapshot(
      allowedRef,
      {includeMetadataChanges: true},
      allowedSnap => {
        const fromCache = allowedSnap.metadata.fromCache;
        const allowed = allowedSnap.docs.map(
          docSnap => (docSnap.data().bookIds || []) as string[],
        );
        const payloadBytes = calculatePayloadBytes(allowed);

        DebugTelemetryEngine.getInstance().addLog(
          'db_read',
          `Queried allowedDuplicates (${allowedSnap.size} docs, ${(payloadBytes / 1024).toFixed(1)} KB)`,
          {
            path: `libraries/${libraryId}/allowedDuplicates`,
            fromCache,
            size: allowedSnap.size,
            bytes: payloadBytes,
            docCount: allowedSnap.size,
          },
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
      unregisterAllowed();
      unsubscribeAllowed();
    };
  }, [libraryId]);

  const duplicates = useMemo(() => {
    const allDuplicates = findDuplicates(books);

    return allDuplicates.filter(group => {
      const groupIds = group.map(b => b.id);
      const isAllowed = allowedDuplicateGroups.some(allowedGroup =>
        groupIds.every(id => allowedGroup.includes(id)),
      );
      return !isAllowed;
    });
  }, [books, allowedDuplicateGroups]);

  const handleDelete = async (id: string) => {
    if (!libraryId) return;
    const originalBooks = [...books];
    setProcessingIds(prev => new Set(prev).add(id));
    try {
      queryClient.setQueryData(
        ['books', libraryId],
        (prev: Book[] | undefined) =>
          prev ? prev.filter(b => b.id !== id) : [],
      );

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
      queryClient.setQueryData(['books', libraryId], originalBooks);
      toast.error('Failed to delete book');
      handleFirestoreError(
        error,
        OperationType.DELETE,
        `libraries/${libraryId}/books/${id}`,
      );
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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

  const loading = booksLoading || allowedLoading;

  return {
    loading,
    books,
    duplicates,
    processingIds,
    handleDelete,
    handleAllowDuplicateGroup,
  };
}
