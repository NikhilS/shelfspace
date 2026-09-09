import {useEffect} from 'react';
import {doc, getDoc, getDocFromCache} from 'firebase/firestore';
import {useQueryClient} from '@tanstack/react-query';
import {db} from '../firebase';
import {BookDetailsPayload} from '../types';
import {mapDocToBook} from '../hooks/useLibraryData';

export function PrefetchAdjacentBooks({
  libraryId,
  bookList,
  currentIndex,
  radius = 2,
}: {
  libraryId: string;
  bookList: string[];
  currentIndex: number;
  radius?: number;
}) {
  const queryClient = useQueryClient();
  const bookListKey = bookList.join(',');

  useEffect(() => {
    if (!libraryId || !bookList.length) return;

    const start = Math.max(0, currentIndex - radius);
    const end = Math.min(bookList.length - 1, currentIndex + radius);

    for (let i = start; i <= end; i++) {
      if (i === currentIndex) continue;
      const bookId = bookList[i];
      if (!bookId) continue;

      // Prefetch base book metadata into TanStack Query cache if missing
      if (!queryClient.getQueryData(['bookBase', libraryId, bookId])) {
        void queryClient.prefetchQuery({
          queryKey: ['bookBase', libraryId, bookId],
          queryFn: async () => {
            const bookRef = doc(db, 'libraries', libraryId, 'books', bookId);
            try {
              const cached = await getDocFromCache(bookRef);
              if (cached.exists()) return mapDocToBook(cached);
            } catch {
              // Ignore cache miss and fetch from network
            }
            const snap = await getDoc(bookRef);
            return snap.exists() ? mapDocToBook(snap) : null;
          },
          staleTime: 1000 * 60 * 5,
        });
      }

      // Prefetch deep book details into TanStack Query cache if missing
      if (!queryClient.getQueryData(['bookDetails', libraryId, bookId])) {
        void queryClient.prefetchQuery({
          queryKey: ['bookDetails', libraryId, bookId],
          queryFn: async () => {
            const detailsRef = doc(
              db,
              'libraries',
              libraryId,
              'bookDetails',
              bookId,
            );
            try {
              const cached = await getDocFromCache(detailsRef);
              if (cached.exists()) return cached.data() as BookDetailsPayload;
            } catch {
              // Ignore cache miss and fetch from network
            }
            const snap = await getDoc(detailsRef);
            return snap.exists() ? (snap.data() as BookDetailsPayload) : null;
          },
          staleTime: 1000 * 60 * 5,
        });
      }
    }
  }, [libraryId, bookListKey, currentIndex, radius, queryClient]);

  return null;
}
