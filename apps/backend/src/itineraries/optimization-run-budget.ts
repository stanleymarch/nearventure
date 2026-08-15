/**
 * Shared bounded GraphHopper budget for one complete optimization run (D5).
 *
 * Isochrone, clustering/walkability, pair-cost evaluation, local search and
 * final validation all consume slots from the same budget. This guarantees
 * no stage can create a private unbounded GraphHopper call path.
 *
 * The budget is created once at the start of optimize() and shared by every
 * stage. A cache hit bypasses the request budget (free); every miss must
 * acquire a slot before starting GraphHopper work. Final validation reserves
 * enough calls to build at least one complete route.
 */
export interface OptimizationRunBudgetOptions {
  /** Maximum total GraphHopper calls (misses) for the entire run. Default 40. */
  maxRequests?: number;
  /** Run deadline in milliseconds. Default 12000. */
  deadlineMs?: number;
  /** Calls reserved for final route validation. Default 3. */
  reservedFinalValidation?: number;
  /** Calls reserved for the deterministic initial candidate route so the
   *  locality guard / search probing can never starve it. Default 2. */
  reservedInitialCandidate?: number;
  /** Maximum concurrent in-flight requests. Default 3. */
  maxConcurrency?: number;
}

/** A concurrency+request lease. Caller must release() exactly once when done. */
export interface RunLease {
  release(): void;
}

export class OptimizationRunBudget {
  readonly maxRequests: number;
  readonly deadlineMs: number;
  readonly reservedFinalValidation: number;
  readonly reservedInitialCandidate: number;
  readonly maxConcurrency: number;
  private readonly startTime: number;
  private usedRequests = 0;
  private reservedSlots = 0;
  private reservedInitialSlots = 0;
  private deadlineExceeded = false;
  /** In-flight leased requests; bounded by maxConcurrency via a real waiter queue. */
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(options: OptimizationRunBudgetOptions = {}, startTime: number = Date.now()) {
    this.maxRequests = options.maxRequests ?? 40;
    this.deadlineMs = options.deadlineMs ?? 12_000;
    this.reservedFinalValidation = options.reservedFinalValidation ?? 3;
    this.reservedInitialCandidate = options.reservedInitialCandidate ?? 2;
    this.maxConcurrency = options.maxConcurrency ?? 3;
    this.startTime = startTime;
  }

  /** Milliseconds remaining before the deadline, or 0 if expired. */
  remainingMs(now: number = Date.now()): number {
    const remaining = this.deadlineMs - (now - this.startTime);
    if (remaining <= 0) { this.deadlineExceeded = true; return 0; }
    return remaining;
  }

  /** General (non-reserved) slots available to probing stages. */
  private generalSlots(): number {
    return this.maxRequests - this.reservedSlots - this.reservedInitialSlots;
  }

  /** True when the deadline has passed or all non-reserved request slots are used. */
  isExhausted(now: number = Date.now()): boolean {
    if (this.remainingMs(now) <= 0) return true;
    return this.usedRequests >= this.generalSlots();
  }

  /** Acquire a request slot. Returns false if the budget is exhausted or
   *  the remaining slots are all reserved for final validation/initial candidate. */
  acquire(now: number = Date.now()): boolean {
    if (this.isExhausted(now)) return false;
    if (this.usedRequests >= this.generalSlots()) return false;
    this.usedRequests++;
    return true;
  }

  /** Reserve slots for final validation so search/clustering can't starve it.
   *  Reserved slots are subtracted from the general pool. */
  reserveFinalValidation(count?: number): void {
    const target = count ?? this.reservedFinalValidation;
    this.reservedSlots = Math.min(target, Math.max(0, this.maxRequests - this.usedRequests - 1));
  }

  /** Reserve slots for the deterministic initial candidate route so locality
   *  guard / search probing can never consume the whole run before a single
   *  feasible candidate is confirmed. Reserved slots are subtracted from the
   *  general pool and are only usable through acquireReservedInitialLease. */
  reserveInitialCandidate(count?: number): void {
    const target = count ?? this.reservedInitialCandidate;
    this.reservedInitialSlots = Math.min(target, Math.max(0, this.maxRequests - this.usedRequests - this.reservedSlots - 1));
  }

  /** Return unused initial-candidate reservations to the general pool after the
   *  initial candidate is confirmed (or abandoned). */
  releaseInitialCandidateReservation(): void {
    this.reservedInitialSlots = 0;
  }

  /** How many initial-candidate reserved slots remain. */
  get initialCandidateReserved(): number {
    return this.reservedInitialSlots;
  }

  /** Whether any reserved final-validation slot is still available. */
  hasReservedFinalValidation(): boolean {
    return this.reservedSlots > 0;
  }

  /** Acquire a reserved final-validation slot. These bypass the general cap. */
  acquireReserved(now: number = Date.now()): boolean {
    if (this.remainingMs(now) <= 0) { this.deadlineExceeded = true; return false; }
    if (this.reservedSlots <= 0) return false;
    this.reservedSlots--;
    this.usedRequests++;
    return true;
  }

