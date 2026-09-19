import {useQueryClient} from '@tanstack/react-query';
import {BookDetails} from '../../services/bookApi';
import {Book} from '../../types';
import {trpc} from '../../lib/trpc';

export function useExistingBooks(libraryId?: string) {
  const queryClient = useQueryClient();

  const cachedBooks = libraryId
    ? queryClient.getQueryData<Book[]>(['books', libraryId])
    : undefined;

  const bookListQuery = trpc.book.list.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: Boolean(libraryId && (!cachedBooks || cachedBooks.length === 0)),
      staleTime: 1000 * 60 * 5,
    },
  );

  const existingBooks =
    (cachedBooks as unknown as BookDetails[]) ||
    (bookListQuery.data?.books as unknown as BookDetails[]) ||
    [];

  return {existingBooks};
}
