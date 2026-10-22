import React from 'react';

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
  | 'setDoc'
  | 'updateDoc'
  | 'deleteDoc'
  | 'writeBatch'
  | 'addDoc'
  | 'create'
  | 'update'
  | 'delete';

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

export interface LogMetadata {
  scope?: string;
  durationMs?: number;
  status?: number | 'ok' | 'error' | 'cache_hit' | 'rate_limited';
  stack?: string;
  source?: 'client' | 'server';
}

export interface TelemetryLog {
  id: string;
  timestamp: string; // "13:14:02" format
  timestampObj: Date;
  type: LogLevel;
  message: string;
  payload?: unknown;
  scope?: string;
  durationMs?: number;
  status?: number | 'ok' | 'error' | 'cache_hit' | 'rate_limited';
  stack?: string;
  source?: 'client' | 'server';
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

  // First-Principles Modern Observability Metrics
  totalErrors: number;
  totalWarnings: number;
  queryCacheHits: number;
  totalQueryReads: number;
  idbPersistStatus: 'idle' | 'restoring' | 'hydrated' | 'error';
  idbHydratedAt: string | null;
  idbPersistedBytes: number;
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
  icon?: React.ComponentType<{className?: string; size?: number}>;
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
  if (obj === null || obj === undefined) {
    return 0;
  }
  if (typeof obj === 'string') {
    return estimateStringBytes(obj);
  }
  if (typeof obj === 'number') {
    return 8;
  }
  if (typeof obj === 'boolean') {
    return 4;
  }
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
  if (typeof data === 'number') {
    return 8;
  }
  if (typeof data === 'boolean') {
    return 4;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return 2;
    } // "[]"
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
  private plugins: Map<string, TelemetryPlugin> = new Map();

  private constructor() {
    // Private constructor for singleton
  }

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

  /**
   * Synchronizes whether the Debug Console is enabled.
   * When explicitly disabled (false) and no HUD subscribers are attached,
   * non-error telemetry becomes a strict O(1) no-op.
   */
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

  /**
   * Internal check used by addLog: returns true unless debug mode was explicitly
   * disabled and no HUD subscriber is listening.
   */
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

  // Register and track active listeners / streams
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

  // Baseline capture for Before/After comparison
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

  clearBaseline() {
    this.baseline = null;
    this.notifySubscribers();
  }

