import {doc} from 'firebase/firestore';
import {db, handleFirestoreError, OperationType} from '../firebase';
import {Book} from '../types';
import {toast} from 'sonner';
import {useUIStore} from '../stores/uiStore';
import {instrumentMutation} from '../lib/telemetry';

export function useSelection(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const {
    selectedBookIds: selectedBooks,
    toggleBookSelection: toggleStoreBook,
    toggleAllBooks: toggleStoreAll,
    clearSelection,
  } = useUIStore();

  const toggleBookSelection = (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation();
    toggleStoreBook(bookId);
  };

  const toggleAllBooks = (shelfBooksList: Book[]) => {
    const listIds = shelfBooksList.map(b => b.id);
    toggleStoreAll(listIds);
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (selectedBooks.size === 0 || !userId || !libraryId) return;
    try {
      const booksArray = Array.from(selectedBooks);
      await instrumentMutation(
        'update',
        `libraries/${libraryId}/books(bulk-status)`,
        {count: booksArray.length, status: newStatus},
        async () => {
          const {ClientBulkWriter} = await import('../lib/clientBulkWriter');
          const writer = new ClientBulkWriter(db);

          booksArray.forEach(bookId => {
            const bookRef = doc(db, 'libraries', libraryId, 'books', bookId);
            writer.update(bookRef, {
              [`userStatuses.${userId}`]: newStatus,
            });
          });

          await writer.close();
        },
      );
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

  const handleBulkDelete = async () => {
    if (selectedBooks.size === 0 || !libraryId) return;
    try {
      const count = selectedBooks.size;
      await instrumentMutation(
        'delete',
        `libraries/${libraryId}/books(bulk-delete)`,
        {count},
        async () => {
          const {ClientBulkWriter} = await import('../lib/clientBulkWriter');
          const writer = new ClientBulkWriter(db);

          selectedBooks.forEach(bookId => {
            writer.deleteBook(libraryId, bookId);
          });

          await writer.close();
        },
      );
      toast.success(`Deleted ${count} books`);
      clearSelection();
    } catch (error) {
      handleFirestoreError(
        error,
        OperationType.DELETE,
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
    handleBulkDelete,
  };
}
