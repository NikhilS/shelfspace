import {
  ProviderQuotaScheduler,
  CapacitySnapshot,
  ExecutionPool,
  SchedulePriority,
  GlobalConcurrencyGovernor,
  attachGlobalProviderGovernor,
} from './providerQuotaScheduler';

export interface PoolSlotBudgetConfig {
  maxConcurrent: number;
  reservedInteractiveSlots: number;
}

export interface PoolTelemetrySnapshot {
  activeInteractive: number;
  activeBatch: number;
  maxConcurrent: number;
  reservedInteractiveSlots: number;
}

export interface ProviderTelemetrySummary {
  activeProviders: string[];
  delayedProviders: string[];
  cooldownProviders: Array<{
    providerId: string;
    remainingMs: number;
    cooldownRemainingMs: number;
  }>;
  skippedProviders: string[];
  exhaustedProviders: string[];
  totalActiveRequests: number;
  totalInFlight: number;
  totalQueuedRequests: number;
  maxGlobalConcurrent: number;
  poolTelemetry?: Record<ExecutionPool, PoolTelemetrySnapshot>;
}

interface MutablePoolState {
  maxConcurrent: number;
  reservedInteractiveSlots: number;
  activeInteractive: number;
  activeBatch: number;
  wakeCursor: number;
}

/**
 * Global Two-Tier Outbound Quota & Concurrency Governor with Isolated Execution Pools.
 * Partitions outbound concurrency across `FAST_DECISION` (`gemini-decision-1`),
 * `EXTERNAL_CATALOG` (Apple Books, Google Books, Open Library, PRH, Hardcover, Wikipedia),
 * and `GENERATIVE_AI` (`gemini-structured`, `gemini-embedding`) so slow catalog HTTP scrapes
 * never starve sub-300ms calibrated Decision evaluations.
 */
export class GlobalProviderGovernor implements GlobalConcurrencyGovernor {
  private static instance: GlobalProviderGovernor;

  private readonly schedulers = new Map<string, ProviderQuotaScheduler>();
  private readonly maxGlobalConcurrent: number;
  private readonly reservedInteractiveSlots: number;
  private readonly pools: Record<ExecutionPool, MutablePoolState>;
  private readonly recentSkips = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(
    maxGlobalConcurrent = 24,
    reservedInteractiveSlots = 4,
    poolOverrides?: Partial<Record<ExecutionPool, PoolSlotBudgetConfig>>,
  ) {
    this.maxGlobalConcurrent = maxGlobalConcurrent;
    this.reservedInteractiveSlots = reservedInteractiveSlots;

    const catalogBudget = poolOverrides?.EXTERNAL_CATALOG ?? {
      maxConcurrent: maxGlobalConcurrent,
      reservedInteractiveSlots,
    };
    const decisionBudget = poolOverrides?.FAST_DECISION ?? {
      maxConcurrent: 8,
      reservedInteractiveSlots: 2,
    };
    const generativeBudget = poolOverrides?.GENERATIVE_AI ?? {
      maxConcurrent: 8,
      reservedInteractiveSlots: 2,
    };

    this.pools = {
      EXTERNAL_CATALOG: {
        maxConcurrent: catalogBudget.maxConcurrent,
        reservedInteractiveSlots: catalogBudget.reservedInteractiveSlots,
        activeInteractive: 0,
        activeBatch: 0,
        wakeCursor: 0,
      },
      FAST_DECISION: {
        maxConcurrent: decisionBudget.maxConcurrent,
        reservedInteractiveSlots: decisionBudget.reservedInteractiveSlots,
        activeInteractive: 0,
        activeBatch: 0,
        wakeCursor: 0,
      },
      GENERATIVE_AI: {
        maxConcurrent: generativeBudget.maxConcurrent,
        reservedInteractiveSlots: generativeBudget.reservedInteractiveSlots,
        activeInteractive: 0,
        activeBatch: 0,
        wakeCursor: 0,
      },
    };
  }

