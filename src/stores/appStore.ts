import {create} from 'zustand';
import {persist} from 'zustand/middleware';

export type ThemeMode = 'light' | 'dark' | 'system';

interface AppUIState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

export const useAppStore = create<AppUIState>()(
  persist(
    set => ({
      theme: 'system',
      setTheme: theme => set({theme}),
    }),
    {
      name: 'app-ui-state',
      partialize: state => ({theme: state.theme}),
    },
  ),
);
