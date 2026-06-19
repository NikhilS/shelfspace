import {create} from 'zustand';

interface AppUIState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  // Ephemeral selected book IDs could go here or remain in useSelection hook.
  // I will add some generic UI state here.
}

export const useAppStore = create<AppUIState>(set => ({
  sidebarOpen: false,
  setSidebarOpen: open => set({sidebarOpen: open}),
}));
