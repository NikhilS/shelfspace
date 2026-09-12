import {create} from 'zustand';
import {DebugTelemetryEngine} from '../lib/telemetry';

interface DebugLog {
  id: string;
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error';
  payload?: unknown;
}

interface DebugState {
  isDebugMode: boolean;
  logs: DebugLog[];
  debugData: unknown;
  debugTitle: string;
  toggleDebugMode: () => void;
  addLog: (
    message: string,
    level?: DebugLog['level'],
    payload?: unknown,
  ) => void;
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

    addLog: (message, level = 'info', payload?: unknown) =>
      set(state => {
        const newLog: DebugLog = {
          id: Math.random().toString(36).substring(7),
          timestamp: new Date(),
          message,
          level,
          payload,
        };
        console.log(
          `[DEBUG] [${level.toUpperCase()}] ${message}`,
          payload !== undefined ? payload : '',
        );

        // Forward directly to DebugTelemetryEngine so logs are visible in the HUD
        try {
          DebugTelemetryEngine.getInstance().addLog(level, message, payload);
        } catch {
          // Ignore if telemetry engine is not yet initialized
        }

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
  info: (message: string, payload?: unknown) =>
    useDebugStore.getState().addLog(message, 'info', payload),
  warn: (message: string, payload?: unknown) =>
    useDebugStore.getState().addLog(message, 'warn', payload),
  error: (message: string, payload?: unknown) =>
    useDebugStore.getState().addLog(message, 'error', payload),
};

export const useDebug = useDebugStore;
