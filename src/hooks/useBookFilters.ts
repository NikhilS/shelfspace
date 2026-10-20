import {useState, useEffect, useRef, useMemo, useDeferredValue} from 'react';
import {
  useSearchParams,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router-dom';
import {Book} from '../types';
import {getFirestoreTime} from '../lib/utils';
import {CANONICAL_PRIMARY_GENRES} from '../constants/taxonomy';

export type SortOption = 'added' | 'title' | 'author';

interface IndexedBookEntry {
  book: Book;
  titleLower: string;
  authorLower: string;
  primaryGenreLower: string;
  subgenresLower: string[];
  isbnLower: string;
  pubYear: number | null;
  addedAtMs: number;
}

const CANONICAL_SET = new Set<string>(CANONICAL_PRIMARY_GENRES);

export function useBookFilters(books: Book[]) {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const {id} = useParams<{id: string}>();

  const currentTab: 'overview' | 'collection' = location.pathname.endsWith(
    '/collection',
  )
    ? 'collection'
    : 'overview';
  const sortBy = (searchParams.get('sort') as SortOption) || 'added';
  const sortOrder = (searchParams.get('order') as 'asc' | 'desc') || 'desc';
  const viewMode =
    (searchParams.get('view') as 'standard' | 'table') || 'standard';
  const urlSearchQuery = searchParams.get('q') || '';
  const filterGenre = searchParams.get('genre') || '';
  const filterSubgenre = searchParams.get('subgenre') || '';
  const filterAuthor = searchParams.get('author') || '';
  const filterYearMin = searchParams.get('yearMin') || '';
  const filterYearMax = searchParams.get('yearMax') || '';
  const isFiltersOpen = searchParams.get('filters') === 'true';

  // Local input state for sub-16ms keystroke responsiveness, synced to URL after 300ms debounce
  const [localSearchQuery, setLocalSearchQuery] = useState(urlSearchQuery);
  const lastCommittedUrlQueryRef = useRef(urlSearchQuery);

  // Sync inward when URL ?q= parameter changes externally (e.g. Back/Forward navigation)
  useEffect(() => {
    if (urlSearchQuery !== lastCommittedUrlQueryRef.current) {
      lastCommittedUrlQueryRef.current = urlSearchQuery;
      setLocalSearchQuery(urlSearchQuery);
    }
  }, [urlSearchQuery]);

  // Sync outward from localSearchQuery to URL ?q= parameter after a 300ms debounce
  useEffect(() => {
    if (localSearchQuery === urlSearchQuery) return undefined;

    const timer = setTimeout(() => {
      lastCommittedUrlQueryRef.current = localSearchQuery;
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (!localSearchQuery) next.delete('q');
          else next.set('q', localSearchQuery);
          return next;
        },
        {replace: true},
      );
    }, 300);

    return () => clearTimeout(timer);
  }, [localSearchQuery, urlSearchQuery, setSearchParams]);

  const deferredSearchQuery = useDeferredValue(localSearchQuery);

  const setSearchParamsValue = (key: string, value: string | null) => {
    setSearchParams(
      prev => {
        const next = new URLSearchParams(prev);
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
        return next;
      },
      {replace: true},
    );
  };

  // Pre-index normalized strings, publication years, and addedAt timestamps once per books array change
  const indexedBooks = useMemo<IndexedBookEntry[]>(() => {
    return books.map(book => {
      const yearMatch = book.publishedDate?.match(/\d{4}/);
      return {
        book,
        titleLower: book.title ? book.title.toLowerCase() : '',
        authorLower: book.author ? book.author.toLowerCase() : '',
        primaryGenreLower: book.primaryGenre
          ? book.primaryGenre.trim().toLowerCase()
          : '',
        subgenresLower: book.subgenres
          ? book.subgenres.map(sg => (sg ? sg.trim().toLowerCase() : ''))
          : [],
        isbnLower: book.isbn ? book.isbn.toLowerCase() : '',
        pubYear: yearMatch ? parseInt(yearMatch[0], 10) : null,
        addedAtMs: getFirestoreTime(book.addedAt),
      };
    });
  }, [books]);

  const availableGenres = useMemo(() => {
    const counts: Record<string, number> = {};
    let customCount = 0;
    for (let i = 0; i < books.length; i++) {
      const pg = books[i].primaryGenre;
      if (pg) {
        if (CANONICAL_SET.has(pg)) {
          counts[pg] = (counts[pg] || 0) + 1;
        } else {
          customCount++;
        }
      }
    }

    const activeCanonical = CANONICAL_PRIMARY_GENRES.filter(
      g => (counts[g] || 0) > 0,
    ).sort((a, b) => (counts[b] || 0) - (counts[a] || 0));

    if (customCount > 0) {
      activeCanonical.push('Other');
    }
    return activeCanonical;
  }, [books]);

  const activeSubgenres = useMemo(() => {
    if (!filterGenre) return [];
    const targetLower = filterGenre.trim().toLowerCase();
    const isOther = targetLower === 'other';
    const counts: Record<string, number> = {};

    for (let i = 0; i < indexedBooks.length; i++) {
      const entry = indexedBooks[i];
      const matchesPrimary = isOther
        ? Boolean(entry.book.isCustomPrimary)
        : entry.primaryGenreLower === targetLower;
      if (matchesPrimary && entry.book.subgenres) {
        for (const sg of entry.book.subgenres) {
          if (sg) counts[sg] = (counts[sg] || 0) + 1;
        }
      }
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({name, count}));
  }, [indexedBooks, filterGenre]);

  const availableAuthors = useMemo(() => {
    const authors = new Set<string>();
    for (let i = 0; i < books.length; i++) {
      if (books[i].author) authors.add(books[i].author);
    }
    return Array.from(authors).sort();
  }, [books]);

  const filteredIndexedBooks = useMemo(() => {
    const effectiveQuery = (deferredSearchQuery || localSearchQuery)
      .trim()
      .toLowerCase();
    const normalizedGenre = filterGenre ? filterGenre.trim().toLowerCase() : '';
    const isOtherGenre = normalizedGenre === 'other';
    const normalizedSubgenre = filterSubgenre
      ? filterSubgenre.trim().toLowerCase()
      : '';
    const minYearNum = filterYearMin ? parseInt(filterYearMin, 10) : null;
    const maxYearNum = filterYearMax ? parseInt(filterYearMax, 10) : null;

    return indexedBooks.filter(entry => {
      if (effectiveQuery) {
        const titleMatch = entry.titleLower.includes(effectiveQuery);
        const authorMatch = entry.authorLower.includes(effectiveQuery);
        const isbnMatch =
          entry.isbnLower.length > 0 &&
          entry.isbnLower.includes(effectiveQuery);
        const genreMatch =
          entry.primaryGenreLower.includes(effectiveQuery) ||
          entry.subgenresLower.some(sg => sg.includes(effectiveQuery));
        if (!titleMatch && !authorMatch && !isbnMatch && !genreMatch) {
          return false;
        }
      }

      if (normalizedGenre) {
        const matchesPrimary = isOtherGenre
          ? Boolean(entry.book.isCustomPrimary)
          : entry.primaryGenreLower === normalizedGenre;
        const matchesSubgenre = entry.subgenresLower.some(
          sg => sg === normalizedGenre,
        );
        if (!matchesPrimary && !matchesSubgenre) return false;
      }

      if (normalizedSubgenre) {
        const matchesSub = entry.subgenresLower.some(
          sg => sg === normalizedSubgenre,
        );
        if (!matchesSub) return false;
      }

      if (filterAuthor && entry.book.author !== filterAuthor) return false;

      if (minYearNum !== null && !Number.isNaN(minYearNum)) {
        if (entry.pubYear === null || entry.pubYear < minYearNum) return false;
      }
      if (maxYearNum !== null && !Number.isNaN(maxYearNum)) {
        if (entry.pubYear === null || entry.pubYear > maxYearNum) return false;
      }

      return true;
    });
  }, [
    indexedBooks,
    deferredSearchQuery,
    localSearchQuery,
    filterGenre,
    filterSubgenre,
    filterAuthor,
    filterYearMin,
    filterYearMax,
  ]);

  const sortedBooks = useMemo(() => {
    const sorted = [...filteredIndexedBooks];
    if (sortBy === 'title') {
      sorted.sort((a, b) => {
        const titleA = a.book.title || '';
        const titleB = b.book.title || '';
        return sortOrder === 'asc'
          ? titleA.localeCompare(titleB)
          : titleB.localeCompare(titleA);
      });
    } else if (sortBy === 'author') {
      sorted.sort((a, b) => {
        const authorA = a.book.author || '';
        const authorB = b.book.author || '';
        return sortOrder === 'asc'
          ? authorA.localeCompare(authorB)
          : authorB.localeCompare(authorA);
      });
    } else {
      sorted.sort((a, b) =>
        sortOrder === 'asc'
          ? a.addedAtMs - b.addedAtMs
          : b.addedAtMs - a.addedAtMs,
      );
    }
    return sorted.map(entry => entry.book);
  }, [filteredIndexedBooks, sortBy, sortOrder]);

  const handleSort = (option: SortOption) => {
    if (sortBy === option) {
      setSearchParamsValue('order', sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.set('sort', option);
          next.set('order', option === 'added' ? 'desc' : 'asc');
          return next;
        },
        {replace: true},
      );
    }
  };

  return {
    currentTab,
    setCurrentTab: (tab: 'overview' | 'collection') => {
      void navigate(
        tab === 'collection' ? `/library/${id}/collection` : `/library/${id}`,
      );
    },
    sortBy,
    setSortBy: handleSort,
    handleSort,
    sortOrder,
    setSortOrder: (order: 'asc' | 'desc') =>
      setSearchParamsValue('order', order),
    viewMode,
    setViewMode: (view: 'standard' | 'table') =>
      setSearchParamsValue('view', view),
    searchQuery: localSearchQuery,
    setSearchQuery: (q: string) => {
      setLocalSearchQuery(q);
      if (!q) {
        lastCommittedUrlQueryRef.current = '';
        setSearchParamsValue('q', null);
      }
    },
    filterGenre,
    setFilterGenre: (genre: string) => {
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          if (!genre) {
            next.delete('genre');
            next.delete('subgenre');
          } else {
            next.set('genre', genre);
            next.delete('subgenre');
          }
          return next;
        },
        {replace: true},
      );
    },
    filterSubgenre,
    setFilterSubgenre: (subgenre: string) =>
      setSearchParamsValue('subgenre', subgenre),
    activeSubgenres,
    selectGenreAndGoToCollection: (genre: string, subgenre?: string) => {
      const params = new URLSearchParams(searchParams);
      if (genre) params.set('genre', genre);
      else params.delete('genre');
      if (subgenre) params.set('subgenre', subgenre);
      else params.delete('subgenre');
      params.set('filters', 'true');
      params.delete('tab');
      void navigate(`/library/${id}/collection?${params.toString()}`);
    },
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
      setLocalSearchQuery('');
      lastCommittedUrlQueryRef.current = '';
      setSearchParams(
        prev => {
          const next = new URLSearchParams(prev);
          next.delete('q');
          next.delete('genre');
          next.delete('subgenre');
          next.delete('author');
          next.delete('yearMin');
          next.delete('yearMax');
          return next;
        },
        {replace: true},
      );
    },
  };
}
