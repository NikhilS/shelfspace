import type React from 'react';
import type {DebugTelemetryEngine} from './ringBufferStore';

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
  timestamp: string;
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
  totalBytesTransferred: number;
  lastQueryPayloadBytes: number;
  averageBookDocumentBytes: number;
  activeFirestoreListeners: number;
  cacheEfficiencyRatio: number;
  snapshotParseDurationMs: number;
  totalFirestoreWrites: number;
  totalBytesWritten: number;
  lastWritePayloadBytes: number;
  averageWriteLatency: number;
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
  span: <Result>(
    operation: string,
    fn: () => Promise<Result>,
    payload?: unknown,
  ) => Promise<Result>;
}
