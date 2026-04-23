/**
 * Shared resilience utilities for AWS service calls:
 * - withRetry: exponential backoff with jitter
 * - withTimeout: promise timeout wrapper
 * - CircuitBreaker: prevents cascading failures
 */

import { logger } from './logger';

// ---------------------------------------------------------------------------
// withRetry
// ---------------------------------------------------------------------------

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  label?: string;
}

/**
 * Retry an async function with exponential backoff and jitter.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 1000, label = 'operation' } = options;
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries) {
        // Exponential backoff with jitter (±25%)
        const exponentialDelay = baseDelayMs * Math.pow(2, attempt);
        const jitter = exponentialDelay * (0.75 + Math.random() * 0.5);
        const delay = Math.round(jitter);

        logger.warn(`${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms`, {
          error: lastError.message,
        });
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

/**
 * Wrap a promise with a timeout. Rejects with an error if the timeout expires.
 */
export async function withTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  label: string = 'operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    fn().then(
      (result) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(result);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      },
    );
  });
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

export type CircuitState = 'closed' | 'open' | 'half-open';

/**
 * Thrown by `CircuitBreaker.execute()` (and `PerKeyCircuitBreaker.execute()`)
 * when the breaker is open at the time of the call. Callers that want to
 * distinguish "rejected by open circuit" from "upstream returned an error"
 * can `instanceof` this class cleanly rather than string-matching message
 * text. Existing `catch (err)` blocks that don't type-check still receive
 * an Error-subclass, so this change is backwards compatible.
 */
export class CircuitBreakerOpenError extends Error {
  readonly label: string;
  readonly failureCount: number;
  constructor(label: string, failureCount: number) {
    super(`Circuit breaker [${label}] is open — call rejected (${failureCount} consecutive failures, cooling down)`);
    this.name = 'CircuitBreakerOpenError';
    this.label = label;
    this.failureCount = failureCount;
  }
}

export class CircuitBreaker {
  /** Exposed for `PerKeyCircuitBreaker.snapshot()`. */
  public failureCount = 0;
  /** Exposed for `PerKeyCircuitBreaker.snapshot()`. */
  public lastFailureTime = 0;
  private state: CircuitState = 'closed';

  constructor(
    private readonly label: string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 30_000,
  ) {}

  getState(): CircuitState {
    // If open and reset timeout has elapsed, transition to half-open
    if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
      this.transitionTo('half-open');
    }
    return this.state;
  }

  isOpen(): boolean {
    return this.getState() === 'open';
  }

  /**
   * Execute `fn` under the circuit breaker.
   *
   * Optional `isFailure(err)` classifies errors: returning false means
   * "this error doesn't indicate an unhealthy upstream — surface it but
   * don't count it toward the failure threshold." Prevents client-side
   * errors (e.g. Bedrock 4xx schema rejections, malformed prompts) from
   * tripping the breaker and brownout-ing healthy traffic. Default
   * (no predicate) counts every error as a failure.
   *
   * Open-circuit rejection throws `CircuitBreakerOpenError` so callers
   * can distinguish "rejected by policy" from "fn threw".
   */
  async execute<T>(fn: () => Promise<T>, isFailure?: (err: unknown) => boolean): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'open') {
      throw new CircuitBreakerOpenError(this.label, this.failureCount);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      const counts = isFailure ? isFailure(error) : true;
      if (counts) this.onFailure();
      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      logger.info(`Circuit breaker [${this.label}] test call succeeded, closing circuit`);
    }
    this.failureCount = 0;
    this.transitionTo('closed');
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Half-open test failed — re-open immediately
      this.transitionTo('open');
    } else if (this.failureCount >= this.failureThreshold) {
      this.transitionTo('open');
    }
  }

  private transitionTo(newState: CircuitState): void {
    if (this.state !== newState) {
      logger.warn(`Circuit breaker [${this.label}] state transition: ${this.state} → ${newState}`, {
        failureCount: this.failureCount,
      });
      this.state = newState;
    }
  }
}

