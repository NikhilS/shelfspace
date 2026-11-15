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

  it('isolates FAST_DECISION and GENERATIVE_AI pools so saturated EXTERNAL_CATALOG requests never starve Decisions', () => {
    const governor = new GlobalProviderGovernor(4, 1, {
      FAST_DECISION: {maxConcurrent: 3, reservedInteractiveSlots: 1},
      GENERATIVE_AI: {maxConcurrent: 2, reservedInteractiveSlots: 1},
    });

    const drainCatalog = vi.fn();
    const drainDecision = vi.fn();
    governor.registerProvider({
      providerId: 'apple-books',
      executionPool: 'EXTERNAL_CATALOG',
      drain: drainCatalog,
      inspectCapacity: () => ({
        providerId: 'apple-books',
        status: 'DELAYED' as const,
        availableTokens: 0,
        activeCount: 4,
        interactiveQueueDepth: 0,
        batchQueueDepth: 5,
        estimatedWaitMs: 3000,
        cooldownRemainingMs: 0,
      }),
    } as unknown as ProviderQuotaScheduler);

    governor.registerProvider({
      providerId: 'gemini-decision',
      executionPool: 'FAST_DECISION',
      drain: drainDecision,
      inspectCapacity: () => ({
        providerId: 'gemini-decision',
        status: 'READY' as const,
        availableTokens: 10,
        activeCount: 0,
        interactiveQueueDepth: 0,
        batchQueueDepth: 0,
        estimatedWaitMs: 0,
        cooldownRemainingMs: 0,
      }),
    } as unknown as ProviderQuotaScheduler);

    // Completely saturate EXTERNAL_CATALOG (3 BATCH + 1 INTERACTIVE = 4/4)
    governor.acquireSlot('BATCH', 'EXTERNAL_CATALOG');
    governor.acquireSlot('BATCH', 'EXTERNAL_CATALOG');
    governor.acquireSlot('BATCH', 'EXTERNAL_CATALOG');
    governor.acquireSlot('INTERACTIVE', 'EXTERNAL_CATALOG');

    expect(governor.canAcquireSlot('BATCH', 'EXTERNAL_CATALOG')).toBe(false);
    expect(governor.canAcquireSlot('INTERACTIVE', 'EXTERNAL_CATALOG')).toBe(
      false,
    );

    // FAST_DECISION and GENERATIVE_AI remain wide open!
    expect(governor.canAcquireSlot('BATCH', 'FAST_DECISION')).toBe(true);
    expect(governor.canAcquireSlot('INTERACTIVE', 'FAST_DECISION')).toBe(true);
    expect(governor.canAcquireSlot('BATCH', 'GENERATIVE_AI')).toBe(true);

    governor.acquireSlot('BATCH', 'FAST_DECISION');
    governor.acquireSlot('BATCH', 'FAST_DECISION');
    // 2/3 used in FAST_DECISION -> 1 slot reserved for INTERACTIVE
    expect(governor.canAcquireSlot('BATCH', 'FAST_DECISION')).toBe(false);
    expect(governor.canAcquireSlot('INTERACTIVE', 'FAST_DECISION')).toBe(true);

    // Releasing a FAST_DECISION slot wakes ONLY the FAST_DECISION scheduler
    governor.releaseSlot('BATCH', 'FAST_DECISION');
    expect(drainDecision).toHaveBeenCalledTimes(1);
    expect(drainCatalog).not.toHaveBeenCalled();

    const snap = governor.getSnapshot('BATCH', 'FAST_DECISION');
    expect(snap.activeBatch).toBe(1);
    expect(snap.maxGlobalConcurrent).toBe(3);
  });
});
