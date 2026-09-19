import {trpcVanilla} from '../../lib/trpc';
import {instrumentMutation} from '../../lib/telemetry';

/**
 * Atomically purges a book and its corresponding sub-records,
 * including any nested reviews, decrementing the associated library's volume counter.
 * Delegates to the unified tRPC / AdminDb server mutation.
 */
export async function deleteBookAtomic(libraryId: string, bookId: string) {
  return instrumentMutation(
    'delete',
    `libraries/${libraryId}/books/${bookId}`,
    {libraryId, bookId, cascade: true},
    async () => {
      await trpcVanilla.book.delete.mutate({libraryId, bookId});
    },
  );
}
