export type SchedulePriority = 'INTERACTIVE' | 'BATCH';

export type ProviderCapacityStatus =
  'READY' | 'DELAYED' | 'EXHAUSTED' | 'COOLDOWN';

export interface QuotaConfig {
  providerId: string;
  maxConcurrent: number;
  minSpacingMs: number;
  maxRequestsPerMinute: number;
  burstCapacity?: number;
  defaultCooldownMs?: number;
  maxRetries?: number;
}

export interface CapacitySnapshot {
  providerId: string;
  status: ProviderCapacityStatus;
  availableTokens: number;
  activeCount: number;
  interactiveQueueDepth: number;
  batchQueueDepth: number;
  estimatedWaitMs: number;
  cooldownRemainingMs: number;
}

export interface ScheduleTaskOptions {
  id?: string;
  priority?: SchedulePriority;
  maxWaitMs?: number;
  signal?: AbortSignal;
}

interface QueuedJob<T> {
  fn: () => Promise<T>;
  options: Required<Pick<ScheduleTaskOptions, 'priority'>> &
    ScheduleTaskOptions;
  enqueuedAt: number;
  deadlineAt: number | null;
  retryCount: number;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  abortListener?: () => void;
}

export class ProviderSkippedError extends Error {
  readonly providerId: string;
  readonly reason: ProviderCapacityStatus;
  readonly estimatedWaitMs: number;

  constructor(
    providerId: string,
    reason: ProviderCapacityStatus,
    estimatedWaitMs: number,
  ) {
    super(
      `Provider '${providerId}' skipped (${reason}, estimatedWaitMs=${estimatedWaitMs}ms)`,
    );
    this.name = 'ProviderSkippedError';
    this.providerId = providerId;
    this.reason = reason;
    this.estimatedWaitMs = estimatedWaitMs;
  }
}

export interface IGlobalConcurrencyGovernor {
  registerScheduler(scheduler: ProviderQuotaScheduler): void;
  canAcquireSlot(priority: SchedulePriority): boolean;
  acquireSlot(priority: SchedulePriority): void;
  releaseSlot(priority: SchedulePriority): void;
  recordSkippedProvider(providerId: string): void;
}

export interface SchedulerTelemetryEvent {
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

let attachedGlobalGovernor: IGlobalConcurrencyGovernor | null = null;
let attachedTelemetryRecorder:
  ((event: SchedulerTelemetryEvent) => void) | null = null;

export function attachGlobalProviderGovernor(
  governor: IGlobalConcurrencyGovernor,
): void {
  attachedGlobalGovernor = governor;
}

export function attachSchedulerTelemetryRecorder(
  recorder: (event: SchedulerTelemetryEvent) => void,
): void {
  attachedTelemetryRecorder = recorder;
}

/**
 * Capacity-aware token-bucket scheduler with dual-lane priority queueing
 * (INTERACTIVE preempts BATCH), continuous sliding token replenishment,
 * deadline eviction, automatic HTTP 429 / Retry-After cooldown circuit breaking,
 * and coordinated two-tier (Local + Global) concurrency enforcement.
 */
export class ProviderQuotaScheduler {
  readonly providerId: string;
  private readonly maxConcurrent: number;
  private readonly minSpacingMs: number;
  private readonly maxRequestsPerMinute: number;
  private readonly burstCapacity: number;
  private readonly refillRatePerMs: number;
  private readonly defaultCooldownMs: number;
  private readonly maxRetries: number;

  private tokens: number;
  private lastRefillTimestamp: number;
  private activeCount = 0;
  private nextSpacingAvailableAt = 0;
  private cooldownUntil = 0;
  private consecutiveRateLimits = 0;

  private readonly interactiveQueue: Array<QueuedJob<unknown>> = [];
  private readonly batchQueue: Array<QueuedJob<unknown>> = [];
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly retryTimers = new Set<ReturnType<typeof setTimeout>>();

