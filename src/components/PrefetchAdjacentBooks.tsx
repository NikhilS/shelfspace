import {useEffect} from 'react';
import {doc, getDoc} from 'firebase/firestore';
import {db} from '../firebase';

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
    const start = Math.max(0, currentIndex - radius);
    const end = Math.min(bookList.length - 1, currentIndex + radius);

    for (let i = start; i <= end; i++) {
      if (i === currentIndex) continue;
      const bookId = bookList[i];

      // Just fetch details once to warm up the local cache
      const detailsRef = doc(db, 'libraries', libraryId, 'bookDetails', bookId);

      getDoc(detailsRef).catch(error => {
        console.warn('Prefetch book details error', error);
      });
    }
  }, [libraryId, bookListKey, currentIndex, radius]);

  return null;
}
