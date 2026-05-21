/**
 * Bounded-parallelism utilities.
 *
 * Used by PDF ingestion to keep CPU-bound work (PDF.js page rendering) and
 * network/local-LLM-bound work (vision API calls) within reasonable resource
 * budgets without serializing them.
 */

/**
 * Run an async mapper over `items` with at most `limit` calls in flight.
 * Preserves input order in the returned array.
 *
 * Errors thrown by the mapper propagate as a rejected promise; in-flight tasks
 * that started before the failure are awaited to completion to avoid orphan
 * work, but their results are discarded.
 */
export async function runWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit <= 0) {
    throw new Error(`runWithLimit: limit must be > 0 (got ${limit})`);
  }

  const results: R[] = new Array(items.length);
  const total = items.length;
  if (total === 0) return results;

  const effectiveLimit = Math.min(limit, total);
  let cursor = 0;
  let firstError: unknown = null;

  const worker = async (): Promise<void> => {
    let hasMore = true;
    while (hasMore) {
      const i = cursor++;
      if (i >= total) {
        hasMore = false;
        continue;
      }
      if (firstError) {
        hasMore = false;
        continue;
      }
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        if (!firstError) firstError = err;
        return;
      }
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < effectiveLimit; i++) {
    workers.push(worker());
  }
  await Promise.all(workers);

  if (firstError) {
    throw firstError;
  }
  return results;
}

/**
 * Compute a sensible CPU-bound parallelism for the current host. Used for the
 * PDF render queue. Capped to avoid starving the UI thread on very large
 * machines and floored at 2 so small CI/Linux containers still see some
 * parallelism.
 */
export function getCpuConcurrency(max = 6): number {
  const hw = typeof navigator !== 'undefined' && typeof navigator.hardwareConcurrency === 'number'
    ? navigator.hardwareConcurrency
    : 4;
  return Math.max(2, Math.min(Math.floor(hw / 2), max));
}
