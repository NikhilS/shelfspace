import {create} from 'zustand';
import {
  DebugTelemetryEngine,
  TelemetryProfilingLevel,
  createLogger,
} from '../lib/telemetry';

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

  DebugTelemetryEngine.setDebugModeEnabled(isDebugMode);
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
        DebugTelemetryEngine.setDebugModeEnabled(next);
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('debugMode', String(next));
          } catch {
            // Ignore storage errors
          }
        }
        return {isDebugMode: next};
      }),

    setProfilingLevel: (level: TelemetryProfilingLevel) => {
      DebugTelemetryEngine.setProfilingLevel(level);
      set({profilingLevel: level});
    },

    addLog: (message, level = 'info', payload?: unknown) => {
      try {
        DebugTelemetryEngine.getInstance().addLog(level, message, payload, {
          scope: 'App',
        });
      } catch {
        // Ignore if telemetry engine is not yet initialized
      }
    },

    clearLogs: () => {
      DebugTelemetryEngine.getInstance().clearLogs();
      set({logs: []});
    },

    setDebugData: (data, title) =>
      set(() => ({
        debugData: data,
        ...(title !== undefined && {debugTitle: title}),
      })),
  };
});

export const logger = createLogger('App');

export const useDebug = useDebugStore;
