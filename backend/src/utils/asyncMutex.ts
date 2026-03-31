/**
 * Shared async mutex for serializing concurrent operations.
 *
 * Two patterns are provided:
 * - `createMutex()` — serialize all calls (only one runs at a time)
 * - `createOnceLock()` — coalesce concurrent calls (first caller runs, others wait for its result)
 *
 * Used by: ingestion (index updates), audit (hash chain), usage/queryLog/ragTrace (day-boundary transitions).
 */

/**
 * Create a mutex that serializes async operations. Only one call to the
 * returned function runs at a time; others queue behind it.
 *
 * Usage:
 *   const withLock = createMutex();
 *   await withLock(async () => { ... });
 */
export function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let pending: Promise<void> | null = null;

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    // Wait for any in-flight operation to finish
    while (pending) {
      await pending;
    }

    let resolve: () => void;
    pending = new Promise<void>(r => { resolve = r; });

    try {
      return await fn();
    } finally {
      pending = null;
      resolve!();
    }
  };
}

/**
 * Create a once-lock that coalesces concurrent async initializations.
 * The first caller runs the factory; concurrent callers wait for the same result.
 * After completion, subsequent calls run the factory again (it's not a permanent cache).
 *
 * Usage:
 *   const withOnceLock = createOnceLock();
 *   const record = await withOnceLock(async () => loadFromS3());
 */
export function createOnceLock(): <T>(fn: () => Promise<T>) => Promise<T> {
  let inflight: Promise<unknown> | null = null;

  return async function <T>(fn: () => Promise<T>): Promise<T> {
    if (inflight) return inflight as Promise<T>;

    inflight = (async () => {
      try {
        return await fn();
      } finally {
        inflight = null;
      }
    })();

    return inflight as Promise<T>;
  };
}
