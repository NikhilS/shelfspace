import {useMemo, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {useQueryClient} from '@tanstack/react-query';
import {Book} from '../../types';
import {toast} from 'sonner';
import {useAuth} from '../../stores/authStore';
import {useLibraryData} from '../../hooks/useLibraryData';
import {trpc, trpcVanilla} from '../../lib/trpc';
import {instrumentMutation} from '../../lib/telemetry';

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

  const allowedQuery = trpc.library.listAllowedDuplicates.useQuery(
    {libraryId: libraryId || ''},
    {enabled: !!libraryId},
  );

  const allowedDuplicateGroups = useMemo(() => {
    return allowedQuery.data?.allowedDuplicateGroups || [];
  }, [allowedQuery.data]);

  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());

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

      await instrumentMutation(
        'delete',
        `libraries/${libraryId}/books/${id}`,
        {libraryId, bookId: id},
        () => trpcVanilla.book.delete.mutate({libraryId, bookId: id}),
      );
      toast.success('Book deleted');
    } catch (error) {
      queryClient.setQueryData(['books', libraryId], originalBooks);
      toast.error('Failed to delete book');
      console.error('Failed to delete book:', error);
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
    try {
      await instrumentMutation(
        'create',
        `libraries/${libraryId}/allowedDuplicates`,
        {bookIds},
        () =>
          trpcVanilla.library.allowDuplicateGroup.mutate({
            libraryId,
            bookIds,
          }),
      );
      void allowedQuery.refetch();
      toast.success('Duplicate suggestion dismissed');
    } catch (error) {
      toast.error('Failed to dismiss suggestion');
      console.error('Failed to dismiss duplicate suggestion:', error);
    }
  };

  const loading = booksLoading || allowedQuery.isLoading;

  return {
    loading,
    books,
    duplicates,
    processingIds,
    handleDelete,
    handleAllowDuplicateGroup,
  };
}
