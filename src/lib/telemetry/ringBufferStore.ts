import {
  calculatePayloadBytes,
  registerProfilingLevelGetter,
} from './byteSizeEstimator';
import type {
  ActiveListenerInfo,
  LogLevel,
  LogMetadata,
  MutationTelemetryPayload,
  MutationType,
  TelemetryBaseline,
  TelemetryLog,
  TelemetryMetrics,
  TelemetryProfilingLevel,
} from './types';

function inferLogScope(type: LogLevel, message: string): string {
  const bracketMatch = message.match(/^\[([A-Za-z0-9_:-]+)\]/);
  if (bracketMatch) {
    const raw = bracketMatch[1].toLowerCase();
    if (raw.includes('auth')) {
      return 'Auth';
    }
    if (raw.includes('trpc') || raw.includes('http')) {
      return 'tRPC';
    }
    if (raw.includes('query') || raw.includes('cache')) {
      return 'Cache';
    }
    if (raw.includes('enrich')) {
      return 'Enrichment';
    }
    if (raw.includes('router') || raw.includes('nav')) {
      return 'Router';
    }
    if (raw.includes('boot') || raw.includes('sw')) {
      return 'PWA';
    }
    if (raw.includes('constellation') || raw.includes('umap')) {
      return 'Constellation';
    }
    if (raw.includes('errorboundary')) {
      return 'ErrorBoundary';
    }
  }
  switch (type) {
    case 'api_res':
      return 'tRPC';
    case 'db_read':
    case 'db_write':
      return 'Database';
    case 'gen_ai':
      return 'Gemini';
    case 'worker':
      return 'Worker';
    case 'error':
      return 'Error';
    default:
      return 'App';
  }
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export class DebugTelemetryEngine {
  private static instance: DebugTelemetryEngine | null = null;
  private static explicitDebugEnabled: boolean | null = null;
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
  private readonly maxLogs = 200;
  private readonly maxDormantErrorLogs = 20;
  private subscribers: Set<() => void> = new Set();
  private activeStates: Record<string, unknown> = {};
  private activeListeners: Map<string, ActiveListenerInfo> = new Map();
  private baseline: TelemetryBaseline | null = null;
  private bookDocByteSamples: number[] = [];
  private seq = 0;

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
    totalErrors: 0,
    totalWarnings: 0,
    queryCacheHits: 0,
    totalQueryReads: 0,
    idbPersistStatus: 'idle',
    idbHydratedAt: null,
    idbPersistedBytes: 0,
  };

  private latencies: number[] = [];
  private writeLatencies: number[] = [];

  private constructor() {}

  static getInstance(): DebugTelemetryEngine {
    if (!this.instance) {
      this.instance = new DebugTelemetryEngine();
    }
    return this.instance;
  }

  static resetInstance(): void {
    this.instance = null;
    this.explicitDebugEnabled = null;
  }

  static setDebugModeEnabled(enabled: boolean): void {
    this.explicitDebugEnabled = enabled;
    if (this.instance) {
      this.instance.notifySubscribers();
    }
  }

  static isDebugModeEnabled(): boolean {
    if (this.explicitDebugEnabled !== null) {
      return this.explicitDebugEnabled;
    }
    if (this.instance && this.instance.subscribers.size > 0) {
      return true;
    }
    if (typeof window !== 'undefined') {
      try {
        return localStorage.getItem('debugMode') === 'true';
      } catch {
        return false;
      }
    }
    return false;
  }

  static isHudActive(): boolean {
    return this.isDebugModeEnabled();
  }

  private isCollectionActive(): boolean {
    if (this.subscribers.size > 0) {
      return true;
    }
    if (DebugTelemetryEngine.explicitDebugEnabled !== null) {
      return DebugTelemetryEngine.explicitDebugEnabled;
    }
    return true;
  }

  static getProfilingLevel(): TelemetryProfilingLevel {
    return DebugTelemetryEngine.globalProfilingLevel;
  }

  static setProfilingLevel(level: TelemetryProfilingLevel): void {
    DebugTelemetryEngine.globalProfilingLevel = level;
    if (DebugTelemetryEngine.instance) {
      DebugTelemetryEngine.instance.profilingLevel = level;
      DebugTelemetryEngine.instance.notifySubscribers();
    }
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem('bibliophile_profiling_level', level);
      } catch {
        // Ignore storage errors
      }
    }
  }

  getProfilingLevel(): TelemetryProfilingLevel {
    return this.profilingLevel;
  }

  setProfilingLevel(level: TelemetryProfilingLevel): void {
    DebugTelemetryEngine.setProfilingLevel(level);
  }

  registerListener(name: string, path: string): () => void {
    const id = `lsn-${++this.seq}`;
    const info: ActiveListenerInfo = {
      id,
      name,
      path,
      startedAt: formatTime(new Date()),
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

  getActiveListeners(): ActiveListenerInfo[] {
    return Array.from(this.activeListeners.values());
  }

  captureBaseline(): TelemetryBaseline {
    this.baseline = {
      timestamp: formatTime(new Date()),
      metrics: {...this.metrics},
    };
    this.notifySubscribers();
    return this.baseline;
  }

  getBaseline(): TelemetryBaseline | null {
    return this.baseline
      ? {
          timestamp: this.baseline.timestamp,
          metrics: {...this.baseline.metrics},
        }
      : null;
  }

  clearBaseline(): void {
    this.baseline = null;
    this.notifySubscribers();
  }

  resetMetrics(): void {
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
      totalErrors: 0,
      totalWarnings: 0,
      queryCacheHits: 0,
      totalQueryReads: 0,
      idbPersistStatus: this.metrics.idbPersistStatus,
      idbHydratedAt: this.metrics.idbHydratedAt,
      idbPersistedBytes: this.metrics.idbPersistedBytes,
    };
    this.latencies = [];
    this.writeLatencies = [];
    this.bookDocByteSamples = [];
    this.baseline = null;
    this.notifySubscribers();
  }

  recordCacheAccess(hit: boolean, queryKeyStr?: string): void {
    if (!this.isCollectionActive()) {
      return;
    }
    this.metrics.totalQueryReads++;
    this.metrics.totalFirestoreReads++;
    if (hit) {
      this.metrics.queryCacheHits++;
      this.metrics.firestoreCacheHits++;
    }
    if (this.metrics.totalFirestoreReads > 0) {
      this.metrics.cacheEfficiencyRatio = Math.round(
        (this.metrics.firestoreCacheHits / this.metrics.totalFirestoreReads) *
          100,
      );
    }
    if (queryKeyStr && this.profilingLevel === 'high_fidelity') {
      this.addLog(
        'db_read',
        `[Cache] ${hit ? 'HIT' : 'MISS'} ${queryKeyStr}`,
        {fromCache: hit, path: queryKeyStr},
        {scope: 'Cache', status: hit ? 'cache_hit' : 'ok'},
      );
    } else {
      this.notifySubscribers();
    }
  }

  recordIdbPersistenceState(
    status: 'idle' | 'restoring' | 'hydrated' | 'error',
    bytes?: number,
  ): void {
    this.metrics.idbPersistStatus = status;
    if (status === 'hydrated') {
      this.metrics.idbHydratedAt = formatTime(new Date());
    }
    if (typeof bytes === 'number' && bytes >= 0) {
      this.metrics.idbPersistedBytes = bytes;
    }
    this.notifySubscribers();
  }

  addLog(
    type: LogLevel,
    message: string,
    payload?: unknown,
    meta?: LogMetadata,
  ): void {
    const active = this.isCollectionActive();

    if (!active && type !== 'error') {
      return;
    }

    const timestampObj = new Date();
    const timestamp = formatTime(timestampObj);
    const scope = meta?.scope || inferLogScope(type, message);

    if (type === 'error') {
      this.metrics.totalErrors++;
    } else if (type === 'warn') {
      this.metrics.totalWarnings++;
    }

    if (!active && type === 'error') {
      const dormantEntry: TelemetryLog = {
        id: `err-${timestampObj.getTime()}-${++this.seq}`,
        timestamp,
        timestampObj,
        type: 'error',
        message,
        scope,
        stack:
          meta?.stack || (payload instanceof Error ? payload.stack : undefined),
        payload:
          payload instanceof Error
            ? {name: payload.name, message: payload.message}
            : typeof payload === 'string' ||
                typeof payload === 'number' ||
                typeof payload === 'boolean'
              ? payload
              : undefined,
      };
      this.logs.unshift(dormantEntry);
      if (this.logs.length > this.maxDormantErrorLogs) {
        this.logs.pop();
      }
      return;
    }

    const entry: TelemetryLog = {
      id: `log-${timestampObj.getTime()}-${++this.seq}`,
      timestamp,
      timestampObj,
      type,
      message,
      payload: this.safeClone(payload),
      scope,
      durationMs: meta?.durationMs,
      status: meta?.status,
      stack:
        meta?.stack || (payload instanceof Error ? payload.stack : undefined),
      source: meta?.source || 'client',
    };

    this.logs.unshift(entry);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }

    if (type === 'db_read') {
      this.metrics.totalFirestoreReads++;
      this.metrics.totalQueryReads++;
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
        this.metrics.queryCacheHits++;
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
        if (this.writeLatencies.length > 50) {
          this.writeLatencies.shift();
        }
        const sum = this.writeLatencies.reduce((a, b) => a + b, 0);
        this.metrics.averageWriteLatency = Math.round(
          sum / this.writeLatencies.length,
        );
      }
    } else if (type === 'api_res') {
      this.metrics.totalApiRequests++;
      const p = payload as
        {durationMs?: number; bytes?: number; fromCache?: boolean} | undefined;
      const duration = meta?.durationMs ?? p?.durationMs;
      if (typeof duration === 'number' && duration >= 0) {
        this.latencies.push(duration);
        if (this.latencies.length > 50) {
          this.latencies.shift();
        }
        const sum = this.latencies.reduce((a, b) => a + b, 0);
        this.metrics.averageApiLatency = Math.round(
          sum / this.latencies.length,
        );
      }
      if (p?.bytes) {
        this.metrics.totalBytesTransferred += p.bytes;
        this.metrics.lastQueryPayloadBytes = p.bytes;
      }
    } else if (type === 'gen_ai') {
      this.metrics.totalGeminiQueries++;
      const p = payload as {tokens?: number; durationMs?: number} | undefined;
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

  recordMutation(info: {
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
  }): void {
    if (!this.isCollectionActive() && info.status !== 'error') {
      return;
    }
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
      {
        scope: 'Database',
        durationMs: commitDurationMs,
        status: info.status === 'error' ? 'error' : 'ok',
      },
    );
  }

  getLogs(): TelemetryLog[] {
    return [...this.logs];
  }

  clearLogs(): void {
    this.logs = [];
    this.notifySubscribers();
  }

  subscribe(sub: () => void): () => void {
    this.subscribers.add(sub);
    return () => {
      this.subscribers.delete(sub);
    };
  }

  private notifySubscribers(): void {
    this.subscribers.forEach(sub => {
      try {
        sub();
      } catch {
        // Safe protection from unmounted subscribers
      }
    });
  }

  updateState(moduleName: string, stateObject: unknown): void {
    if (!this.isCollectionActive()) {
      return;
    }
    this.activeStates[moduleName] = this.safeClone(stateObject);
    this.notifySubscribers();
  }

  removeState(moduleName: string): void {
    if (!(moduleName in this.activeStates)) {
      return;
    }
    delete this.activeStates[moduleName];
    this.notifySubscribers();
  }

  getActiveStates(): Record<string, unknown> {
    return {...this.activeStates};
  }

  getMetrics(): TelemetryMetrics {
    return {...this.metrics};
  }

  private safeClone(val: unknown): unknown {
    if (val === undefined || val === null) {
      return val;
    }
    if (typeof val !== 'object') {
      return val;
    }
    if (this.profilingLevel === 'off') {
      return Array.isArray(val) ? `[Array(${val.length})]` : '[Object]';
    }
    if (val instanceof Error) {
      return {
        name: val.name,
        message: val.message,
        stack: val.stack,
      };
    }
    try {
      return JSON.parse(JSON.stringify(val));
    } catch {
      return '[Non-serializable payload]';
    }
  }
}

registerProfilingLevelGetter(() => DebugTelemetryEngine.getProfilingLevel());
