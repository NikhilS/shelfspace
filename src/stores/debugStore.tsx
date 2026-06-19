import {create} from 'zustand';

interface DebugLog {
  id: string;
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error';
}

interface DebugState {
  isDebugMode: boolean;
  logs: DebugLog[];
  debugData: unknown;
  debugTitle: string;
  toggleDebugMode: () => void;
  addLog: (message: string, level?: DebugLog['level']) => void;
  clearLogs: () => void;
  setDebugData: (data: unknown, title?: string) => void;
}

export const useDebugStore = create<DebugState>(set => {
  const isDebugMode =
    typeof window !== 'undefined'
      ? localStorage.getItem('debugMode') === 'true'
      : false;

  return {
    isDebugMode,
    logs: [],
    debugData: null,
    debugTitle: 'Debug Data',

    toggleDebugMode: () =>
      set(state => {
        const next = !state.isDebugMode;
        localStorage.setItem('debugMode', String(next));
        return {isDebugMode: next};
      }),

    addLog: (message, level = 'info') =>
      set(state => {
        const newLog: DebugLog = {
          id: Math.random().toString(36).substring(7),
          timestamp: new Date(),
          message,
          level,
        };
        console.log(`[DEBUG] [${level.toUpperCase()}] ${message}`);
        return {logs: [newLog, ...state.logs.slice(0, 99)]};
      }),

    clearLogs: () => set({logs: []}),

    setDebugData: (data, title) =>
      set(() => ({
        debugData: data,
        ...(title !== undefined && {debugTitle: title}),
      })),
  };
});

export const logger = {
  info: (message: string) => useDebugStore.getState().addLog(message, 'info'),
  warn: (message: string) => useDebugStore.getState().addLog(message, 'warn'),
  error: (message: string) => useDebugStore.getState().addLog(message, 'error'),
};

export const useDebug = useDebugStore;
