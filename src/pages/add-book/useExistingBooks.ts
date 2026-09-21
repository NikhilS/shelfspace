import {BookDetails} from '../../services/bookApi';
import {Book} from '../../types';
import {trpc} from '../../lib/trpc';

export function useExistingBooks(libraryId?: string) {
  const utils = trpc.useUtils();

  const cachedData = libraryId
    ? utils.book.list.getData({libraryId})
    : undefined;

  const cachedBooks = Array.isArray(cachedData)
    ? (cachedData as Book[])
    : (cachedData as {books?: Book[]})?.books;

  const bookListQuery = trpc.book.list.useQuery(
    {libraryId: libraryId || ''},
    {
      enabled: Boolean(libraryId && (!cachedBooks || cachedBooks.length === 0)),
      staleTime: 1000 * 60 * 5,
    },
  );

  const queryBooks = Array.isArray(bookListQuery.data)
    ? (bookListQuery.data as unknown as BookDetails[])
    : (bookListQuery.data?.books as unknown as BookDetails[]);

  const existingBooks =
    (cachedBooks as unknown as BookDetails[]) || queryBooks || [];

  return {existingBooks};
}
