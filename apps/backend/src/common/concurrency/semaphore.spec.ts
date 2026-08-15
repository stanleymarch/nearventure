import { describe, it, expect } from 'vitest';
import { Semaphore, SemaphoreBusyError } from './semaphore';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Semaphore', () => {
  it('limits concurrent execution to the configured max', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let peak = 0;

    const tasks = Array.from({ length: 10 }, async () => {
      await sem.run(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await sleep(10);
        active -= 1;
      });
    });

    await Promise.all(tasks);
    expect(peak).toBeLessThanOrEqual(2);
    expect(sem.pending).toBe(0);
  });

  it('queues excess work and runs it FIFO', async () => {
    const sem = new Semaphore(1);
    const order: number[] = [];
    const tasks = [1, 2, 3].map(async (i) => {
      await sem.run(async () => {
        order.push(i);
        await sleep(5);
      });
    });
    await Promise.all(tasks);
    expect(order).toEqual([1, 2, 3]);
  });

  it('releases the slot on failure', async () => {
    const sem = new Semaphore(1);
    await expect(sem.run(async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    // Slot is free again — a subsequent run succeeds.
    const result = await sem.run(async () => 'ok');
    expect(result).toBe('ok');
  });

  it('rejects an invalid max', () => {
    expect(() => new Semaphore(0)).toThrow(/positive integer/);
    expect(() => new Semaphore(1.5)).toThrow(/positive integer/);
  });

  it('rejects an invalid maxQueue', () => {
    expect(() => new Semaphore(1, -1)).toThrow(/maxQueue/);
    expect(() => new Semaphore(1, 1.5)).toThrow(/maxQueue/);
  });

  /**
   * Adversarial permit-transfer test: with the single slot held by A and B/C
   * queued, A releases at the exact moment D/E arrive. The fixed semaphore
   * transfers the permit to B without ever opening a slot, so `active` (the
   * observable in-flight count) must never exceed `max` — even though new
   * arrivals interleave with every release.
   */
  it('transfers the permit atomically to a queued waiter under interleaved arrivals', async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let peak = 0;

    // Acquire a slot and return a release handle; mirrors what run() does.
    const occupy = async (): Promise<() => void> => {
      await sem.acquire();
      active += 1;
      peak = Math.max(peak, active);
      return () => {
        active -= 1;
        sem.release();
      };
    };

    // A holds the only permit; B, C and D queue behind it.
    const releaseA = await occupy();
    const b = occupy();
    const c = occupy();
    const d = occupy();
    expect(sem.pending).toBe(3);
    expect(active).toBe(1);

    // A releases → the permit must transfer to B without ever freeing a slot.
    releaseA();
    await b;
    expect(active).toBe(1); // B now runs with the very same permit
    expect(peak).toBe(1);   // the cap was never exceeded

    // A fresh arrival at the handoff boundary must queue, not be admitted.
    const e = occupy();
    expect(sem.pending).toBe(3); // C, D, E — nothing above max started

    // Drain FIFO; every handoff keeps the in-flight count at exactly 1.
    (await b)();
    await c;
    expect(active).toBe(1);
    (await c)();
    await d;
    expect(active).toBe(1);
    (await d)();
    await e;
    expect(active).toBe(1);
    (await e)();
    expect(active).toBe(0);
    expect(sem.pending).toBe(0);
    expect(peak).toBe(1);
  });

  it('rejects new work when the queue is full instead of queueing indefinitely', async () => {
    const sem = new Semaphore(1, 2); // 1 concurrent, 2 queued max
    await sem.acquire();             // slot taken
    const first = sem.acquire();     // queued (1/2)
    const second = sem.acquire();    // queued (2/2)
    expect(sem.pending).toBe(2);

    // The next concurrent arrival is rejected immediately — no unbounded wait.
    await expect(sem.acquire()).rejects.toThrow(SemaphoreBusyError);
    // run() propagates the rejection and must NOT leak a slot.
    await expect(sem.run(async () => 'nope')).rejects.toThrow(SemaphoreBusyError);

    // Drain: both queued waiters get their permit, then the slot is freed.
    sem.release();
    await first;
    sem.release();
    await second;
    sem.release();
    expect(sem.pending).toBe(0);
    await expect(sem.run(async () => 'ok')).resolves.toBe('ok');
  });
});