  constructor(config: QuotaConfig) {
    this.providerId = config.providerId;
    this.maxConcurrent = Math.max(1, config.maxConcurrent);
    this.minSpacingMs = Math.max(0, config.minSpacingMs);
    this.maxRequestsPerMinute = Math.max(1, config.maxRequestsPerMinute);
    this.burstCapacity = Math.max(
      1,
      config.burstCapacity ??
        Math.min(
          this.maxRequestsPerMinute,
          Math.max(this.maxConcurrent * 2, 4),
        ),
    );
    this.refillRatePerMs = this.maxRequestsPerMinute / 60_000;
    this.defaultCooldownMs = config.defaultCooldownMs ?? 15_000;
    this.maxRetries = config.maxRetries ?? 2;

    this.tokens = this.burstCapacity;
    this.lastRefillTimestamp = Date.now();

    if (attachedGlobalGovernor) {
      attachedGlobalGovernor.registerScheduler(this);
    }
  }

  private refillTokens(now = Date.now()): void {
    const elapsed = Math.max(0, now - this.lastRefillTimestamp);
    if (elapsed > 0) {
      this.tokens = Math.min(
        this.burstCapacity,
        this.tokens + elapsed * this.refillRatePerMs,
      );
      this.lastRefillTimestamp = now;
    }
    if (this.cooldownUntil > 0 && now >= this.cooldownUntil) {
      this.cooldownUntil = 0;
    }
  }

  /**
   * Computes a real-time capacity and wait-time snapshot for a given priority lane
   * BEFORE committing to schedule a task.
   */
  inspectCapacity(
    priority: SchedulePriority = 'INTERACTIVE',
  ): CapacitySnapshot {
    const now = Date.now();
    this.refillTokens(now);
    this.evictExpiredJobs(now);

    const cooldownRemainingMs = Math.max(0, this.cooldownUntil - now);
    const jobsAhead =
      priority === 'INTERACTIVE'
        ? this.interactiveQueue.length
        : this.interactiveQueue.length + this.batchQueue.length;

    const concurrencyOverflow = Math.max(
      0,
      this.activeCount + jobsAhead - this.maxConcurrent + 1,
    );
    const tokensNeeded = Math.max(0, jobsAhead + 1 - this.tokens);
    const tokenWaitMs =
      tokensNeeded > 0 ? Math.ceil(tokensNeeded / this.refillRatePerMs) : 0;

    const spacingWaitMs = Math.max(0, this.nextSpacingAvailableAt - now);
    const queueSpacingMs =
      (jobsAhead + (concurrencyOverflow > 0 ? concurrencyOverflow : 0)) *
      Math.max(this.minSpacingMs, 150);

    const estimatedWaitMs = Math.max(
      cooldownRemainingMs,
      tokenWaitMs,
      spacingWaitMs + queueSpacingMs,
    );

    let status: ProviderCapacityStatus = 'READY';
    if (cooldownRemainingMs > 0) {
      status = 'COOLDOWN';
    } else if (this.tokens < 1 && tokenWaitMs > 2500) {
      status = 'EXHAUSTED';
    } else if (estimatedWaitMs > 0) {
      status = 'DELAYED';
    }

    return {
      providerId: this.providerId,
      status,
      availableTokens: Number(this.tokens.toFixed(2)),
      activeCount: this.activeCount,
      interactiveQueueDepth: this.interactiveQueue.length,
      batchQueueDepth: this.batchQueue.length,
      estimatedWaitMs,
      cooldownRemainingMs,
    };
  }

  /**
   * Explicitly places this provider into a cooldown state (e.g. after HTTP 429).
   */
  recordCooldown(durationMs?: number): void {
    const now = Date.now();
    this.consecutiveRateLimits++;
    const computedCooldown =
      durationMs ??
      this.defaultCooldownMs *
        Math.pow(2, Math.min(3, this.consecutiveRateLimits - 1));
    this.cooldownUntil = Math.max(this.cooldownUntil, now + computedCooldown);
    this.tokens = 0;
    this.lastRefillTimestamp = now;
  }

  private attachQueueAbortListener(job: QueuedJob<unknown>): void {
    const signal = job.options.signal;
    if (!signal) {
      return;
    }
    this.cleanupJobListeners(job);
    const onAbort = () => {
      this.removeJobFromQueues(job);
      this.cleanupJobListeners(job);
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      job.reject(abortErr);
    };
    job.abortListener = onAbort;
    signal.addEventListener('abort', onAbort, {once: true});
  }

