export type LogLevel =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'db_read'
  | 'db_write'
  | 'api_res'
  | 'worker'
  | 'gen_ai';

export type MutationType =
  'setDoc' | 'updateDoc' | 'deleteDoc' | 'writeBatch' | 'addDoc';

export type TelemetryProfilingLevel = 'off' | 'basic' | 'high_fidelity';

export interface SizingOptions {
  level?: TelemetryProfilingLevel;
  maxSamples?: number;
}

export interface MutationTelemetryPayload {
  mutationType: MutationType;
  path: string;
  bytes: number;
  commitDurationMs: number;
  optimisticLatencyMs?: number;
  operationCount?: number;
  payload?: unknown;
  status: 'success' | 'error';
  error?: string;
}

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

  // Phase 4 Full-Spectrum Write Telemetry
  totalFirestoreWrites: number;
  totalBytesWritten: number;
  lastWritePayloadBytes: number;
  averageWriteLatency: number;
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

export interface TelemetryPluginContext {
  logs: TelemetryLog[];
  metrics: TelemetryMetrics;
  activeStates: Record<string, unknown>;
  activeListeners: ActiveListenerInfo[];
  baseline: TelemetryBaseline | null;
  engine: DebugTelemetryEngine;
  isOnline: boolean;
}

export interface TelemetryPlugin {
  id: string;
  name: string;
  order?: number;
  icon: React.ComponentType<{className?: string; size?: number}>;
  badge?: (ctx: TelemetryPluginContext) => string | number | undefined;
  onLog?: (entry: TelemetryLog, engine: DebugTelemetryEngine) => void;
  renderTab: (ctx: TelemetryPluginContext) => React.ReactNode;
  getMetrics?: () => Record<string, unknown>;
  onMetricUpdate?: (metrics: TelemetryMetrics) => void;
}

/**
 * Calculates UTF-8 string byte size quickly without allocating Blob instances.
 */
