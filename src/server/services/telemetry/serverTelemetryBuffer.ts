import {
  attachSchedulerTelemetryRecorder,
  type CapacitySnapshot,
  type SchedulePriority,
} from '../scheduler/providerQuotaScheduler';
import {globalProviderGovernor} from '../scheduler/globalProviderGovernor';

export interface ServerServiceCallEntry {
  id: string;
  timestamp: string;
  timestampMs: number;
  providerId: string;
  operation: string;
  priority: SchedulePriority;
  durationMs: number;
  queueWaitMs: number;
  status: 'ok' | 'rate_limited' | 'error';
  retryCount?: number;
  tokens?: number;
  error?: string;
}

export interface ServerTelemetrySnapshot {
  serverTimeMs: number;
  entries: ServerServiceCallEntry[];
  providers: CapacitySnapshot[];
  governor: ReturnType<typeof globalProviderGovernor.getSnapshot>;
  totals: {
    totalCalls: number;
    totalErrors: number;
    totalRateLimits: number;
    totalGeminiTokens: number;
  };
}

class ServerTelemetryBuffer {
  private readonly maxEntries = 150;
  private readonly entries: ServerServiceCallEntry[] = [];
  private seq = 0;

  private totalCalls = 0;
  private totalErrors = 0;
  private totalRateLimits = 0;
  private totalGeminiTokens = 0;

  constructor() {
    attachSchedulerTelemetryRecorder(event => {
      this.recordCall(event);
    });
  }

  recordCall(input: {
    providerId: string;
    operation?: string;
    priority: SchedulePriority;
    durationMs: number;
    queueWaitMs: number;
    status: 'ok' | 'rate_limited' | 'error';
    retryCount?: number;
    tokens?: number;
    error?: string;
  }): void {
    const now = new Date();
    const timestampMs = now.getTime();
    const timestamp = now.toLocaleTimeString([], {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    this.totalCalls++;
    if (input.status === 'error') {
      this.totalErrors++;
    } else if (input.status === 'rate_limited') {
      this.totalRateLimits++;
    }
    if (typeof input.tokens === 'number' && input.tokens > 0) {
      this.totalGeminiTokens += input.tokens;
    }

    const entry: ServerServiceCallEntry = {
      id: `srv-${timestampMs}-${++this.seq}`,
      timestamp,
      timestampMs,
      providerId: input.providerId,
      operation: input.operation || input.providerId,
      priority: input.priority,
      durationMs: Math.max(0, Math.round(input.durationMs)),
      queueWaitMs: Math.max(0, Math.round(input.queueWaitMs)),
      status: input.status,
      ...(input.retryCount ? {retryCount: input.retryCount} : {}),
      ...(typeof input.tokens === 'number' && input.tokens > 0
        ? {tokens: input.tokens}
        : {}),
      ...(input.error ? {error: input.error.slice(0, 240)} : {}),
    };

    this.entries.unshift(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.pop();
    }
  }

  getSnapshot(sinceMs?: number): ServerTelemetrySnapshot {
    const filtered =
      typeof sinceMs === 'number' && sinceMs > 0
        ? this.entries.filter(e => e.timestampMs > sinceMs)
        : [...this.entries];

    const governorSnap = globalProviderGovernor.getSnapshot();

    return {
      serverTimeMs: Date.now(),
      entries: filtered,
      providers: governorSnap.providers,
      governor: governorSnap,
      totals: {
        totalCalls: this.totalCalls,
        totalErrors: this.totalErrors,
        totalRateLimits: this.totalRateLimits,
        totalGeminiTokens: this.totalGeminiTokens,
      },
    };
  }

  clear(): void {
    this.entries.length = 0;
    this.totalCalls = 0;
    this.totalErrors = 0;
    this.totalRateLimits = 0;
    this.totalGeminiTokens = 0;
  }
}

export const serverTelemetryBuffer = new ServerTelemetryBuffer();
