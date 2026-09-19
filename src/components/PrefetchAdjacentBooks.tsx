import {useEffect} from 'react';
import {trpcVanilla} from '../lib/trpc';

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
  const bookListKey = bookList.join(',');

  useEffect(() => {
    if (!libraryId || !bookList.length) return;

    const start = Math.max(0, currentIndex - radius);
    const end = Math.min(bookList.length - 1, currentIndex + radius);

    for (let i = start; i <= end; i++) {
      if (i === currentIndex) continue;
      const bookId = bookList[i];
      if (!bookId) continue;

      void trpcVanilla.book.get
        .query({
          libraryId,
          bookId,
        })
        .catch(() => {
          // Ignore prefetch errors
        });
    }
  }, [libraryId, bookListKey, currentIndex, radius]);

  return null;
}