  static getInstance(): GlobalProviderGovernor {
    if (!GlobalProviderGovernor.instance) {
      GlobalProviderGovernor.instance = new GlobalProviderGovernor();
      attachGlobalProviderGovernor(GlobalProviderGovernor.instance);
    }
    return GlobalProviderGovernor.instance;
  }

  private notifyListeners(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // Ignore listener errors
      }
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  registerScheduler(scheduler: ProviderQuotaScheduler): void {
    if (scheduler && !this.schedulers.has(scheduler.providerId)) {
      this.schedulers.set(scheduler.providerId, scheduler);
    }
  }

  registerProvider(scheduler: ProviderQuotaScheduler): void {
    this.registerScheduler(scheduler);
  }

  getScheduler(providerId: string): ProviderQuotaScheduler | undefined {
    return this.schedulers.get(providerId);
  }

  canAcquireSlot(
    priority: SchedulePriority,
    pool: ExecutionPool = 'EXTERNAL_CATALOG',
  ): boolean {
    const state = this.pools[pool];
    const totalActive = state.activeInteractive + state.activeBatch;
    if (priority === 'INTERACTIVE') {
      return totalActive < state.maxConcurrent;
    }
    const maxBatchAllowed = Math.max(
      1,
      state.maxConcurrent - state.reservedInteractiveSlots,
    );
    return (
      totalActive < state.maxConcurrent && state.activeBatch < maxBatchAllowed
    );
  }

  acquireSlot(
    priority: SchedulePriority,
    pool: ExecutionPool = 'EXTERNAL_CATALOG',
  ): void {
    const state = this.pools[pool];
    if (priority === 'INTERACTIVE') {
      state.activeInteractive++;
    } else {
      state.activeBatch++;
    }
    this.notifyListeners();
  }

  releaseSlot(
    priority: SchedulePriority,
    pool: ExecutionPool = 'EXTERNAL_CATALOG',
  ): void {
    const state = this.pools[pool];
    if (priority === 'INTERACTIVE') {
      state.activeInteractive = Math.max(0, state.activeInteractive - 1);
    } else {
      state.activeBatch = Math.max(0, state.activeBatch - 1);
    }

    // Wake waiting schedulers in this execution pool in round-robin order so early
    // registered providers cannot starve peers when pool concurrency is saturated.
    const poolSchedulers = Array.from(this.schedulers.values()).filter(
      scheduler => (scheduler.executionPool ?? 'EXTERNAL_CATALOG') === pool,
    );
    const count = poolSchedulers.length;
    if (count > 0) {
      const startIdx = state.wakeCursor % count;
      state.wakeCursor = (startIdx + 1) % count;
      for (let i = 0; i < count; i++) {
        poolSchedulers[(startIdx + i) % count].drain();
      }
    }
    this.notifyListeners();
  }

  recordSkippedProvider(providerId: string): void {
    this.recentSkips.set(providerId, Date.now());
    this.notifyListeners();
  }

  inspectAllProviders(
    priority: SchedulePriority = 'BATCH',
  ): CapacitySnapshot[] {
    const snapshots: CapacitySnapshot[] = [];
    for (const scheduler of this.schedulers.values()) {
      snapshots.push(scheduler.inspectCapacity(priority));
    }
    return snapshots;
  }

  getPoolTelemetry(): Record<ExecutionPool, PoolTelemetrySnapshot> {
    return {
      FAST_DECISION: {
        activeInteractive: this.pools.FAST_DECISION.activeInteractive,
        activeBatch: this.pools.FAST_DECISION.activeBatch,
        maxConcurrent: this.pools.FAST_DECISION.maxConcurrent,
        reservedInteractiveSlots:
          this.pools.FAST_DECISION.reservedInteractiveSlots,
      },
      EXTERNAL_CATALOG: {
        activeInteractive: this.pools.EXTERNAL_CATALOG.activeInteractive,
        activeBatch: this.pools.EXTERNAL_CATALOG.activeBatch,
        maxConcurrent: this.pools.EXTERNAL_CATALOG.maxConcurrent,
        reservedInteractiveSlots:
          this.pools.EXTERNAL_CATALOG.reservedInteractiveSlots,
      },
      GENERATIVE_AI: {
        activeInteractive: this.pools.GENERATIVE_AI.activeInteractive,
        activeBatch: this.pools.GENERATIVE_AI.activeBatch,
        maxConcurrent: this.pools.GENERATIVE_AI.maxConcurrent,
        reservedInteractiveSlots:
          this.pools.GENERATIVE_AI.reservedInteractiveSlots,
      },
    };
  }

