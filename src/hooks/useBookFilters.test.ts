import {renderHook, act} from '@testing-library/react';
import {useBookFilters} from './useBookFilters';
import {BrowserRouter} from 'react-router-dom';
import {Book} from '../types';
import {Timestamp} from 'firebase/firestore';
import {describe, it, expect} from 'vitest';

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
});
