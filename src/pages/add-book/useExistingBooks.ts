import {Book, BookDetails} from '../../types';
import {trpc} from '../../lib/trpc';

export function useExistingBooks(
  libraryId?: string,
  mode: 'library' | 'reading' = 'library',
) {
  const utils = trpc.useUtils?.();
  const isReadingMode =
    mode === 'reading' || !libraryId || libraryId.startsWith('virtual_');

  const cachedData = libraryId
    ? utils?.book?.list?.getData?.({libraryId})
    : undefined;

  const cachedBooks = Array.isArray(cachedData)
    ? (cachedData as Book[])
    : (cachedData as {books?: Book[]})?.books;

  const bookListQuery = trpc.book?.list?.useQuery
    ? trpc.book.list.useQuery(
        {libraryId: libraryId || ''},
        {
          enabled: Boolean(
            libraryId &&
            !isReadingMode &&
            (!cachedBooks || cachedBooks.length === 0),
          ),
          staleTime: 1000 * 60 * 5,
        },
      )
    : undefined;

  const readingShelfQuery = trpc.readingTracker?.getShelf?.useQuery
    ? trpc.readingTracker.getShelf.useQuery(
        {shelf: 'all'},
        {
          enabled: isReadingMode,
          staleTime: 1000 * 60 * 2,
        },
      )
    : undefined;

  const queryBooks = Array.isArray(bookListQuery?.data)
    ? (bookListQuery.data as unknown as BookDetails[])
    : (bookListQuery?.data?.books as unknown as BookDetails[]);

  const shelfBooks = (readingShelfQuery?.data?.items ||
    []) as unknown as BookDetails[];

  const existingBooks = isReadingMode
    ? shelfBooks.length > 0
      ? shelfBooks
      : (cachedBooks as unknown as BookDetails[]) || queryBooks || []
    : (cachedBooks as unknown as BookDetails[]) || queryBooks || [];

  return {existingBooks};
}
