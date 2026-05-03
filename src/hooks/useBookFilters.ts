import {useMemo, useDeferredValue} from 'react';
import {useSearchParams} from 'react-router-dom';
import {Book} from '../types';
import {getFirestoreTime} from '../lib/utils';

export type SortOption = 'added' | 'title' | 'author';

export function useBookFilters(books: Book[]) {
  const [searchParams, setSearchParams] = useSearchParams();

  const currentTab =
    (searchParams.get('tab') as 'overview' | 'collection') || 'overview';
  const sortBy = (searchParams.get('sort') as SortOption) || 'added';
  const sortOrder = (searchParams.get('order') as 'asc' | 'desc') || 'desc';
  const viewMode =
    (searchParams.get('view') as 'standard' | 'table') || 'standard';
  const searchQuery = searchParams.get('q') || '';
  const filterGenre = searchParams.get('genre') || '';
  const filterAuthor = searchParams.get('author') || '';
  const filterYearMin = searchParams.get('yearMin') || '';
  const filterYearMax = searchParams.get('yearMax') || '';
  const isFiltersOpen = searchParams.get('filters') === 'true';

  const deferredSearchQuery = useDeferredValue(searchQuery);

  const setSearchParamsValue = (key: string, value: string | null) => {
    setSearchParams(
      prev => {
        if (value === null || value === '') prev.delete(key);
        else prev.set(key, value);
        return prev;
      },
      {replace: true},
    );
  };

  const availableGenres = useMemo(() => {
    const genres = new Set<string>();
    books.forEach(b => {
      if (b.genres) b.genres.forEach(g => genres.add(g));
    });
    return Array.from(genres).sort();
  }, [books]);

  const availableAuthors = useMemo(() => {
    const authors = new Set<string>();
    books.forEach(b => {
      if (b.author) authors.add(b.author);
    });
    return Array.from(authors).sort();
  }, [books]);

  const filteredBooks = useMemo(() => {
    return books.filter(book => {
      if (deferredSearchQuery) {
        const query = deferredSearchQuery.toLowerCase();
        const titleMatch = book.title?.toLowerCase().includes(query);
        const authorMatch = book.author?.toLowerCase().includes(query);
        if (!titleMatch && !authorMatch) return false;
      }

      if (filterGenre && !book.genres?.includes(filterGenre)) return false;
      if (filterAuthor && book.author !== filterAuthor) return false;

      if (filterYearMin || filterYearMax) {
        const yearMatch = book.publishedDate?.match(/\d{4}/);
        const year = yearMatch ? parseInt(yearMatch[0], 10) : null;
        if (
          filterYearMin &&
          (year === null || year < parseInt(filterYearMin, 10))
        )
          return false;
        if (
          filterYearMax &&
          (year === null || year > parseInt(filterYearMax, 10))
        )
          return false;
      }

      return true;
    });
  }, [
    books,
    deferredSearchQuery,
    filterGenre,
    filterAuthor,
    filterYearMin,
    filterYearMax,
  ]);

  const sortedBooks = useMemo(() => {
    const sorted = [...filteredBooks];
    if (sortBy === 'title') {
      sorted.sort((a, b) => {
        const titleA = a.title || '';
        const titleB = b.title || '';
        return sortOrder === 'asc'
          ? titleA.localeCompare(titleB)
          : titleB.localeCompare(titleA);
      });
    } else if (sortBy === 'author') {
      sorted.sort((a, b) => {
        const authorA = a.author || '';
        const authorB = b.author || '';
        return sortOrder === 'asc'
          ? authorA.localeCompare(authorB)
          : authorB.localeCompare(authorA);
      });
    } else {
      sorted.sort((a, b) => {
        const timeA = getFirestoreTime(a.addedAt);
        const timeB = getFirestoreTime(b.addedAt);
        return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      });
    }
    return sorted;
  }, [filteredBooks, sortBy, sortOrder]);

  const handleSort = (option: SortOption) => {
    if (sortBy === option) {
      setSearchParamsValue('order', sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSearchParams(
        prev => {
          prev.set('sort', option);
          // Default to asc for title/author, desc for added
          prev.set('order', option === 'added' ? 'desc' : 'asc');
          return prev;
        },
        {replace: true},
      );
    }
  };

  return {
    currentTab,
    setCurrentTab: (tab: 'overview' | 'collection') =>
      setSearchParamsValue('tab', tab),
    sortBy,
    setSortBy: handleSort,
    handleSort,
    sortOrder,
    setSortOrder: (order: 'asc' | 'desc') =>
      setSearchParamsValue('order', order),
    viewMode,
    setViewMode: (view: 'standard' | 'table') =>
      setSearchParamsValue('view', view),
    searchQuery,
    setSearchQuery: (q: string) => setSearchParamsValue('q', q),
    filterGenre,
    setFilterGenre: (genre: string) => setSearchParamsValue('genre', genre),
    filterAuthor,
    setFilterAuthor: (author: string) => setSearchParamsValue('author', author),
    filterYearMin,
    setFilterYearMin: (yr: string) => setSearchParamsValue('yearMin', yr),
    filterYearMax,
    setFilterYearMax: (yr: string) => setSearchParamsValue('yearMax', yr),
    isFiltersOpen,
    setIsFiltersOpen: (open: boolean) =>
      setSearchParamsValue('filters', open ? 'true' : null),
    availableGenres,
    availableAuthors,
    sortedBooks,
    clearFilters: () => {
      setSearchParams(
        prev => {
          prev.delete('q');
          prev.delete('genre');
          prev.delete('author');
          prev.delete('yearMin');
          prev.delete('yearMax');
          return prev;
        },
        {replace: true},
      );
    },
  };
}
