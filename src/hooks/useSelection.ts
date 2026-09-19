import {Book} from '../types';
import {toast} from 'sonner';
import {useUIStore} from '../stores/uiStore';
import {instrumentMutation} from '../lib/telemetry';
import {trpcVanilla} from '../lib/trpc';
import {useQueryClient} from '@tanstack/react-query';

export function useSelection(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const queryClient = useQueryClient();
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
          await trpcVanilla.book.batchUpsert.mutate({
            libraryId,
            operations: booksArray.map(bookId => ({
              type: 'update',
              bookId,
              data: {
                [`userStatuses.${userId}`]: newStatus,
              },
            })),
          });
          void queryClient.invalidateQueries({queryKey: ['books', libraryId]});
        },
      );
      toast.success(`Updated status for ${selectedBooks.size} books`);
      clearSelection();
    } catch (error) {
      console.error('Failed to update status in bulk:', error);
      toast.error('Failed to update status for selected books');
    }
  };

  const handleBulkDelete = async () => {
    if (selectedBooks.size === 0 || !libraryId) return;
    try {
      const count = selectedBooks.size;
      const booksArray = Array.from(selectedBooks);
      await instrumentMutation(
        'delete',
        `libraries/${libraryId}/books(bulk-delete)`,
        {count},
        async () => {
          await trpcVanilla.book.batchUpsert.mutate({
            libraryId,
            operations: booksArray.map(bookId => ({
              type: 'delete',
              bookId,
            })),
          });
          void queryClient.invalidateQueries({queryKey: ['books', libraryId]});
        },
      );
      toast.success(`Deleted ${count} books`);
      clearSelection();
    } catch (error) {
      console.error('Failed to bulk delete books:', error);
      toast.error('Failed to delete selected books');
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
