import {create} from 'zustand';

interface LibraryState {
  activeLibraryId: string | null;
  setActiveLibraryId: (id: string | null) => void;
}

export const useLibraryStore = create<LibraryState>(set => ({
  activeLibraryId: null,

  setActiveLibraryId: id => set({activeLibraryId: id}),
}));
