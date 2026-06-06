export type LogLevel =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'db_read'
  | 'api_res'
  | 'worker'
  | 'gen_ai';

export interface TelemetryLog {
  id: string;
  timestamp: string; // "13:14:02" format
  timestampObj: Date;
  type: LogLevel;
  message: string;
  payload?: unknown;
}

export interface TelemetryMetrics {
  totalApiRequests: number;
  averageApiLatency: number;
  totalFirestoreReads: number;
  firestoreCacheHits: number;
  totalGeminiQueries: number;
  totalGeminiTokens: number;
  activeWorkers: number;
}

export class DebugTelemetryEngine {
  private static instance: DebugTelemetryEngine | null = null;
  private logs: TelemetryLog[] = [];
  private maxLogs = 200;
  private subscribers: Set<() => void> = new Set();
  private activeStates: Record<string, unknown> = {};

  private metrics: TelemetryMetrics = {
    totalApiRequests: 0,
    averageApiLatency: 0,
    totalFirestoreReads: 0,
    firestoreCacheHits: 0,
    totalGeminiQueries: 0,
    totalGeminiTokens: 0,
    activeWorkers: 0,
  };

  private latencies: number[] = [];

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): DebugTelemetryEngine {
    if (!this.instance) {
      this.instance = new DebugTelemetryEngine();
    }
    return this.instance;
  }

  // Add Log Entry
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  public addLog(type: LogLevel, message: string, payload?: any) {
    const timestampObj = new Date();
    const timestamp = timestampObj.toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const entry: TelemetryLog = {
      id: Math.random().toString(36).substring(7),
      timestamp,
      timestampObj,
      type,
      message,
      payload: this.safeClone(payload),
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    // Process type-specific metric aggregations on the telemetry stream
    if (type === 'db_read') {
      this.metrics.totalFirestoreReads++;
      if (payload?.fromCache) {
        this.metrics.firestoreCacheHits++;
      }
    } else if (type === 'api_res') {
      this.metrics.totalApiRequests++;
      if (payload?.durationMs) {
        this.latencies.push(payload.durationMs);
        if (this.latencies.length > 50) this.latencies.shift(); // keep sliding window
        const sum = this.latencies.reduce((a, b) => a + b, 0);
        this.metrics.averageApiLatency = Math.round(
          sum / this.latencies.length,
        );
      }
    } else if (type === 'gen_ai') {
      this.metrics.totalGeminiQueries++;
      if (payload?.tokens) {
        this.metrics.totalGeminiTokens += payload.tokens;
      }
    } else if (type === 'worker') {
      if (payload?.activeCount !== undefined) {
        this.metrics.activeWorkers = payload.activeCount;
      }
    }

    this.notifySubscribers();
  }

  // Get current logs
  public getLogs(): TelemetryLog[] {
    return [...this.logs];
  }

  // Clear logs helper
  public clearLogs() {
    this.logs = [];
    this.notifySubscribers();
  }

  // Subscriber pattern
  public subscribe(sub: () => void): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  private notifySubscribers() {
    this.subscribers.forEach(sub => {
      try {
        sub();
      } catch {
        // Safe protection from dead/erroneous components
      }
    });
  }

  // Live Component / Hook State inspection tracking
  public updateState(moduleName: string, stateObject: unknown) {
    this.activeStates[moduleName] = this.safeClone(stateObject);
    this.notifySubscribers();
  }

  public removeState(moduleName: string) {
    delete this.activeStates[moduleName];
    this.notifySubscribers();
  }

  public getActiveStates(): Record<string, unknown> {
    return {...this.activeStates};
  }

  // Dynamic diagnostics getters
  public getMetrics(): TelemetryMetrics {
    return {...this.metrics};
  }

  // Safe payload copy utility preventing circular JSON reference crashes
  private safeClone(val: unknown): unknown {
    if (val === undefined || val === null) return val;
    try {
      return JSON.parse(JSON.stringify(val));
    } catch {
      // Circular reference or generic fallback parsing fallback
      return '[Non-serializable payload]';
    }
  }
}

// Global Console interceptor activation helper
let isIntercepted = false;

export function interceptConsoleLogs() {
  if (isIntercepted) return;
  if (typeof window === 'undefined') return;

  const originalLog = window.console.log;
  const originalWarn = window.console.warn;
  const originalError = window.console.error;
  const originalInfo = window.console.info;

  window.console.log = function (...args: unknown[]) {
    const msg = args
      .map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return '[Object]';
          }
        }
        return String(arg);
      })
      .join(' ');

    if (!msg.startsWith('[DEBUG]') && !msg.includes('[TELEMETRY_INTERNAL]')) {
      DebugTelemetryEngine.getInstance().addLog(
        'log',
        msg,
        args.length > 1 ? args : undefined,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalLog.apply(window.console, args as any[]);
  };

  window.console.warn = function (...args: unknown[]) {
    const msg = args
      .map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return '[Object]';
          }
        }
        return String(arg);
      })
      .join(' ');

    if (!msg.includes('[TELEMETRY_INTERNAL]')) {
      DebugTelemetryEngine.getInstance().addLog(
        'warn',
        msg,
        args.length > 1 ? args : undefined,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalWarn.apply(window.console, args as any[]);
  };

  window.console.error = function (...args: unknown[]) {
    const msg = args
      .map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return '[Object]';
          }
        }
        return String(arg);
      })
      .join(' ');

    if (!msg.includes('[TELEMETRY_INTERNAL]')) {
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        msg,
        args.length > 1 ? args : undefined,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalError.apply(window.console, args as any[]);
  };

  window.console.info = function (...args: unknown[]) {
    const msg = args
      .map(arg => {
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return '[Object]';
          }
        }
        return String(arg);
      })
      .join(' ');

    if (!msg.includes('[TELEMETRY_INTERNAL]')) {
      DebugTelemetryEngine.getInstance().addLog(
        'info',
        msg,
        args.length > 1 ? args : undefined,
      );
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    originalInfo.apply(window.console, args as any[]);
  };

  isIntercepted = true;
}
