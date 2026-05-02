import {useState} from 'react';
import {doc, updateDoc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Book} from '../types';
import {toast} from 'sonner';

export function useSelection(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());

  const toggleBookSelection = (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation();
    setSelectedBooks(prev => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const toggleAllBooks = (shelfBooksList: Book[]) => {
    const listIds = shelfBooksList.map(b => b.id);
    const allSelected = listIds.every(id => selectedBooks.has(id));

    setSelectedBooks(prev => {
      const next = new Set(prev);
      if (allSelected) {
        listIds.forEach(id => next.delete(id));
      } else {
        listIds.forEach(id => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedBooks(new Set());

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedBooks.size === 0 || !userId || !libraryId) return;
    try {
      const promises = Array.from(selectedBooks).map(bookId => {
        const bookRef = doc(db, 'libraries', libraryId, 'books', bookId);
        return updateDoc(bookRef, {
          [`userStatuses.${userId}`]: newStatus,
        });
      });
      await Promise.all(promises);
      toast.success(`Updated status for ${selectedBooks.size} books`);
      clearSelection();
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.UPDATE,
        `libraries/${libraryId}/books`,
      );
    }
  };

  return {
    selectedBooks,
    toggleBookSelection,
    toggleAllBooks,
    clearSelection,
    handleBulkStatusChange,
  };
}