  getTelemetrySummary(
    priority: SchedulePriority = 'BATCH',
  ): ProviderTelemetrySummary {
    const now = Date.now();
    const snapshots = this.inspectAllProviders(priority);

    const activeProviders: string[] = [];
    const delayedProviders: string[] = [];
    const exhaustedProviders: string[] = [];
    const cooldownProviders: Array<{
      providerId: string;
      remainingMs: number;
      cooldownRemainingMs: number;
    }> = [];
    const skippedProviders: string[] = [];
    let totalActiveRequests = 0;
    let totalQueuedRequests = 0;

    for (const snap of snapshots) {
      totalActiveRequests += snap.activeCount;
      totalQueuedRequests += snap.interactiveQueueDepth + snap.batchQueueDepth;

      if (snap.activeCount > 0 || snap.status === 'READY') {
        activeProviders.push(snap.providerId);
      }
      if (snap.status === 'COOLDOWN') {
        cooldownProviders.push({
          providerId: snap.providerId,
          remainingMs: snap.cooldownRemainingMs,
          cooldownRemainingMs: snap.cooldownRemainingMs,
        });
      } else if (snap.status === 'EXHAUSTED') {
        exhaustedProviders.push(snap.providerId);
        delayedProviders.push(snap.providerId);
      } else if (snap.status === 'DELAYED') {
        delayedProviders.push(snap.providerId);
      }

      const lastSkipAt = this.recentSkips.get(snap.providerId);
      if (lastSkipAt && now - lastSkipAt < 30_000) {
        skippedProviders.push(snap.providerId);
      }
    }

    return {
      activeProviders,
      delayedProviders,
      cooldownProviders,
      skippedProviders,
      exhaustedProviders,
      totalActiveRequests,
      totalInFlight: totalActiveRequests,
      totalQueuedRequests,
      maxGlobalConcurrent: this.maxGlobalConcurrent,
      poolTelemetry: this.getPoolTelemetry(),
    };
  }

  getSnapshot(
    priority: SchedulePriority = 'INTERACTIVE',
    pool?: ExecutionPool,
  ): {
    providers: CapacitySnapshot[];
    activeTotal: number;
    activeInteractive: number;
    activeBatch: number;
    maxGlobalConcurrent: number;
    reservedInteractiveSlots: number;
  } {
    const providers = this.inspectAllProviders(priority);
    if (pool) {
      const state = this.pools[pool];
      return {
        providers,
        activeTotal: state.activeInteractive + state.activeBatch,
        activeInteractive: state.activeInteractive,
        activeBatch: state.activeBatch,
        maxGlobalConcurrent: state.maxConcurrent,
        reservedInteractiveSlots: state.reservedInteractiveSlots,
      };
    }

    const activeInteractive =
      this.pools.EXTERNAL_CATALOG.activeInteractive +
      this.pools.FAST_DECISION.activeInteractive +
      this.pools.GENERATIVE_AI.activeInteractive;
    const activeBatch =
      this.pools.EXTERNAL_CATALOG.activeBatch +
      this.pools.FAST_DECISION.activeBatch +
      this.pools.GENERATIVE_AI.activeBatch;

    return {
      providers,
      activeTotal: activeInteractive + activeBatch,
      activeInteractive,
      activeBatch,
      maxGlobalConcurrent: this.maxGlobalConcurrent,
      reservedInteractiveSlots: this.reservedInteractiveSlots,
    };
  }
}

export const globalProviderGovernor = GlobalProviderGovernor.getInstance();
