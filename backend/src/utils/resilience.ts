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

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;

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

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.getState();

    if (currentState === 'open') {
      throw new Error(`Circuit breaker [${this.label}] is open — call rejected`);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
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
