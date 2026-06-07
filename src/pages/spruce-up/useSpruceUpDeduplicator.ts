import {useMemo, useState, useEffect} from 'react';
import {
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {Book} from '../../types';
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

export function useSpruceUpDeduplicator(
  libraryId: string | undefined,
  booksWithDetails: Book[],
) {
  const [allowedDuplicateGroups, setAllowedDuplicateGroups] = useState<
    string[][]
  >([]);
  const [allowedLoading, setAllowedLoading] = useState(true);

  useEffect(() => {
    if (!libraryId) return;

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
          docSnap => (docSnap.data().bookIds || []) as string[],
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

    return () => unsubscribeAllowed();
  }, [libraryId]);

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

  return {
    duplicates,
    allowedLoading,
    handleAllowDuplicateGroup,
  };
}