  /**
   * Schedules a task with priority queueing, optional maxWaitMs deadline, and AbortSignal support.
   */
  schedule<T>(fn: () => Promise<T>): Promise<T>;
  schedule<T>(options: ScheduleTaskOptions, fn: () => Promise<T>): Promise<T>;
  schedule<T>(
    optionsOrFn: ScheduleTaskOptions | (() => Promise<T>),
    maybeFn?: () => Promise<T>,
  ): Promise<T> {
    const rawOptions: ScheduleTaskOptions =
      typeof optionsOrFn === 'function' ? {} : optionsOrFn;
    const fn = typeof optionsOrFn === 'function' ? optionsOrFn : maybeFn!;
    const priority: SchedulePriority = rawOptions.priority ?? 'INTERACTIVE';

    if (attachedGlobalGovernor) {
      attachedGlobalGovernor.registerScheduler(this);
    }

    const now = Date.now();
    const snapshot = this.inspectCapacity(priority);

    // If caller specified a strict maxWaitMs budget and our estimated wait exceeds it,
    // fail fast with ProviderSkippedError so the orchestrator can skip immediately.
    if (
      typeof rawOptions.maxWaitMs === 'number' &&
      rawOptions.maxWaitMs >= 0 &&
      (snapshot.status === 'COOLDOWN' ||
        snapshot.estimatedWaitMs > rawOptions.maxWaitMs)
    ) {
      attachedGlobalGovernor?.recordSkippedProvider(this.providerId);
      return Promise.reject(
        new ProviderSkippedError(
          this.providerId,
          snapshot.status === 'READY' ? 'DELAYED' : snapshot.status,
          snapshot.estimatedWaitMs,
        ),
      );
    }

    if (rawOptions.signal?.aborted) {
      const abortErr = new Error('The operation was aborted.');
      abortErr.name = 'AbortError';
      return Promise.reject(abortErr);
    }

    return new Promise<T>((resolve, reject) => {
      const job: QueuedJob<unknown> = {
        fn: fn as () => Promise<unknown>,
        options: {
          ...rawOptions,
          priority,
        },
        enqueuedAt: now,
        deadlineAt:
          typeof rawOptions.maxWaitMs === 'number'
            ? now + rawOptions.maxWaitMs
            : null,
        retryCount: 0,
        resolve: resolve as (value: unknown) => void,
        reject,
      };

      this.attachQueueAbortListener(job);

      if (priority === 'INTERACTIVE') {
        this.interactiveQueue.push(job);
      } else {
        this.batchQueue.push(job);
      }

      this.drain();
    });
  }

  private removeJobFromQueues(target: QueuedJob<unknown>): void {
    const idxInteractive = this.interactiveQueue.indexOf(target);
    if (idxInteractive !== -1) {
      this.interactiveQueue.splice(idxInteractive, 1);
    }
    const idxBatch = this.batchQueue.indexOf(target);
    if (idxBatch !== -1) {
      this.batchQueue.splice(idxBatch, 1);
    }
  }

  private cleanupJobListeners(job: QueuedJob<unknown>): void {
    if (job.abortListener && job.options.signal) {
      job.options.signal.removeEventListener('abort', job.abortListener);
      job.abortListener = undefined;
    }
  }

  private evictExpiredJobs(now = Date.now()): void {
    const evictFrom = (queue: Array<QueuedJob<unknown>>) => {
      for (let i = queue.length - 1; i >= 0; i--) {
        const job = queue[i];
        if (job.options.signal?.aborted) {
          queue.splice(i, 1);
          this.cleanupJobListeners(job);
          const abortErr = new Error('The operation was aborted.');
          abortErr.name = 'AbortError';
          job.reject(abortErr);
        } else if (job.deadlineAt !== null && now > job.deadlineAt) {
          queue.splice(i, 1);
          this.cleanupJobListeners(job);
          attachedGlobalGovernor?.recordSkippedProvider(this.providerId);
          job.reject(
            new ProviderSkippedError(
              this.providerId,
              this.cooldownUntil > now ? 'COOLDOWN' : 'EXHAUSTED',
              now - job.enqueuedAt,
            ),
          );
        }
      }
    };

    evictFrom(this.interactiveQueue);
    evictFrom(this.batchQueue);
  }