// ---------------------------------------------------------------------------
// PerKeyCircuitBreaker
// ---------------------------------------------------------------------------
//
// Keyed variant of CircuitBreaker — one independent state machine per key so
// a single failing target (one source-monitor URL, one webhook receiver,
// one alert-email category) doesn't brownout the rest. Bounded to MAX_KEYS
// entries with LRU eviction to prevent unbounded growth under pathological
// key churn.

export type CircuitSnapshot = {
  key: string;
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number;
};

export class PerKeyCircuitBreaker {
  private breakers = new Map<string, CircuitBreaker>();
  private readonly MAX_KEYS = 1_000;

  constructor(
    private readonly labelPrefix: string,
    private readonly failureThreshold: number = 5,
    private readonly resetTimeoutMs: number = 30_000,
  ) {}

  private getOrCreate(key: string, override?: { threshold?: number; resetMs?: number }): CircuitBreaker {
    let b = this.breakers.get(key);
    if (b) {
      // LRU touch: delete-then-set moves to most-recently-used end.
      this.breakers.delete(key);
      this.breakers.set(key, b);
      return b;
    }
    if (this.breakers.size >= this.MAX_KEYS) {
      const oldest = this.breakers.keys().next().value;
      if (oldest !== undefined) this.breakers.delete(oldest);
    }
    // Per-key override is applied only on first creation. A later policy
    // change by the caller won't retroactively update the breaker — the
    // caller must reset(key) to recreate with new thresholds.
    const threshold = override?.threshold ?? this.failureThreshold;
    const resetMs = override?.resetMs ?? this.resetTimeoutMs;
    b = new CircuitBreaker(`${this.labelPrefix}:${key}`, threshold, resetMs);
    this.breakers.set(key, b);
    return b;
  }

  /**
   * Execute `fn` under the per-key circuit. The third argument can be a
   * plain `isFailure` predicate (back-compat with CircuitBreaker.execute)
   * OR an options object: `{ isFailure?, threshold?, resetMs? }`. Threshold
   * and resetMs overrides are applied only when first creating a breaker
   * for this key.
   */
  async execute<T>(
    key: string,
    fn: () => Promise<T>,
    isFailureOrOptions?: ((err: unknown) => boolean) | { isFailure?: (err: unknown) => boolean; threshold?: number; resetMs?: number },
  ): Promise<T> {
    const opts = typeof isFailureOrOptions === 'function'
      ? { isFailure: isFailureOrOptions }
      : (isFailureOrOptions ?? {});
    const override = opts.threshold !== undefined || opts.resetMs !== undefined
      ? { threshold: opts.threshold, resetMs: opts.resetMs }
      : undefined;
    return this.getOrCreate(key, override).execute(fn, opts.isFailure);
  }

  /** Current state for a specific key — "closed" for unknown keys. */
  getState(key: string): CircuitState {
    const b = this.breakers.get(key);
    return b ? b.getState() : 'closed';
  }

  /** True when the key's breaker is currently open. Cheap read. */
  isOpen(key: string): boolean {
    return this.getState(key) === 'open';
  }

  /** Snapshot of all currently-tracked breakers, sorted by most-recently-failed. */
  snapshot(): CircuitSnapshot[] {
    const out: CircuitSnapshot[] = [];
    for (const [key, b] of this.breakers) {
      out.push({
        key,
        state: b.getState(),
        failureCount: b.failureCount,
        lastFailureTime: b.lastFailureTime,
      });
    }
    return out.sort((a, b) => b.lastFailureTime - a.lastFailureTime);
  }

  /** Reset a specific key's breaker (test seam + policy-change recreation). */
  reset(key: string): void {
    this.breakers.delete(key);
  }

  /** Reset all breakers (test seam). */
  resetAll(): void {
    this.breakers.clear();
  }
}
