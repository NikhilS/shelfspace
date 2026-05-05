import {useState, useEffect} from 'react';
import {collection, onSnapshot} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../../firebase';
import {BookDetails} from '../../services/bookApi';

export function useExistingBooks(libraryId?: string) {
  const [existingBooks, setExistingBooks] = useState<BookDetails[]>([]);

  useEffect(() => {
    if (!libraryId) return;
    const booksRef = collection(db, 'libraries', libraryId, 'books');
    const unsubscribe = onSnapshot(
      booksRef,
      snap => {
        const books = snap.docs.map(doc => doc.data() as BookDetails);
        setExistingBooks(books);
      },
      err => {
        handleFirestoreError(
          err,
          OperationType.LIST,
          `libraries/${libraryId}/books`,
        );
      },
    );
    return () => unsubscribe();
  }, [libraryId]);

  return {existingBooks};
}
