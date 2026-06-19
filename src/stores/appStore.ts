import {create} from 'zustand';
import {persist} from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

interface AppUIState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

export const useAppStore = create<AppUIState>()(
  persist(
    set => ({
      sidebarOpen: false,
      setSidebarOpen: open => set({sidebarOpen: open}),
      theme: 'system',
      setTheme: theme => set({theme}),
    }),
    {
      name: 'app-ui-state',
      partialize: state => ({theme: state.theme}),
    },
  ),
);
