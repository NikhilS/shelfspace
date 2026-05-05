import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from 'react';

interface DebugLog {
  id: string;
  timestamp: Date;
  message: string;
  level: 'info' | 'warn' | 'error';
}

interface DebugContextType {
  isDebugMode: boolean;
  toggleDebugMode: () => void;
  logs: DebugLog[];
  addLog: (message: string, level?: DebugLog['level']) => void;
  clearLogs: () => void;
  debugData: unknown;
  setDebugData: (data: unknown, title?: string) => void;
  debugTitle: string;
}

const DebugContext = createContext<DebugContextType | undefined>(undefined);

// Global state for logs that can be accessed outside React
let globalAddLog: ((message: string, level: DebugLog['level']) => void) | null =
  null;

export const logger = {
  info: (message: string) => globalAddLog?.(message, 'info'),
  warn: (message: string) => globalAddLog?.(message, 'warn'),
  error: (message: string) => globalAddLog?.(message, 'error'),
};

export const DebugProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [isDebugMode, setIsDebugMode] = useState(false);
  const [logs, setLogs] = useState<DebugLog[]>([]);
  const [debugData, setDebugDataState] = useState<unknown>(null);
  const [debugTitle, setDebugTitle] = useState('Debug Data');

  useEffect(() => {
    const stored = localStorage.getItem('debugMode');
    if (stored === 'true') {
      setIsDebugMode(true);
    }
  }, []);

  const toggleDebugMode = useCallback(() => {
    setIsDebugMode(prev => {
      const next = !prev;
      localStorage.setItem('debugMode', String(next));
      return next;
    });
  }, []);

  const addLog = useCallback(
    (message: string, level: DebugLog['level'] = 'info') => {
      setLogs(prev => [
        {
          id: Math.random().toString(36).substring(7),
          timestamp: new Date(),
          message,
          level,
        },
        ...prev.slice(0, 99), // Keep last 100 logs
      ]);
      console.log(`[DEBUG] [${level.toUpperCase()}] ${message}`);
    },
    [],
  );

  useEffect(() => {
    globalAddLog = addLog;
    return () => {
      globalAddLog = null;
    };
  }, [addLog]);

  const clearLogs = useCallback(() => {
    setLogs([]);
  }, []);

  const setDebugData = useCallback((data: unknown, title?: string) => {
    setDebugDataState(data);
    if (title) setDebugTitle(title);
  }, []);

  return (
    <DebugContext.Provider
      value={{
        isDebugMode,
        toggleDebugMode,
        logs,
        addLog,
        clearLogs,
        debugData,
        setDebugData,
        debugTitle,
      }}
    >
      {children}
    </DebugContext.Provider>
  );
};

export const useDebug = () => {
  const context = useContext(DebugContext);
  if (context === undefined) {
    throw new Error('useDebug must be used within a DebugProvider');
  }
  return context;
};