  drain(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }

    const now = Date.now();
    this.refillTokens(now);
    this.evictExpiredJobs(now);

    while (this.interactiveQueue.length > 0 || this.batchQueue.length > 0) {
      if (this.activeCount >= this.maxConcurrent) {
        return;
      }

      const currentNow = Date.now();
      this.refillTokens(currentNow);

      // Check cooldown gate
      if (this.cooldownUntil > currentNow) {
        this.scheduleDrainTimer(this.cooldownUntil - currentNow);
        return;
      }

      // Check token availability
      if (this.tokens < 1) {
        const msToOneToken = Math.max(
          10,
          Math.ceil((1 - this.tokens) / this.refillRatePerMs),
        );
        this.scheduleDrainTimer(msToOneToken);
        return;
      }

      // Check minimum spacing between dispatches
      if (this.nextSpacingAvailableAt > currentNow) {
        this.scheduleDrainTimer(this.nextSpacingAvailableAt - currentNow);
        return;
      }

      // Determine candidate priority lane
      const hasInteractive = this.interactiveQueue.length > 0;
      const candidatePriority: SchedulePriority = hasInteractive
        ? 'INTERACTIVE'
        : 'BATCH';

      // Check global outbound concurrency gate if governor is attached
      if (
        attachedGlobalGovernor &&
        !attachedGlobalGovernor.canAcquireSlot(candidatePriority)
      ) {
        this.scheduleDrainTimer(50);
        return;
      }

      const nextJob = hasInteractive
        ? this.interactiveQueue.shift()
        : this.batchQueue.shift();
      if (!nextJob) {
        return;
      }

      this.cleanupJobListeners(nextJob);
      this.tokens = Math.max(0, this.tokens - 1);
      this.activeCount++;
      attachedGlobalGovernor?.acquireSlot(nextJob.options.priority);
      this.nextSpacingAvailableAt = Date.now() + this.minSpacingMs;

      void this.executeJob(nextJob);
    }
  }

