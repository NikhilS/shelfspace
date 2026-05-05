import {renderHook, act} from '@testing-library/react';
import {describe, it, expect, vi, beforeEach} from 'vitest';
import {useSelection} from './useSelection';
import {updateDoc} from 'firebase/firestore';
import {toast} from 'sonner';
import React from 'react';
import {Book} from '../types';

// Mock dependencies
vi.mock('firebase/firestore', () => ({
  doc: vi.fn(),
  updateDoc: vi.fn(() => Promise.resolve()),
}));

vi.mock('../firebase', () => ({
  db: {},
  handleFirestoreError: vi.fn(),
  OperationType: {
    UPDATE: 'update',
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('useSelection', () => {
  const libraryId = 'lib123';
  const userId = 'user456';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toggles book selection', () => {
    const {result} = renderHook(() => useSelection(libraryId, userId));
    const mockEvent = {stopPropagation: vi.fn()} as unknown as React.MouseEvent;

    act(() => {
      result.current.toggleBookSelection(mockEvent, 'book1');
    });
    expect(result.current.selectedBooks.has('book1')).toBe(true);

    act(() => {
      result.current.toggleBookSelection(mockEvent, 'book1');
    });
    expect(result.current.selectedBooks.has('book1')).toBe(false);
  });

  it('selects and deselects all books', () => {
    const {result} = renderHook(() => useSelection(libraryId, userId));
    const books = [
      {id: 'book1'} as unknown as Book,
      {id: 'book2'} as unknown as Book,
    ];

    act(() => {
      result.current.toggleAllBooks(books);
    });
    expect(result.current.selectedBooks.size).toBe(2);

    act(() => {
      result.current.toggleAllBooks(books);
    });
    expect(result.current.selectedBooks.size).toBe(0);
  });

  it('clears selection', () => {
    const {result} = renderHook(() => useSelection(libraryId, userId));
    const mockEvent = {stopPropagation: vi.fn()} as unknown as React.MouseEvent;

    act(() => {
      result.current.toggleBookSelection(mockEvent, 'book1');
    });
    expect(result.current.selectedBooks.size).toBe(1);

    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selectedBooks.size).toBe(0);
  });

  it('handles bulk status change', async () => {
    const {result} = renderHook(() => useSelection(libraryId, userId));
    const mockEvent = {stopPropagation: vi.fn()} as unknown as React.MouseEvent;

    act(() => {
      result.current.toggleBookSelection(mockEvent, 'book1');
      result.current.toggleBookSelection(mockEvent, 'book2');
    });

    await act(async () => {
      await result.current.handleBulkStatusChange('reading');
    });

    expect(updateDoc).toHaveBeenCalledTimes(2);
    expect(toast.success).toHaveBeenCalledWith('Updated status for 2 books');
    expect(result.current.selectedBooks.size).toBe(0);
  });
});
