import React from 'react';
import {Book} from '../types';
import {toast} from 'sonner';
import {useUIStore} from '../stores/uiStore';
import {instrumentMutation} from '../lib/telemetry';
import {trpc} from '../lib/trpc';

export function useSelection(
  libraryId: string | undefined,
  userId: string | undefined,
) {
  const utils = trpc.useUtils();
  const {
    selectedBookIds: selectedBooks,
    toggleBookSelection: toggleStoreBook,
    toggleAllBooks: toggleStoreAll,
    clearSelection,
  } = useUIStore();

  const batchUpsertMutation = trpc.book.batchUpsert.useMutation({
    onSuccess: () => {
      if (libraryId) {
        void utils.book.list.invalidate({libraryId});
      }
    },
  });

  const toggleBookSelection = (e: React.MouseEvent, bookId: string) => {
    e.stopPropagation();
    toggleStoreBook(bookId);
  };

  const toggleAllBooks = (shelfBooksList: Book[]) => {
    const listIds = shelfBooksList.map(b => b.id);
    toggleStoreAll(listIds);
  };

  const pruneSelection = (activeBooks: Book[]) => {
    const activeIds = new Set(activeBooks.map(b => b.id));
    const currentSelected = Array.from(selectedBooks);
    const orphanIds = currentSelected.filter(id => !activeIds.has(id));
    if (orphanIds.length > 0) {
      orphanIds.forEach(id => {
        toggleStoreBook(id);
      });
    }
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
          await batchUpsertMutation.mutateAsync({
            libraryId,
            operations: booksArray.map(bookId => ({
              type: 'update',
              bookId,
              data: {
                [`userStatuses.${userId}`]: newStatus,
              },
            })),
          });
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
          await batchUpsertMutation.mutateAsync({
            libraryId,
            operations: booksArray.map(bookId => ({
              type: 'delete',
              bookId,
            })),
          });
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
    pruneSelection,
    handleBulkStatusChange,
    handleBulkDelete,
    isProcessing: batchUpsertMutation.isPending,
  };
}
