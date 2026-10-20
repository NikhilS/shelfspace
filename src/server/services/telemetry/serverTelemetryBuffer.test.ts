import {describe, it, expect, beforeEach} from 'vitest';
import {serverTelemetryBuffer} from './serverTelemetryBuffer';

describe('serverTelemetryBuffer ring buffer & counters suite', () => {
  beforeEach(() => {
    serverTelemetryBuffer.clear();
  });

  it('records calls, accumulates error/rate-limit/token totals, and filters by sinceMs', () => {
    serverTelemetryBuffer.recordCall({
      providerId: 'gemini-structured',
      operation: 'classifyBooks',
      priority: 'INTERACTIVE',
      durationMs: 142.4,
      queueWaitMs: 12.1,
      status: 'ok',
      tokens: 350,
    });

    serverTelemetryBuffer.recordCall({
      providerId: 'open-library',
      priority: 'BATCH',
      durationMs: 500,
      queueWaitMs: 50,
      status: 'rate_limited',
      retryCount: 2,
    });

    serverTelemetryBuffer.recordCall({
      providerId: 'google-books',
      priority: 'BATCH',
      durationMs: 80,
      queueWaitMs: 0,
      status: 'error',
      error: 'Upstream 503',
    });

    const snap = serverTelemetryBuffer.getSnapshot();
    expect(snap.entries).toHaveLength(3);
    expect(snap.totals).toEqual({
      totalCalls: 3,
      totalErrors: 1,
      totalRateLimits: 1,
      totalGeminiTokens: 350,
    });

    // Future sinceMs filters out older entries while preserving cumulative totals
    const futureSnap = serverTelemetryBuffer.getSnapshot(Date.now() + 10_000);
    expect(futureSnap.entries).toHaveLength(0);
    expect(futureSnap.totals.totalCalls).toBe(3);
  });

  it('caps ring buffer at 150 entries and resets cleanly on clear()', () => {
    for (let i = 0; i < 165; i++) {
      serverTelemetryBuffer.recordCall({
        providerId: `provider-${i}`,
        priority: 'BATCH',
        durationMs: 10,
        queueWaitMs: 0,
        status: 'ok',
      });
    }

    const snap = serverTelemetryBuffer.getSnapshot();
    expect(snap.entries).toHaveLength(150);
    expect(snap.entries[0].providerId).toBe('provider-164');
    expect(snap.totals.totalCalls).toBe(165);

    serverTelemetryBuffer.clear();
    const cleared = serverTelemetryBuffer.getSnapshot();
    expect(cleared.entries).toHaveLength(0);
    expect(cleared.totals.totalCalls).toBe(0);
  });
});
