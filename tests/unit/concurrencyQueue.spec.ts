import { describe, expect, test } from 'vitest';
import { runWithLimit, getCpuConcurrency } from '../../src/utils/concurrencyQueue';

describe('runWithLimit', () => {
  test('returns an empty array for empty input', async () => {
    const result = await runWithLimit<number, number>([], 4, async (n) => n);
    expect(result).toEqual([]);
  });

  test('preserves input order in the result', async () => {
    const items = [10, 20, 30, 40, 50];
    const result = await runWithLimit(items, 2, async (n) => n * 2);
    expect(result).toEqual([20, 40, 60, 80, 100]);
  });

  test('never has more than `limit` calls in flight at once', async () => {
    const limit = 3;
    let inFlight = 0;
    let peak = 0;

    const items = Array.from({ length: 12 }, (_, i) => i);
    await runWithLimit(items, limit, async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Yield long enough that workers actually overlap.
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
      inFlight--;
      return null;
    });

    expect(peak).toBeLessThanOrEqual(limit);
    expect(peak).toBeGreaterThan(1); // some overlap actually happened
  });

  test('rejects with the first error and stops scheduling new tasks', async () => {
    let started = 0;
    await expect(
      runWithLimit([1, 2, 3, 4, 5, 6, 7, 8], 2, async (n) => {
        started++;
        if (n === 3) throw new Error('boom');
        await new Promise((r) => setTimeout(r, 1));
        return n;
      }),
    ).rejects.toThrow('boom');
    // We can't be exact about how many started before the throw because of
    // scheduling, but the queue must not have run *every* item.
    expect(started).toBeLessThan(8);
  });

  test('throws on non-positive limit', async () => {
    await expect(runWithLimit([1, 2], 0, async (n) => n)).rejects.toThrow();
  });
});

describe('getCpuConcurrency', () => {
  test('returns at least 2 and respects the cap', () => {
    const value = getCpuConcurrency(6);
    expect(value).toBeGreaterThanOrEqual(2);
    expect(value).toBeLessThanOrEqual(6);
  });
});
