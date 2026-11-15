import type {Book, BookDetails} from '../../types';
import {trpc} from '../../lib/trpc';

interface BookLikeSummary {
  title: string;
  author: string;
  isbn?: string | null;
  coverUrl?: string | null;
  publishedDate?: string | null;
  synopsis?: string | null;
  authorBio?: string | null;
  primaryGenre?: string | null;
  subgenres?: string[];
  isCustomPrimary?: boolean;
  series?: string | null;
  format?: 'physical' | 'digital';
}

function toBookDetails(item: BookLikeSummary): BookDetails {
  return {
    title: item.title,
    author: item.author,
    isbn: item.isbn ?? '',
    coverUrl: item.coverUrl ?? '',
    publishedDate: item.publishedDate ?? '',
    synopsis: item.synopsis ?? undefined,
    authorBio: item.authorBio ?? undefined,
    primaryGenre: item.primaryGenre ?? undefined,
    subgenres: item.subgenres,
    isCustomPrimary: item.isCustomPrimary,
    series: item.series ?? undefined,
    format: item.format ?? 'physical',
  };
}

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

  const cachedRawBooks: BookLikeSummary[] | undefined = Array.isArray(
    cachedData,
  )
    ? (cachedData as Book[])
    : cachedData?.books;

  const bookListQuery = trpc.book?.list?.useQuery
    ? trpc.book.list.useQuery(
        {libraryId: libraryId || ''},
        {
          enabled: Boolean(
            libraryId &&
            !isReadingMode &&
            (!cachedRawBooks || cachedRawBooks.length === 0),
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

  const queryRawBooks: BookLikeSummary[] | undefined = Array.isArray(
    bookListQuery?.data,
  )
    ? (bookListQuery.data as Book[])
    : bookListQuery?.data?.books;

  const cachedBooks = cachedRawBooks?.map(toBookDetails);
  const queryBooks = queryRawBooks?.map(toBookDetails);
  const shelfBooks = (readingShelfQuery?.data?.items ?? []).map(toBookDetails);

  const existingBooks: BookDetails[] = isReadingMode
    ? shelfBooks.length > 0
      ? shelfBooks
      : cachedBooks || queryBooks || []
    : cachedBooks || queryBooks || [];

  return {existingBooks};
}