  private scheduleDrainTimer(waitMs: number): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
    }
    this.drainTimer = setTimeout(
      () => {
        this.drainTimer = null;
        this.drain();
      },
      Math.max(5, waitMs),
    );

    if (
      this.drainTimer &&
      typeof (this.drainTimer as {unref?: () => void}).unref === 'function'
    ) {
      (this.drainTimer as {unref: () => void}).unref();
    }
  }

  private extractRateLimitCooldownMs(error: unknown): number | null {
    if (!error) {
      return null;
    }
    const status =
      (error as {status?: number; statusCode?: number})?.status ??
      (error as {statusCode?: number})?.statusCode;
    const retryAfterMs = (error as {retryAfterMs?: number})?.retryAfterMs;
    const msg = error instanceof Error ? error.message : String(error);

    if (
      status === 429 ||
      /\b429\b|rate limit|too many requests|RESOURCE_EXHAUSTED/i.test(msg)
    ) {
      if (typeof retryAfterMs === 'number' && retryAfterMs > 0) {
        return retryAfterMs;
      }
      return this.defaultCooldownMs;
    }
    return null;
  }

  private isTransientRetryableError(error: unknown): boolean {
    if (!error) {
      return false;
    }
    const name = (error as Error)?.name;
    if (name === 'AbortError' || name === 'ProviderSkippedError') {
      return false;
    }
    const msg = error instanceof Error ? error.message : String(error);
    return /\b(429|502|503|504)\b|rate limit|RESOURCE_EXHAUSTED|ECONNRESET|ETIMEDOUT|fetch failed/i.test(
      msg,
    );
  }

  private extractTokenUsage(result: unknown): number | undefined {
    if (!result || typeof result !== 'object') {
      return undefined;
    }
    const usage = (
      result as {
        usageMetadata?: {
          totalTokenCount?: number;
          promptTokenCount?: number;
          candidatesTokenCount?: number;
        };
      }
    ).usageMetadata;
    if (!usage) {
      return undefined;
    }
    if (
      typeof usage.totalTokenCount === 'number' &&
      usage.totalTokenCount > 0
    ) {
      return usage.totalTokenCount;
    }
    const prompt = usage.promptTokenCount ?? 0;
    const candidates = usage.candidatesTokenCount ?? 0;
    return prompt + candidates > 0 ? prompt + candidates : undefined;
  }

  private async executeJob(job: QueuedJob<unknown>): Promise<void> {
    const execStart = Date.now();
    const queueWaitMs = Math.max(0, execStart - job.enqueuedAt);
    try {
      const result = await job.fn();
      const durationMs = Math.max(1, Date.now() - execStart);
      this.activeCount = Math.max(0, this.activeCount - 1);
      attachedGlobalGovernor?.releaseSlot(job.options.priority);
      this.consecutiveRateLimits = 0;

      if (attachedTelemetryRecorder) {
        try {
          attachedTelemetryRecorder({
            providerId: this.providerId,
            operation: job.options.id || this.providerId,
            priority: job.options.priority,
            durationMs,
            queueWaitMs,
            status: 'ok',
            retryCount: job.retryCount,
            tokens: this.extractTokenUsage(result),
          });
        } catch {
          // Never allow telemetry hooks to affect execution
        }
      }

      job.resolve(result);
      this.drain();
    } catch (error) {
      const durationMs = Math.max(1, Date.now() - execStart);
      this.activeCount = Math.max(0, this.activeCount - 1);
      attachedGlobalGovernor?.releaseSlot(job.options.priority);

      const cooldownMs = this.extractRateLimitCooldownMs(error);
      if (cooldownMs !== null) {
        this.recordCooldown(cooldownMs);
      }

      if (attachedTelemetryRecorder) {
        try {
          const errMsg =
            error instanceof Error ? error.message : String(error ?? 'Error');
          attachedTelemetryRecorder({
            providerId: this.providerId,
            operation: job.options.id || this.providerId,
            priority: job.options.priority,
            durationMs,
            queueWaitMs,
            status: cooldownMs !== null ? 'rate_limited' : 'error',
            retryCount: job.retryCount,
            error: errMsg,
          });
        } catch {
          // Never allow telemetry hooks to affect execution
        }
      }

      const now = Date.now();
      const canRetry =
        job.retryCount < this.maxRetries &&
        this.isTransientRetryableError(error) &&
        !job.options.signal?.aborted &&
        (job.deadlineAt === null || now + 1000 < job.deadlineAt);

      if (canRetry) {
        job.retryCount++;
        const retryBackoffMs = 500 * Math.pow(2, job.retryCount - 1);
        const signal = job.options.signal;

        const retryTimer = setTimeout(() => {
          this.retryTimers.delete(retryTimer);
          this.cleanupJobListeners(job);
          if (signal?.aborted) {
            const abortErr = new Error('The operation was aborted.');
            abortErr.name = 'AbortError';
            job.reject(abortErr);
            return;
          }
          this.attachQueueAbortListener(job);
          if (job.options.priority === 'INTERACTIVE') {
            this.interactiveQueue.unshift(job);
          } else {
            this.batchQueue.unshift(job);
          }
          this.drain();
        }, retryBackoffMs);

        if (
          retryTimer &&
          typeof (retryTimer as {unref?: () => void}).unref === 'function'
        ) {
          (retryTimer as {unref: () => void}).unref();
        }
        this.retryTimers.add(retryTimer);

        if (signal) {
          const onRetryAbort = () => {
            clearTimeout(retryTimer);
            this.retryTimers.delete(retryTimer);
            this.cleanupJobListeners(job);
            const abortErr = new Error('The operation was aborted.');
            abortErr.name = 'AbortError';
            job.reject(abortErr);
          };
          job.abortListener = onRetryAbort;
          signal.addEventListener('abort', onRetryAbort, {once: true});
        }
      } else {
        job.reject(error);
      }

      this.drain();
    }
  }

  stop(): void {
    if (this.drainTimer !== null) {
      clearTimeout(this.drainTimer);
      this.drainTimer = null;
    }
    for (const timer of this.retryTimers) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
  }
}
