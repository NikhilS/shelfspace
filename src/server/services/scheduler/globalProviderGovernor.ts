import {
  ProviderQuotaScheduler,
  CapacitySnapshot,
  SchedulePriority,
  IGlobalConcurrencyGovernor,
  attachGlobalProviderGovernor,
} from './providerQuotaScheduler';

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
}

/**
 * Global Two-Tier Outbound Quota & Concurrency Governor.
 * Coordinates across all 11 local ProviderQuotaSchedulers (8 Catalog providers,
 * Wikipedia, Gemini Structured, and Gemini Embedding) to enforce a global outbound
 * concurrency ceiling while reserving fast-lane capacity for INTERACTIVE user actions.
 */
export class GlobalProviderGovernor implements IGlobalConcurrencyGovernor {
  private static instance: GlobalProviderGovernor;

  private readonly schedulers = new Map<string, ProviderQuotaScheduler>();
  private readonly maxGlobalConcurrent: number;
  private readonly reservedInteractiveSlots: number;
  private activeInteractiveCount = 0;
  private activeBatchCount = 0;
  private wakeCursor = 0;
  private readonly recentSkips = new Map<string, number>();
  private readonly listeners = new Set<() => void>();

  constructor(maxGlobalConcurrent = 24, reservedInteractiveSlots = 4) {
    this.maxGlobalConcurrent = maxGlobalConcurrent;
    this.reservedInteractiveSlots = reservedInteractiveSlots;
  }

  public static getInstance(): GlobalProviderGovernor {
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

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public registerScheduler(scheduler: ProviderQuotaScheduler): void {
    if (scheduler && !this.schedulers.has(scheduler.providerId)) {
      this.schedulers.set(scheduler.providerId, scheduler);
    }
  }

  public registerProvider(scheduler: ProviderQuotaScheduler): void {
    this.registerScheduler(scheduler);
  }

  public getScheduler(providerId: string): ProviderQuotaScheduler | undefined {
    return this.schedulers.get(providerId);
  }

  public canAcquireSlot(priority: SchedulePriority): boolean {
    const totalActive = this.activeInteractiveCount + this.activeBatchCount;
    if (priority === 'INTERACTIVE') {
      return totalActive < this.maxGlobalConcurrent;
    }
    const maxBatchAllowed = Math.max(
      2,
      this.maxGlobalConcurrent - this.reservedInteractiveSlots,
    );
    return (
      totalActive < this.maxGlobalConcurrent &&
      this.activeBatchCount < maxBatchAllowed
    );
  }

  public acquireSlot(priority: SchedulePriority): void {
    if (priority === 'INTERACTIVE') {
      this.activeInteractiveCount++;
    } else {
      this.activeBatchCount++;
    }
    this.notifyListeners();
  }

  public releaseSlot(priority: SchedulePriority): void {
    if (priority === 'INTERACTIVE') {
      this.activeInteractiveCount = Math.max(
        0,
        this.activeInteractiveCount - 1,
      );
    } else {
      this.activeBatchCount = Math.max(0, this.activeBatchCount - 1);
    }
    // Wake waiting schedulers in round-robin order so early registered providers
    // cannot starve downstream providers when global concurrency is saturated.
    const schedulerList = Array.from(this.schedulers.values());
    const count = schedulerList.length;
    if (count > 0) {
      const startIdx = this.wakeCursor % count;
      this.wakeCursor = (startIdx + 1) % count;
      for (let i = 0; i < count; i++) {
        schedulerList[(startIdx + i) % count].drain();
      }
    }
    this.notifyListeners();
  }

  public recordSkippedProvider(providerId: string): void {
    this.recentSkips.set(providerId, Date.now());
    this.notifyListeners();
  }

  public inspectAllProviders(
    priority: SchedulePriority = 'BATCH',
  ): CapacitySnapshot[] {
    const snapshots: CapacitySnapshot[] = [];
    for (const scheduler of this.schedulers.values()) {
      snapshots.push(scheduler.inspectCapacity(priority));
    }
    return snapshots;
  }

  public getTelemetrySummary(
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
    };
  }

  public getSnapshot(priority: SchedulePriority = 'INTERACTIVE'): {
    providers: CapacitySnapshot[];
    activeTotal: number;
    activeInteractive: number;
    activeBatch: number;
    maxGlobalConcurrent: number;
    reservedInteractiveSlots: number;
  } {
    const providers = this.inspectAllProviders(priority);
    return {
      providers,
      activeTotal: this.activeInteractiveCount + this.activeBatchCount,
      activeInteractive: this.activeInteractiveCount,
      activeBatch: this.activeBatchCount,
      maxGlobalConcurrent: this.maxGlobalConcurrent,
      reservedInteractiveSlots: this.reservedInteractiveSlots,
    };
  }
}

export const globalProviderGovernor = GlobalProviderGovernor.getInstance();