  /** Whether the deadline was the reason the run ended early. */
  wasDeadlineExceeded(): boolean { return this.deadlineExceeded; }
  /** How many request slots were consumed so far. */
  get usedRequestCount(): number { return this.usedRequests; }
  /** How many requests are currently in flight (for diagnostics). */
  get activeCount(): number { return this.active; }

  /**
   * Acquire a request slot AND a bounded concurrency lease.
   *
   * May wait asynchronously for a concurrency slot (up to the deadline). Every
   * real GraphHopper miss must go through this; cache hits bypass it entirely.
   * Returns null when the budget is exhausted, the deadline expires while
   * waiting, or all general slots are reserved. The returned lease must be
   * released exactly once (use try/finally).
   */
  async acquireLease(now: number = Date.now()): Promise<RunLease | null> {
    if (this.isExhausted(now)) return null;
    if (this.active >= this.maxConcurrency) {
      const ok = await this.waitForConcurrencySlot(now);
      if (!ok) return null;
      if (this.isExhausted()) return null;
    }
    if (this.usedRequests >= this.generalSlots()) return null;
    this.usedRequests++;
    this.active++;
    return this.makeLease();
  }

  /** Acquire a reserved initial-candidate slot with a concurrency lease.
   *  These bypass the general cap; unused reservations can be returned to the
   *  general pool via releaseInitialCandidateReservation(). */
  async acquireReservedInitialLease(now: number = Date.now()): Promise<RunLease | null> {
    if (this.remainingMs(now) <= 0) { this.deadlineExceeded = true; return null; }
    if (this.reservedInitialSlots <= 0) return null;
    if (this.active >= this.maxConcurrency) {
      const ok = await this.waitForConcurrencySlot(now);
      if (!ok) return null;
    }
    if (this.reservedInitialSlots <= 0) return null;
    this.reservedInitialSlots--;
    this.usedRequests++;
    this.active++;
    return this.makeLease();
  }

  /** Acquire a reserved final-validation slot with a concurrency lease. */
  async acquireReservedLease(now: number = Date.now()): Promise<RunLease | null> {
    if (this.remainingMs(now) <= 0) { this.deadlineExceeded = true; return null; }
    if (this.reservedSlots <= 0) return null;
    if (this.active >= this.maxConcurrency) {
      const ok = await this.waitForConcurrencySlot(now);
      if (!ok) return null;
    }
    if (this.reservedSlots <= 0) return null;
    this.reservedSlots--;
    this.usedRequests++;
    this.active++;
    return this.makeLease();
  }

  private makeLease(): RunLease {
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.active--;
        this.wakeWaiter();
      },
    };
  }

  /** Wait until a concurrency slot frees or the deadline expires. */
  private waitForConcurrencySlot(now: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const remaining = this.remainingMs(now);
      if (remaining <= 0) { this.deadlineExceeded = true; resolve(false); return; }
      let settled = false;
      let waiter: (() => void) | undefined;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.deadlineExceeded = true;
        if (waiter) {
          const idx = this.waiters.indexOf(waiter);
          if (idx >= 0) this.waiters.splice(idx, 1);
        }
        resolve(false);
      }, remaining);
      waiter = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(true);
      };
      this.waiters.push(waiter);
    });
  }

  private wakeWaiter(): void {
    this.waiters.shift()?.();
  }

  /** Create a promise that rejects when the deadline expires, for race-with-routes. */
  deadlinePromise(): Promise<never> {
    const remaining = this.remainingMs();
    return new Promise<never>((_, reject) => {
      setTimeout(() => { this.deadlineExceeded = true; reject(new Error('Optimization deadline exceeded')); }, remaining || 1);
    });
  }
}

/** Run-level diagnostic counters. Aggregate only, no PII. */
export class OptimizationRunCounters {
  graphHopperRequests = 0;
  cacheHits = 0;
  cacheMisses = 0;
  isochronePois = 0;
  placesAfterClustering = 0;
  /** Confirmed route builds issued by the bounded local search phase. */
  searchIterations = 0;
  /** Authoritative rebuilds after dropping a Place during final validation. */
  finalValidationRebuilds = 0;
  /** How many materially different alternatives were returned (0..2). */
  alternativesReturned = 0;
  exclusionReasons: Record<string, number> = {};
  deadlineExceeded = false;
  returnedBestConfirmed = false;

  recordExclusion(reason: string): void {
    this.exclusionReasons[reason] = (this.exclusionReasons[reason] ?? 0) + 1;
  }

  toJSON(): Record<string, unknown> {
    return {
      graphHopperRequests: this.graphHopperRequests,
      cacheHits: this.cacheHits,
      cacheMisses: this.cacheMisses,
      isochronePois: this.isochronePois,
      placesAfterClustering: this.placesAfterClustering,
      searchIterations: this.searchIterations,
      finalValidationRebuilds: this.finalValidationRebuilds,
      alternativesReturned: this.alternativesReturned,
      exclusionReasons: { ...this.exclusionReasons },
      deadlineExceeded: this.deadlineExceeded,
      returnedBestConfirmed: this.returnedBestConfirmed,
    };
  }
}
