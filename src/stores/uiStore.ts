import {create} from 'zustand';

interface UIState {
  selectedBookIds: Set<string>;
  toggleBookSelection: (bookId: string) => void;
  toggleAllBooks: (bookIds: string[]) => void;
  clearSelection: () => void;
}

export const useUIStore = create<UIState>(set => ({
  selectedBookIds: new Set(),

  toggleBookSelection: bookId =>
    set(state => {
      const next = new Set(state.selectedBookIds);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return {selectedBookIds: next};
    }),

  toggleAllBooks: bookIds =>
    set(state => {
      const allSelected = bookIds.every(id => state.selectedBookIds.has(id));
      const next = new Set(state.selectedBookIds);

      if (allSelected) {
        bookIds.forEach(id => next.delete(id));
      } else {
        bookIds.forEach(id => next.add(id));
      }

      return {selectedBookIds: next};
    }),

  clearSelection: () => set({selectedBookIds: new Set()}),
}));
