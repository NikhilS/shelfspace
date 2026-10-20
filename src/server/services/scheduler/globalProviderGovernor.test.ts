import {describe, it, expect, vi} from 'vitest';
import {GlobalProviderGovernor} from './globalProviderGovernor';
import {ProviderQuotaScheduler} from './providerQuotaScheduler';

describe('GlobalProviderGovernor concurrency & slot reservation suite', () => {
  it('reserves interactive slots by capping BATCH concurrency while allowing INTERACTIVE requests up to maxGlobalConcurrent', () => {
    const governor = new GlobalProviderGovernor(6, 2); // max 6 total, 2 reserved for INTERACTIVE => max 4 BATCH

    for (let i = 0; i < 4; i++) {
      expect(governor.canAcquireSlot('BATCH')).toBe(true);
      governor.acquireSlot('BATCH');
    }

    // 4 BATCH active: BATCH is now capped so 2 slots remain reserved for INTERACTIVE
    expect(governor.canAcquireSlot('BATCH')).toBe(false);
    expect(governor.canAcquireSlot('INTERACTIVE')).toBe(true);

    governor.acquireSlot('INTERACTIVE');
    governor.acquireSlot('INTERACTIVE');
    // Total active = 6 (saturated)
    expect(governor.canAcquireSlot('INTERACTIVE')).toBe(false);

    governor.releaseSlot('INTERACTIVE');
    expect(governor.canAcquireSlot('INTERACTIVE')).toBe(true);
  });

  it('wakes registered schedulers in round-robin order on slot release and summarizes telemetry', () => {
    const governor = new GlobalProviderGovernor(10, 2);

    const drainA = vi.fn();
    const drainB = vi.fn();

    const schedA = {
      providerId: 'prov-a',
      drain: drainA,
      inspectCapacity: () => ({
        providerId: 'prov-a',
        status: 'COOLDOWN' as const,
        availableTokens: 0,
        maxTokens: 10,
        activeCount: 1,
        maxConcurrent: 2,
        interactiveQueueDepth: 1,
        batchQueueDepth: 2,
        estimatedWaitMs: 500,
        cooldownRemainingMs: 1200,
      }),
    } as unknown as ProviderQuotaScheduler;

    const schedB = {
      providerId: 'prov-b',
      drain: drainB,
      inspectCapacity: () => ({
        providerId: 'prov-b',
        status: 'EXHAUSTED' as const,
        availableTokens: 0,
        maxTokens: 10,
        activeCount: 0,
        maxConcurrent: 2,
        interactiveQueueDepth: 0,
        batchQueueDepth: 1,
        estimatedWaitMs: 200,
        cooldownRemainingMs: 0,
      }),
    } as unknown as ProviderQuotaScheduler;

    governor.registerProvider(schedA);
    governor.registerProvider(schedB);
    expect(governor.getScheduler('prov-a')).toBe(schedA);

    const listener = vi.fn();
    const unsub = governor.subscribe(listener);

    governor.acquireSlot('BATCH');
    governor.recordSkippedProvider('prov-b');
    governor.releaseSlot('BATCH');

    expect(drainA).toHaveBeenCalledTimes(1);
    expect(drainB).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalled();

    const summary = governor.getTelemetrySummary('BATCH');
    expect(summary.cooldownProviders).toEqual([
      {
        providerId: 'prov-a',
        remainingMs: 1200,
        cooldownRemainingMs: 1200,
      },
    ]);
    expect(summary.exhaustedProviders).toContain('prov-b');
    expect(summary.skippedProviders).toContain('prov-b');
    expect(summary.totalActiveRequests).toBe(1);
    expect(summary.totalQueuedRequests).toBe(4);

    unsub();
  });
});
