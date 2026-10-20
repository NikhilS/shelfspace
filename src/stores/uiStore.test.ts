import {describe, it, expect, beforeEach} from 'vitest';
import {useUIStore} from './uiStore';

describe('useUIStore Zustand store unit suite', () => {
  beforeEach(() => {
    useUIStore.getState().clearSelection();
  });

  it('toggles individual book selection, bulk toggles all books, and clears selection', () => {
    expect(useUIStore.getState().selectedBookIds.size).toBe(0);

    useUIStore.getState().toggleBookSelection('b1');
    expect(useUIStore.getState().selectedBookIds.has('b1')).toBe(true);

    useUIStore.getState().toggleBookSelection('b1');
    expect(useUIStore.getState().selectedBookIds.has('b1')).toBe(false);

    // Toggle all selects all when not all are currently selected
    useUIStore.getState().toggleAllBooks(['b1', 'b2', 'b3']);
    expect(Array.from(useUIStore.getState().selectedBookIds)).toEqual([
      'b1',
      'b2',
      'b3',
    ]);

    // Calling toggleAllBooks again when all are selected deselects them
    useUIStore.getState().toggleAllBooks(['b1', 'b2', 'b3']);
    expect(useUIStore.getState().selectedBookIds.size).toBe(0);

    useUIStore.getState().toggleBookSelection('b9');
    useUIStore.getState().clearSelection();
    expect(useUIStore.getState().selectedBookIds.size).toBe(0);
  });
});
