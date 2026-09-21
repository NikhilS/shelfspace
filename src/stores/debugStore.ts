import {create} from 'zustand';
import {DebugTelemetryEngine, TelemetryProfilingLevel} from '../lib/telemetry';

export interface DebugLog {
  id: string;
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error';
  payload?: unknown;
}

export interface DebugState {
  isDebugMode: boolean;
  profilingLevel: TelemetryProfilingLevel;
  logs: DebugLog[];
  debugData: unknown;
  debugTitle: string;
  toggleDebugMode: () => void;
  setProfilingLevel: (level: TelemetryProfilingLevel) => void;
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

  const profilingLevel = DebugTelemetryEngine.getProfilingLevel();

  return {
    isDebugMode,
    profilingLevel,
    logs: [],
    debugData: null,
    debugTitle: 'Debug Data',

    toggleDebugMode: () =>
      set(state => {
        const next = !state.isDebugMode;
        if (typeof window !== 'undefined') {
          localStorage.setItem('debugMode', String(next));
        }
        return {isDebugMode: next};
      }),

    setProfilingLevel: (level: TelemetryProfilingLevel) => {
      DebugTelemetryEngine.setProfilingLevel(level);
      set({profilingLevel: level});
    },

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