export function estimateStringBytes(str: string): number {
  let bytes = 0;
  const len = str.length;
  for (let i = 0; i < len; i++) {
    const codePoint = str.charCodeAt(i);
    if (codePoint < 0x80) {
      bytes += 1;
    } else if (codePoint < 0x800) {
      bytes += 2;
    } else if (codePoint >= 0xd800 && codePoint <= 0xdbff) {
      bytes += 4;
      i++; // Skip surrogate pair continuation
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Estimates byte size of an individual object or primitive.
 */
function estimateSingleObjectBytes(obj: unknown): number {
  if (obj === null || obj === undefined) return 0;
  if (typeof obj === 'string') return estimateStringBytes(obj);
  if (typeof obj === 'number') return 8;
  if (typeof obj === 'boolean') return 4;
  try {
    const json = JSON.stringify(obj);
    return estimateStringBytes(json);
  } catch {
    return 64; // Fallback heuristic for cyclic or unserializable structures
  }
}

/**
 * Fast, multi-tiered payload byte estimation.
 * - 'off': Returns 0 immediately with zero memory allocations.
 * - 'basic': Statistical O(1) sampling for arrays and fast string byte calculation (<0.05ms).
 * - 'high_fidelity': Full deep serialization and exact measurement.
 */
export function calculatePayloadBytes(
  data: unknown,
  options?: SizingOptions,
): number {
  const level = options?.level ?? DebugTelemetryEngine.getProfilingLevel();
  if (level === 'off' || data === undefined || data === null) {
    return 0;
  }

  if (typeof data === 'string') {
    return estimateStringBytes(data);
  }
  if (typeof data === 'number') return 8;
  if (typeof data === 'boolean') return 4;

  if (Array.isArray(data)) {
    if (data.length === 0) return 2; // "[]"
    if (level === 'basic') {
      const sampleCount = Math.min(data.length, options?.maxSamples ?? 5);
      let sampleBytes = 0;
      for (let i = 0; i < sampleCount; i++) {
        sampleBytes += estimateSingleObjectBytes(data[i]);
      }
      const avgBytesPerItem = sampleBytes / sampleCount;
      return Math.round(
        avgBytesPerItem * data.length + Math.max(0, data.length - 1) + 2,
      );
    }
  }

  if (level === 'basic') {
    return estimateSingleObjectBytes(data);
  }

  // High-fidelity fallback (exact measurement)
  try {
    const json = JSON.stringify(data);
    return estimateStringBytes(json);
  } catch {
    return 0;
  }
}

export class DebugTelemetryEngine {
  private static instance: DebugTelemetryEngine | null = null;
  private static globalProfilingLevel: TelemetryProfilingLevel =
    typeof window !== 'undefined' &&
    (localStorage.getItem(
      'bibliophile_profiling_level',
    ) as TelemetryProfilingLevel)
      ? (localStorage.getItem(
          'bibliophile_profiling_level',
        ) as TelemetryProfilingLevel)
      : 'basic';

  private profilingLevel: TelemetryProfilingLevel =
    DebugTelemetryEngine.globalProfilingLevel;
  private logs: TelemetryLog[] = [];
  private maxLogs = 200;
  private subscribers: Set<() => void> = new Set();
  private activeStates: Record<string, unknown> = {};
  private activeListeners: Map<string, ActiveListenerInfo> = new Map();
  private baseline: TelemetryBaseline | null = null;
  private bookDocByteSamples: number[] = [];
  private notifyScheduled = false;

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
    totalFirestoreWrites: 0,
    totalBytesWritten: 0,
    lastWritePayloadBytes: 0,
    averageWriteLatency: 0,
  };

  private latencies: number[] = [];
  private writeLatencies: number[] = [];
  private plugins: Map<string, TelemetryPlugin> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

  public static getInstance(): DebugTelemetryEngine {
    if (!this.instance) {
      this.instance = new DebugTelemetryEngine();
    }
    return this.instance;
  }

  public static resetInstance(): void {
    this.instance = null;
  }

  public static getProfilingLevel(): TelemetryProfilingLevel {
    return DebugTelemetryEngine.globalProfilingLevel;
  }

  public static setProfilingLevel(level: TelemetryProfilingLevel): void {
    DebugTelemetryEngine.globalProfilingLevel = level;
    if (DebugTelemetryEngine.instance) {
      DebugTelemetryEngine.instance.profilingLevel = level;
      DebugTelemetryEngine.instance.notifySubscribers();
    }
    if (typeof window !== 'undefined') {
      localStorage.setItem('bibliophile_profiling_level', level);
    }
  }

  public getProfilingLevel(): TelemetryProfilingLevel {
    return this.profilingLevel;
  }

  public setProfilingLevel(level: TelemetryProfilingLevel): void {
    DebugTelemetryEngine.setProfilingLevel(level);
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
      totalFirestoreWrites: 0,
      totalBytesWritten: 0,
      lastWritePayloadBytes: 0,
      averageWriteLatency: 0,
    };
    this.latencies = [];
    this.writeLatencies = [];
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
    } else if (type === 'db_write') {
      this.metrics.totalFirestoreWrites++;
      const p = payload as MutationTelemetryPayload | undefined;
      if (p?.bytes !== undefined && p.bytes > 0) {
        this.metrics.totalBytesWritten += p.bytes;
        this.metrics.lastWritePayloadBytes = p.bytes;
        this.metrics.totalBytesTransferred += p.bytes;
      }
      if (p?.commitDurationMs !== undefined && p.commitDurationMs >= 0) {
        this.writeLatencies.push(p.commitDurationMs);
        if (this.writeLatencies.length > 50) this.writeLatencies.shift();
        const sum = this.writeLatencies.reduce((a, b) => a + b, 0);
        this.metrics.averageWriteLatency = Math.round(
          sum / this.writeLatencies.length,
        );
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

    // Broadcast log entry to active telemetry plugins
    this.plugins.forEach(plugin => {
      try {
        plugin.onLog?.(entry, this);
      } catch (err) {
        console.error(`Error in telemetry plugin ${plugin.id} onLog:`, err);
      }
    });

    this.notifySubscribers();
  }

  // Record a dedicated Firestore write mutation with metrics
  public recordMutation(info: {
    mutationType?: MutationType;
    type?: MutationType;
    path: string;
    payload?: unknown;
    bytes?: number;
    commitDurationMs?: number;
    durationMs?: number;
    optimisticLatencyMs?: number;
    operationCount?: number;
    status?: 'success' | 'error';
    error?: string;
  }) {
    const mutationType = info.mutationType ?? info.type ?? 'update';
    const commitDurationMs = info.commitDurationMs ?? info.durationMs ?? 0;
    const bytes = info.bytes ?? calculatePayloadBytes(info.payload);
    const logPayload: MutationTelemetryPayload = {
      mutationType,
      path: info.path,
      bytes,
      commitDurationMs,
      optimisticLatencyMs: info.optimisticLatencyMs,
      operationCount: info.operationCount ?? 1,
      payload: info.payload,
      status: info.status ?? 'success',
      error: info.error,
    };

    const statusTag = info.status === 'error' ? ' [FAILED]' : '';
    const msg = `[FIRESTORE WRITE${statusTag}] ${mutationType} on ${info.path} (${commitDurationMs}ms, ${bytes} B)`;
    this.addLog(
      info.status === 'error' ? 'error' : 'db_write',
      msg,
      logPayload,
    );
  }

  // Telemetry Plugin Bus Registration API
  public registerPlugin(plugin: TelemetryPlugin): () => void {
    this.plugins.set(plugin.id, plugin);
    this.notifySubscribers();
    return () => {
      this.plugins.delete(plugin.id);
      this.notifySubscribers();
    };
  }

  public unregisterPlugin(pluginId: string): void {
    this.plugins.delete(pluginId);
    this.notifySubscribers();
  }

  public getPlugins(): TelemetryPlugin[] {
    return Array.from(this.plugins.values()).sort(
      (a, b) => (a.order ?? 100) - (b.order ?? 100),
    );
  }

  public getPlugin(id: string): TelemetryPlugin | undefined {
    return this.plugins.get(id);
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
    this.plugins.forEach(p => {
      try {
        p.onMetricUpdate?.(this.metrics);
      } catch {
        // Safe protection from plugin failures
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
    if (this.profilingLevel === 'off') {
      if (typeof val !== 'object') return val;
      return Array.isArray(val) ? `[Array(${val.length})]` : '[Object]';
    }
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

/**
 * Higher-order utility wrapping asynchronous Firestore write mutations
 * with commit timing, payload sizing, and telemetry tracking.
 */
export async function instrumentMutation<T>(
  mutationType: MutationType,
  path: string,
  payload: unknown,
  mutationFn: () => Promise<T>,
  options?: {
    operationCount?: number;
    optimisticLatencyMs?: number;
    level?: TelemetryProfilingLevel;
  },
): Promise<T> {
  const start = performance.now();
  const bytes = calculatePayloadBytes(payload, {level: options?.level});
  try {
    const result = await mutationFn();
    const commitDurationMs = Math.max(1, Math.round(performance.now() - start));
    DebugTelemetryEngine.getInstance().recordMutation({
      mutationType,
      path,
      payload,
      bytes,
      commitDurationMs,
      optimisticLatencyMs: options?.optimisticLatencyMs,
      operationCount: options?.operationCount,
      status: 'success',
    });
    return result;
  } catch (err) {
    const commitDurationMs = Math.max(1, Math.round(performance.now() - start));
    DebugTelemetryEngine.getInstance().recordMutation({
      mutationType,
      path,
      payload,
      bytes,
      commitDurationMs,
      optimisticLatencyMs: options?.optimisticLatencyMs,
      operationCount: options?.operationCount,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
