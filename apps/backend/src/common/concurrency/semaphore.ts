/**
 * Minimal promise-based semaphore (concurrency limiter).
 *
 * Used to bound concurrent outbound GraphHopper requests so a flood of
 * public routing calls cannot saturate the routing engine. Excess work
 * waits in the FIFO queue (bounded — see `maxQueue`); the HTTP rate limiter
 * is what actively rejects abusive clients.
 *
 * Invariant: the number of tasks holding a permit never exceeds `max`,
 * INCLUDING during handoff. `release()` transfers the permit directly to
 * the next queued waiter without decrementing `active`, so a new arrival
 * between the release and the waiter actually starting is never admitted.
 */
export class SemaphoreBusyError extends Error {
  constructor(message = 'Semaphore queue is full') {
    super(message);
    this.name = 'SemaphoreBusyError';
  }
}

export class Semaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];

  /**
   * @param max       maximum concurrently held permits
   * @param maxQueue  maximum number of queued waiters (0 = unbounded).
   *                  When the queue is full, `acquire()` rejects with
   *                  `SemaphoreBusyError` instead of queueing indefinitely.
   */
  constructor(
    private readonly max: number,
    private readonly maxQueue = 0,
  ) {
    if (!Number.isInteger(max) || max < 1) {
      throw new Error('Semaphore max must be a positive integer');
    }
    if (!Number.isInteger(maxQueue) || maxQueue < 0) {
      throw new Error('Semaphore maxQueue must be a non-negative integer');
    }
  }

  /** Number of tasks currently waiting for a slot. */
  get pending(): number {
    return this.queue.length;
  }

  acquire(): Promise<void> {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    if (this.maxQueue > 0 && this.queue.length >= this.maxQueue) {
      return Promise.reject(new SemaphoreBusyError());
    }
    return new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    const next = this.queue.shift();
    if (next) {
      // Permit transfer: hand the slot directly to the next waiter. `active`
      // is NOT decremented here, so no new caller can sneak in during the
      // handoff — the concurrency cap holds even under interleaved arrivals.
      next();
      return;
    }
    this.active -= 1;
  }

  /** Run `fn` while holding a slot; always releases it afterwards. */
  async run<T>(fn: () => Promise<T> | T): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
