import {useMemo, useCallback} from 'react';
import {useNavigate, useSearchParams} from 'react-router-dom';
import {useAuth} from '../stores/authStore';
import {useLibraryData} from './useLibraryData';
import {useReadingShelf} from '../pages/dashboard/useReadingShelf';
import {getAccessFromLibrary} from '../lib/permissions';
import type {Book, Library} from '../types';

export interface CollectionScopeResult {
  mode: 'library' | 'reading';
  isReadingMode: boolean;
  libraryId: string | undefined;
  library: Library | null;
  books: Book[];
  isBooksLoading: boolean;
  canEdit: boolean;
  includeWantToRead: boolean;
  setIncludeWantToRead: (include: boolean) => void;
  readAndReadingCount: number;
  wantToReadCount: number;
  refetchShelf: () => Promise<void>;
}

/**
 * Unified data adapter for exploratory views (Timeline, World Map, Constellation).
 * - When `libraryId` is defined (`/library/:id/*`), scopes to that single library.
 * - When `libraryId` is undefined (`/reading/*`), scopes to the user's Personal Reading Tracker
 *   (defaulting to Read + Currently Reading books, with an optional toggle to include Want to Read).
 */
export function useCollectionScope(
  libraryId: string | undefined,
): CollectionScopeResult {
  const {user} = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const isReadingMode = !libraryId;
  const includeWantToRead = searchParams.get('wantToRead') === 'true';

  const setIncludeWantToRead = useCallback(
    (include: boolean) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (include) {
            next.set('wantToRead', 'true');
          } else {
            next.delete('wantToRead');
          }
          return next;
        },
        {replace: true},
      );
    },
    [setSearchParams],
  );

  // 1. Single-Library Data
  const {
    library,
    books: libraryBooks,
    isBooksLoading: isLibraryBooksLoading,
  } = useLibraryData(libraryId, user?.uid, navigate);

  const {canEdit: libraryCanEdit} = getAccessFromLibrary(
    library,
    user?.uid,
    user?.email,
  );

  // 2. Personal Reading Tracker Data (only fetched when in Reading Mode)
  const {
    allItems,
    isLoading: isReadingShelfLoading,
    refetch: refetchShelf,
  } = useReadingShelf({enabled: isReadingMode});

  const readAndReadingBooks = useMemo<Book[]>(() => {
    if (!isReadingMode) return [];
    return allItems.filter(
      item =>
        item.readingStatus === 'finished' || item.readingStatus === 'reading',
    );
  }, [isReadingMode, allItems]);

  const wantToReadBooks = useMemo<Book[]>(() => {
    if (!isReadingMode) return [];
    return allItems.filter(item => item.readingStatus === 'want_to_read');
  }, [isReadingMode, allItems]);

  const scopedReadingBooks = useMemo<Book[]>(() => {
    if (!isReadingMode) return [];
    if (includeWantToRead) {
      return [...readAndReadingBooks, ...wantToReadBooks];
    }
    return readAndReadingBooks;
  }, [isReadingMode, includeWantToRead, readAndReadingBooks, wantToReadBooks]);

  const books = useMemo<Book[]>(() => {
    if (isReadingMode) {
      return scopedReadingBooks;
    }
    return libraryBooks.map(b =>
      b.libraryId ? b : {...b, libraryId: libraryId},
    );
  }, [isReadingMode, scopedReadingBooks, libraryBooks, libraryId]);

  return {
    mode: isReadingMode ? 'reading' : 'library',
    isReadingMode,
    libraryId,
    library: isReadingMode ? null : library,
    books,
    isBooksLoading: isReadingMode
      ? isReadingShelfLoading
      : isLibraryBooksLoading,
    canEdit: isReadingMode ? Boolean(user) : libraryCanEdit,
    includeWantToRead,
    setIncludeWantToRead,
    readAndReadingCount: readAndReadingBooks.length,
    wantToReadCount: wantToReadBooks.length,
    refetchShelf,
  };
}
