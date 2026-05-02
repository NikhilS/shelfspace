import {useState, useEffect} from 'react';
import {doc, collection, onSnapshot, query, orderBy} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Library, Book} from '../types';
import {toast} from 'sonner';

export function useLibraryData(
  libraryId: string | undefined,
  userId: string | undefined,
  navigate: (path: string) => void,
) {
  const [library, setLibrary] = useState<Library | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isBooksLoading, setIsBooksLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!libraryId || !userId) return;
    setIsLoading(true);
    setIsBooksLoading(true);

    const libRef = doc(db, 'libraries', libraryId);
    const unsubscribeLib = onSnapshot(
      libRef,
      {includeMetadataChanges: true},
      docSnap => {
        if (docSnap.exists()) {
          setLibrary({id: docSnap.id, ...docSnap.data()} as Library);
        } else {
          toast.error('Library not found');
          navigate('/');
        }
        setIsLoading(false);
      },
      error => {
        setIsLoading(false);
        handleFirestoreError(
          error,
          OperationType.GET,
          `libraries/${libraryId}`,
        );
      },
    );

    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const q = query(booksRef, orderBy('addedAt', 'desc'));

    const unsubscribeBooks = onSnapshot(
      q,
      {includeMetadataChanges: true},
      snapshot => {
        setIsSyncing(snapshot.metadata.hasPendingWrites);

        const bks: Book[] = [];
        snapshot.forEach(doc => {
          const data = doc.data();
          let parsedGenres: string[] = [];
          const rawGenres =
            data.genres ||
            data.genre ||
            data.categories ||
            data.category ||
            data.tags ||
            data.subjects;

          if (rawGenres) {
            let tempGenres: string[] = [];
            if (Array.isArray(rawGenres)) {
              tempGenres = rawGenres.map(g => String(g));
            } else if (typeof rawGenres === 'string') {
              tempGenres = [rawGenres];
            } else if (typeof rawGenres === 'object' && rawGenres !== null) {
              tempGenres = Object.values(rawGenres).map(g => String(g));
            }

            const result = new Set<string>();
            tempGenres.forEach((g: string) => {
              if (typeof g === 'string') {
                const splits = g
                  .split(/[/,;]/)
                  .map((s: string) => s.trim())
                  .filter(Boolean);
                splits.forEach((s: string) => result.add(s));
              }
            });
            parsedGenres = Array.from(result);
          }

          bks.push({id: doc.id, ...data, genres: parsedGenres} as Book);
        });

        // Sorting is already handled via query orderBy
        setBooks(bks);
        setIsBooksLoading(false);
      },
      error => {
        setIsBooksLoading(false);
        handleFirestoreError(
          error,
          OperationType.LIST,
          `libraries/${libraryId}/books`,
        );
      },
    );

    return () => {
      unsubscribeLib();
      unsubscribeBooks();
    };
  }, [libraryId, userId, navigate]);

  return {library, books, isLoading, isBooksLoading, isSyncing};
}
