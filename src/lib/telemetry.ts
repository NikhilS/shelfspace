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

  // Phase 0 Persistence & Payload Telemetry
  totalBytesTransferred: number;
  lastQueryPayloadBytes: number;
  averageBookDocumentBytes: number;
  activeFirestoreListeners: number;
  cacheEfficiencyRatio: number;
  snapshotParseDurationMs: number;
}

export interface ActiveListenerInfo {
  id: string;
  name: string;
  path: string;
  startedAt: string;
}

export interface TelemetryBaseline {
  timestamp: string;
  metrics: TelemetryMetrics;
}

/**
 * Safely calculates the byte size of any data object / payload in UTF-8.
 */
export function calculatePayloadBytes(data: unknown): number {
  if (data === undefined || data === null) return 0;
  try {
    if (typeof data === 'string') {
      return new Blob([data]).size;
    }
    const json = JSON.stringify(data);
    return new Blob([json]).size;
  } catch {
    return 0;
  }
}

export class DebugTelemetryEngine {
  private static instance: DebugTelemetryEngine | null = null;
  private logs: TelemetryLog[] = [];
  private maxLogs = 200;
  private subscribers: Set<() => void> = new Set();
  private activeStates: Record<string, unknown> = {};
  private activeListeners: Map<string, ActiveListenerInfo> = new Map();
  private baseline: TelemetryBaseline | null = null;
  private bookDocByteSamples: number[] = [];

  private metrics: TelemetryMetrics = {
    totalApiRequests: 0,
    averageApiLatency: 0,
    totalFirestoreReads: 0,
    firestoreCacheHits: 0,
    totalGeminiQueries: 0,
    totalGeminiTokens: 0,
    activeWorkers: 0,
    totalBytesTransferred: 0,
    lastQueryPayloadBytes: 0,
    averageBookDocumentBytes: 0,
    activeFirestoreListeners: 0,
    cacheEfficiencyRatio: 100,
    snapshotParseDurationMs: 0,
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

  // Register and track active Firestore onSnapshot listeners
  public registerListener(name: string, path: string): () => void {
    const id = Math.random().toString(36).substring(7);
    const info: ActiveListenerInfo = {
      id,
      name,
      path,
      startedAt: new Date().toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    };

    this.activeListeners.set(id, info);
    this.metrics.activeFirestoreListeners = this.activeListeners.size;
    this.notifySubscribers();

    return () => {
      this.activeListeners.delete(id);
      this.metrics.activeFirestoreListeners = this.activeListeners.size;
      this.notifySubscribers();
    };
  }

  public getActiveListeners(): ActiveListenerInfo[] {
    return Array.from(this.activeListeners.values());
  }

  // Baseline capture for Before/After comparison
  public captureBaseline(): TelemetryBaseline {
    this.baseline = {
      timestamp: new Date().toLocaleTimeString([], {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      metrics: {...this.metrics},
    };
    this.notifySubscribers();
    return this.baseline;
  }

  public getBaseline(): TelemetryBaseline | null {
    return this.baseline
      ? {
          timestamp: this.baseline.timestamp,
          metrics: {...this.baseline.metrics},
        }
      : null;
  }

  public clearBaseline() {
    this.baseline = null;
    this.notifySubscribers();
  }

  public resetMetrics() {
    this.metrics = {
      totalApiRequests: 0,
      averageApiLatency: 0,
      totalFirestoreReads: 0,
      firestoreCacheHits: 0,
      totalGeminiQueries: 0,
      totalGeminiTokens: 0,
      activeWorkers: 0,
      totalBytesTransferred: 0,
      lastQueryPayloadBytes: 0,
      averageBookDocumentBytes: 0,
      activeFirestoreListeners: this.activeListeners.size,
      cacheEfficiencyRatio: 100,
      snapshotParseDurationMs: 0,
    };
    this.latencies = [];
    this.bookDocByteSamples = [];
    this.baseline = null;
    this.notifySubscribers();
  }

  // Add Log Entry
  public addLog(type: LogLevel, message: string, payload?: unknown) {
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
      const p = payload as
        | {
            fromCache?: boolean;
            bytes?: number;
            docCount?: number;
            parseDurationMs?: number;
          }
        | undefined;

      if (p?.fromCache) {
        this.metrics.firestoreCacheHits++;
      }

      if (this.metrics.totalFirestoreReads > 0) {
        this.metrics.cacheEfficiencyRatio = Math.round(
          (this.metrics.firestoreCacheHits / this.metrics.totalFirestoreReads) *
            100,
        );
      }

      if (p?.bytes !== undefined && p.bytes > 0) {
        this.metrics.totalBytesTransferred += p.bytes;
        this.metrics.lastQueryPayloadBytes = p.bytes;

        if (p.docCount && p.docCount > 0) {
          const avgForThis = Math.round(p.bytes / p.docCount);
          this.bookDocByteSamples.push(avgForThis);
          if (this.bookDocByteSamples.length > 20) {
            this.bookDocByteSamples.shift();
          }
          const sum = this.bookDocByteSamples.reduce((a, b) => a + b, 0);
          this.metrics.averageBookDocumentBytes = Math.round(
            sum / this.bookDocByteSamples.length,
          );
        }
      }

      if (p?.parseDurationMs !== undefined) {
        this.metrics.snapshotParseDurationMs = p.parseDurationMs;
      }
    } else if (type === 'api_res') {
      this.metrics.totalApiRequests++;
      const p = payload as {durationMs?: number; bytes?: number} | undefined;
      if (p?.durationMs) {
        this.latencies.push(p.durationMs);
        if (this.latencies.length > 50) this.latencies.shift(); // keep sliding window
        const sum = this.latencies.reduce((a, b) => a + b, 0);
        this.metrics.averageApiLatency = Math.round(
          sum / this.latencies.length,
        );
      }
      if (p?.bytes) {
        this.metrics.totalBytesTransferred += p.bytes;
      }
    } else if (type === 'gen_ai') {
      this.metrics.totalGeminiQueries++;
      const p = payload as {tokens?: number} | undefined;
      if (p?.tokens) {
        this.metrics.totalGeminiTokens += p.tokens;
      }
    } else if (type === 'worker') {
      const p = payload as {activeCount?: number} | undefined;
      if (p?.activeCount !== undefined) {
        this.metrics.activeWorkers = p.activeCount;
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
    originalLog(...args);
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
    originalWarn(...args);
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

    // Ignore benign internal Firestore stream timeout logs to keep console clean
    if (
      msg.includes('Disconnecting idle stream') ||
      msg.includes('Timed out waiting for new targets') ||
      msg.includes('GrpcConnection RPC')
    ) {
      return;
    }

    if (!msg.includes('[TELEMETRY_INTERNAL]')) {
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        msg,
        args.length > 1 ? args : undefined,
      );
    }
    originalError(...args);
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
    originalInfo(...args);
  };

  isIntercepted = true;
}
