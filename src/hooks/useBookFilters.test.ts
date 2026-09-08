import {renderHook, act} from '@testing-library/react';
import {useBookFilters} from './useBookFilters';
import {BrowserRouter} from 'react-router-dom';
import {Book} from '../types';
import {Timestamp} from 'firebase/firestore';
import {describe, it, expect, beforeEach} from 'vitest';

const mockBooks: Book[] = [
  {
    id: '1',
    title: 'Zebra',
    author: 'Author Z',
    addedAt: Timestamp.fromMillis(100),
    addedBy: 'test-user',
  } as Book,
  {
    id: '2',
    title: 'Apple',
    author: 'Author A',
    addedAt: Timestamp.fromMillis(200),
    addedBy: 'test-user',
  } as Book,
  {
    id: '3',
    title: 'Banana',
    author: 'Author B',
    addedAt: Timestamp.fromMillis(300),
    addedBy: 'test-user',
  } as Book,
];

describe('useBookFilters', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('defaults to added desc', () => {
    const {result} = renderHook(() => useBookFilters(mockBooks), {
      wrapper: BrowserRouter,
    });

    expect(result.current.sortBy).toBe('added');
    expect(result.current.sortOrder).toBe('desc');
    // Top should be newest (Apple has 200, Banana has 300 -> Banana first)
    expect(result.current.sortedBooks[0].title).toBe('Banana');
  });

  it('sets ascending order by default when switching to title', () => {
    const {result} = renderHook(() => useBookFilters(mockBooks), {
      wrapper: BrowserRouter,
    });

    act(() => {
      result.current.handleSort('title');
    });

    expect(result.current.sortBy).toBe('title');
    expect(result.current.sortOrder).toBe('asc');
    expect(result.current.sortedBooks[0].title).toBe('Apple');
    expect(result.current.sortedBooks[2].title).toBe('Zebra');
  });

  it('sets ascending order by default when switching to author', () => {
    const {result} = renderHook(() => useBookFilters(mockBooks), {
      wrapper: BrowserRouter,
    });

    act(() => {
      result.current.handleSort('author');
    });

    expect(result.current.sortBy).toBe('author');
    expect(result.current.sortOrder).toBe('asc');
    expect(result.current.sortedBooks[0].author).toBe('Author A');
  });

  it('toggles sort order if clicking the same sort option', () => {
    const {result} = renderHook(() => useBookFilters(mockBooks), {
      wrapper: BrowserRouter,
    });

    // switch to title -> should be asc
    act(() => {
      result.current.handleSort('title');
    });
    expect(result.current.sortOrder).toBe('asc');

    // click title again -> should toggle to desc
    act(() => {
      result.current.handleSort('title');
    });
    expect(result.current.sortOrder).toBe('desc');
    expect(result.current.sortedBooks[0].title).toBe('Zebra'); // Z first
  });

  describe('genre taxonomy and subgenre filtering', () => {
    const taxonomyBooks: Book[] = [
      {
        id: '10',
        title: 'Dune',
        author: 'Frank Herbert',
        primaryGenre: 'Science Fiction',
        subgenres: ['Space Opera'],
        addedAt: Timestamp.fromMillis(100),
      } as Book,
      {
        id: '11',
        title: 'Neuromancer',
        author: 'William Gibson',
        primaryGenre: 'Science Fiction',
        subgenres: ['Cyberpunk'],
        addedAt: Timestamp.fromMillis(200),
      } as Book,
      {
        id: '12',
        title: 'Pride and Prejudice',
        author: 'Jane Austen',
        primaryGenre: 'Romance',
        subgenres: ['Historical Romance', 'Regency Romance'],
        addedAt: Timestamp.fromMillis(300),
      } as Book,
      {
        id: '13',
        title: 'Unusual Custom Tome',
        author: 'Obscure Writer',
        primaryGenre: 'Cyberpunk Noir',
        isCustomPrimary: true,
        subgenres: ['Grimdark'],
        addedAt: Timestamp.fromMillis(400),
      } as Book,
    ];

    it('computes availableGenres sorted by frequency with Other for custom genres', () => {
      const {result} = renderHook(() => useBookFilters(taxonomyBooks), {
        wrapper: BrowserRouter,
      });

      // Science Fiction (2), Romance (1) -> Science Fiction first, then Romance, then Other
      expect(result.current.availableGenres[0]).toBe('Science Fiction');
      expect(result.current.availableGenres[1]).toBe('Romance');
      expect(result.current.availableGenres).toContain('Other');
    });

    it('filters books by primary genre and derives activeSubgenres counts', () => {
      const {result} = renderHook(() => useBookFilters(taxonomyBooks), {
        wrapper: BrowserRouter,
      });

      act(() => {
        result.current.setFilterGenre('Science Fiction');
      });

      expect(result.current.filterGenre).toBe('Science Fiction');
      expect(result.current.sortedBooks.length).toBe(2);
      expect(result.current.sortedBooks.map(b => b.title)).toContain('Dune');
      expect(result.current.sortedBooks.map(b => b.title)).toContain(
        'Neuromancer',
      );

      // Check activeSubgenres
      const subNames = result.current.activeSubgenres.map(s => s.name);
      expect(subNames).toContain('Space Opera');
      expect(subNames).toContain('Cyberpunk');
    });

    it('drills down by subgenre', () => {
      const {result} = renderHook(() => useBookFilters(taxonomyBooks), {
        wrapper: BrowserRouter,
      });

      act(() => {
        result.current.setFilterGenre('Science Fiction');
        result.current.setFilterSubgenre('Cyberpunk');
      });

      expect(result.current.filterSubgenre).toBe('Cyberpunk');
      expect(result.current.sortedBooks.length).toBe(1);
      expect(result.current.sortedBooks[0].title).toBe('Neuromancer');
    });

    it('filters by "Other" to match custom primary genres', () => {
      const {result} = renderHook(() => useBookFilters(taxonomyBooks), {
        wrapper: BrowserRouter,
      });

      act(() => {
        result.current.setFilterGenre('Other');
      });

      expect(result.current.sortedBooks.length).toBe(1);
      expect(result.current.sortedBooks[0].title).toBe('Unusual Custom Tome');
    });

    it('clears subgenre filter when primary genre changes or is cleared', () => {
      const {result} = renderHook(() => useBookFilters(taxonomyBooks), {
        wrapper: BrowserRouter,
      });

      act(() => {
        result.current.setFilterGenre('Science Fiction');
        result.current.setFilterSubgenre('Cyberpunk');
      });
      expect(result.current.filterSubgenre).toBe('Cyberpunk');

      act(() => {
        result.current.setFilterGenre('Romance');
      });
      expect(result.current.filterGenre).toBe('Romance');
      expect(result.current.filterSubgenre).toBe('');
    });

    it('matches search query across title, author, primaryGenre, and subgenres', () => {
      const {result} = renderHook(() => useBookFilters(taxonomyBooks), {
        wrapper: BrowserRouter,
      });

      act(() => {
        result.current.setSearchQuery('cyberpunk');
      });

      // Matches Neuromancer (subgenre Cyberpunk) and Unusual Custom Tome (primaryGenre Cyberpunk Noir)
      expect(result.current.sortedBooks.length).toBe(2);
      expect(result.current.sortedBooks.map(b => b.title)).toContain(
        'Neuromancer',
      );
      expect(result.current.sortedBooks.map(b => b.title)).toContain(
        'Unusual Custom Tome',
      );
    });
  });
});