  resetMetrics() {
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

  recordCacheAccess(hit: boolean, queryKeyStr?: string) {
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
  ) {
    this.metrics.idbPersistStatus = status;
    if (status === 'hydrated') {
      this.metrics.idbHydratedAt = formatTime(new Date());
    }
    if (typeof bytes === 'number' && bytes >= 0) {
      this.metrics.idbPersistedBytes = bytes;
    }
    this.notifySubscribers();
  }

  // Add Log Entry
  addLog(
    type: LogLevel,
    message: string,
    payload?: unknown,
    meta?: LogMetadata,
  ) {
    const active = this.isCollectionActive();

    // Fast-path: When console is disabled, ignore all non-error logs with zero allocation.
    // Uncaught errors are still kept in a tiny 20-entry buffer without deep cloning.
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

    // Process type-specific metric aggregations on the telemetry stream
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

  // Record a dedicated write mutation with metrics
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
  }) {
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

  // Telemetry Plugin Bus Registration API
  registerPlugin(plugin: TelemetryPlugin): () => void {
    this.plugins.set(plugin.id, plugin);
    this.notifySubscribers();
    return () => {
      this.plugins.delete(plugin.id);
      this.notifySubscribers();
    };
  }

  unregisterPlugin(pluginId: string): void {
    this.plugins.delete(pluginId);
    this.notifySubscribers();
  }

  getPlugins(): TelemetryPlugin[] {
    return Array.from(this.plugins.values()).sort(
      (a, b) => (a.order ?? 100) - (b.order ?? 100),
    );
  }

  getPlugin(id: string): TelemetryPlugin | undefined {
    return this.plugins.get(id);
  }

  // Get current logs
  getLogs(): TelemetryLog[] {
    return [...this.logs];
  }

  // Clear logs helper
  clearLogs() {
    this.logs = [];
    this.notifySubscribers();
  }

  // Subscriber pattern
  subscribe(sub: () => void): () => void {
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
  updateState(moduleName: string, stateObject: unknown) {
    if (!this.isCollectionActive()) {
      return;
    }
    this.activeStates[moduleName] = this.safeClone(stateObject);
    this.notifySubscribers();
  }

  removeState(moduleName: string) {
    if (!(moduleName in this.activeStates)) {
      return;
    }
    delete this.activeStates[moduleName];
    this.notifySubscribers();
  }

  getActiveStates(): Record<string, unknown> {
    return {...this.activeStates};
  }

  // Dynamic diagnostics getters
  getMetrics(): TelemetryMetrics {
    return {...this.metrics};
  }

  // Safe payload copy utility preventing circular JSON reference crashes
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

/**
 * Ergonomic scoped logger interface for instrumenting application modules.
 * Strictly zero-cost when the Debug Console is disabled (except for error buffering).
 */
export interface ScopedDebugLogger {
  info: (
    message: string,
    payload?: unknown,
    meta?: Omit<LogMetadata, 'scope'>,
  ) => void;
  warn: (
    message: string,
    payload?: unknown,
    meta?: Omit<LogMetadata, 'scope'>,
  ) => void;
  error: (
    message: string,
    errorOrPayload?: unknown,
    meta?: Omit<LogMetadata, 'scope'>,
  ) => void;
  trace: (
    message: string,
    payload?: unknown,
    meta?: Omit<LogMetadata, 'scope'>,
  ) => void;
  span: <T>(
    operation: string,
    fn: () => Promise<T>,
    payload?: unknown,
  ) => Promise<T>;
}

export function createLogger(scope: string): ScopedDebugLogger {
  return {
    info(message, payload, meta) {
      if (!DebugTelemetryEngine.isHudActive()) {
        return;
      }
      DebugTelemetryEngine.getInstance().addLog(
        'info',
        `[${scope}] ${message}`,
        payload,
        {...meta, scope},
      );
    },
    warn(message, payload, meta) {
      if (!DebugTelemetryEngine.isHudActive()) {
        return;
      }
      DebugTelemetryEngine.getInstance().addLog(
        'warn',
        `[${scope}] ${message}`,
        payload,
        {...meta, scope},
      );
    },
    error(message, errorOrPayload, meta) {
      const stack =
        meta?.stack ||
        (errorOrPayload instanceof Error ? errorOrPayload.stack : undefined);
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        `[${scope}] ${message}`,
        errorOrPayload,
        {...meta, scope, stack, status: 'error'},
      );
    },
    trace(message, payload, meta) {
      if (!DebugTelemetryEngine.isHudActive()) {
        return;
      }
      DebugTelemetryEngine.getInstance().addLog(
        'log',
        `[${scope}] ${message}`,
        payload,
        {...meta, scope},
      );
    },
    async span<T>(
      operation: string,
      fn: () => Promise<T>,
      payload?: unknown,
    ): Promise<T> {
      if (!DebugTelemetryEngine.isHudActive()) {
        return fn();
      }
      const start = performance.now();
      try {
        const res = await fn();
        const durationMs = Math.max(1, Math.round(performance.now() - start));
        DebugTelemetryEngine.getInstance().addLog(
          'info',
          `[${scope}] ${operation} completed (${durationMs}ms)`,
          payload,
          {scope, durationMs, status: 'ok'},
        );
        return res;
      } catch (err) {
        const durationMs = Math.max(1, Math.round(performance.now() - start));
        DebugTelemetryEngine.getInstance().addLog(
          'error',
          `[${scope}] ${operation} failed (${durationMs}ms): ${
            err instanceof Error ? err.message : String(err)
          }`,
          err,
          {
            scope,
            durationMs,
            status: 'error',
            stack: err instanceof Error ? err.stack : undefined,
          },
        );
        throw err;
      }
    },
  };
}

export const debug = createLogger('App');

// Global Console interceptor activation helper
let isIntercepted = false;

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map(arg => {
      if (arg instanceof Error) {
        return `${arg.name}: ${arg.message}`;
      }
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
}

export function interceptConsoleLogs() {
  if (isIntercepted) {
    return;
  }
  if (typeof window === 'undefined') {
    return;
  }

  const originalLog = window.console.log;
  const originalWarn = window.console.warn;
  const originalError = window.console.error;
  const originalInfo = window.console.info;

  window.console.log = function (...args: unknown[]) {
    if (DebugTelemetryEngine.isHudActive()) {
      const msg = formatConsoleArgs(args);
      if (!msg.startsWith('[DEBUG]') && !msg.includes('[TELEMETRY_INTERNAL]')) {
        DebugTelemetryEngine.getInstance().addLog(
          'log',
          msg,
          args.length > 1 ? args.slice(1) : undefined,
        );
      }
    }
    originalLog(...args);
  };

  window.console.warn = function (...args: unknown[]) {
    if (DebugTelemetryEngine.isHudActive()) {
      const msg = formatConsoleArgs(args);
      if (!msg.includes('[TELEMETRY_INTERNAL]')) {
        DebugTelemetryEngine.getInstance().addLog(
          'warn',
          msg,
          args.length > 1 ? args.slice(1) : undefined,
        );
      }
    }
    originalWarn(...args);
  };

  window.console.error = function (...args: unknown[]) {
    // Always inspect errors lightly so uncaught errors are captured into the 20-entry crash buffer
    const firstStr = typeof args[0] === 'string' ? args[0] : '';
    if (
      firstStr.includes('Disconnecting idle stream') ||
      firstStr.includes('Timed out waiting for new targets') ||
      firstStr.includes('GrpcConnection RPC')
    ) {
      return;
    }

    const msg = DebugTelemetryEngine.isHudActive()
      ? formatConsoleArgs(args)
      : args
          .map(a =>
            a instanceof Error
              ? `${a.name}: ${a.message}`
              : typeof a === 'string'
                ? a
                : '[Object]',
          )
          .join(' ');

    if (!msg.includes('[TELEMETRY_INTERNAL]')) {
      const errObj = args.find(a => a instanceof Error) as Error | undefined;
      DebugTelemetryEngine.getInstance().addLog(
        'error',
        msg,
        errObj || (args.length > 1 ? args[1] : undefined),
        {stack: errObj?.stack, status: 'error'},
      );
    }
    originalError(...args);
  };

  window.console.info = function (...args: unknown[]) {
    if (DebugTelemetryEngine.isHudActive()) {
      const msg = formatConsoleArgs(args);
      if (!msg.includes('[TELEMETRY_INTERNAL]')) {
        DebugTelemetryEngine.getInstance().addLog(
          'info',
          msg,
          args.length > 1 ? args.slice(1) : undefined,
        );
      }
    }
    originalInfo(...args);
  };

  isIntercepted = true;
}

/**
 * Higher-order utility wrapping asynchronous write mutations
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
