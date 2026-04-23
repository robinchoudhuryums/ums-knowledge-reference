import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  withRetry,
  withTimeout,
  CircuitBreaker,
  CircuitBreakerOpenError,
  PerKeyCircuitBreaker,
} from '../utils/resilience';

// Suppress logger output during tests
vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('succeeds on first attempt without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100 });
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after transient failure then succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('recovered');

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 100, label: 'test-op' });

    // Advance past the first retry delay
    await vi.advanceTimersByTimeAsync(500);

    const result = await promise;
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after maxRetries and throws the last error', async () => {
    vi.useRealTimers();
    const fn = vi.fn().mockRejectedValue(new Error('persistent failure'));

    await expect(
      withRetry(fn, { maxRetries: 2, baseDelayMs: 10 })
    ).rejects.toThrow('persistent failure');
    // initial attempt + 2 retries = 3
    expect(fn).toHaveBeenCalledTimes(3);
    vi.useFakeTimers();
  });

  it('applies exponential backoff (later retries wait longer)', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail1'))
      .mockRejectedValueOnce(new Error('fail2'))
      .mockResolvedValue('done');

    const promise = withRetry(fn, { maxRetries: 3, baseDelayMs: 1000 });

    // After first failure, delay is ~1000ms (baseDelay * 2^0 with jitter 0.75-1.25)
    // Should NOT have retried yet at 500ms
    await vi.advanceTimersByTimeAsync(500);
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance past the first retry delay (max jitter: 1250ms)
    await vi.advanceTimersByTimeAsync(800);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry delay is ~2000ms (baseDelay * 2^1), advance past it
    await vi.advanceTimersByTimeAsync(3000);
    const result = await promise;
    expect(result).toBe('done');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves when promise completes within timeout', async () => {
    const fn = () => new Promise<string>(resolve => setTimeout(() => resolve('fast'), 50));
    const promise = withTimeout(fn, 200, 'fast-op');
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;
    expect(result).toBe('fast');
  });

  it('rejects when promise exceeds timeout', async () => {
    vi.useRealTimers();
    const fn = () => new Promise<string>(resolve => setTimeout(() => resolve('slow'), 500));
    await expect(withTimeout(fn, 10, 'slow-op')).rejects.toThrow('slow-op timed out after 10ms');
    vi.useFakeTimers();
  });
});

describe('CircuitBreaker', () => {
  it('stays closed on success', async () => {
    const cb = new CircuitBreaker('test', 3, 1000);
    const result = await cb.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(cb.getState()).toBe('closed');
  });

  it('opens after reaching failure threshold', async () => {
    const cb = new CircuitBreaker('test', 3, 1000);

    for (let i = 0; i < 3; i++) {
      await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    }

    expect(cb.getState()).toBe('open');
  });

  it('rejects calls when open', async () => {
    const cb = new CircuitBreaker('test', 2, 60000);

    // Trip the breaker
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    expect(cb.getState()).toBe('open');

    // Next call should be rejected without invoking the function
    const fn = vi.fn().mockResolvedValue('should not run');
    await expect(cb.execute(fn)).rejects.toThrow('Circuit breaker [test] is open');
    expect(fn).not.toHaveBeenCalled();
  });

  it('transitions to half-open after reset timeout elapses', async () => {
    const cb = new CircuitBreaker('test', 2, 500);

    // Trip the breaker
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    await cb.execute(async () => { throw new Error('fail'); }).catch(() => {});
    expect(cb.getState()).toBe('open');

    // Simulate time passing beyond resetTimeout using Date.now mock
    const realNow = Date.now;
    let mockTime = realNow();
    vi.spyOn(Date, 'now').mockImplementation(() => mockTime);

    // Move time forward past the reset timeout
    mockTime += 600;

    expect(cb.getState()).toBe('half-open');

    // Successful call in half-open should close the circuit
    const result = await cb.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('closed');

    vi.spyOn(Date, 'now').mockRestore();
  });
});

describe('CircuitBreakerOpenError', () => {
  it('is thrown when the circuit is open, not a plain Error', async () => {
    const b = new CircuitBreaker('test', 1, 10_000);
    await expect(b.execute(async () => { throw new Error('boom'); })).rejects.toThrow();

    try {
      await b.execute(async () => 'ok');
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(CircuitBreakerOpenError);
      expect(err).toBeInstanceOf(Error); // back-compat for untyped catch
      const typed = err as CircuitBreakerOpenError;
      expect(typed.label).toBe('test');
      expect(typed.failureCount).toBe(1);
    }
  });
});

describe('CircuitBreaker isFailure predicate', () => {
  it('errors returning false from isFailure do NOT count toward the threshold', async () => {
    const b = new CircuitBreaker('test', 2, 10_000);
    const isServer = (err: unknown) =>
      err instanceof Error && err.message.startsWith('server:');

    // 10 "client" errors — circuit stays closed
    for (let i = 0; i < 10; i++) {
      await expect(b.execute(async () => { throw new Error('client: bad'); }, isServer)).rejects.toThrow();
    }
    expect(b.getState()).toBe('closed');

    // Two server errors — opens at threshold
    await expect(b.execute(async () => { throw new Error('server: bad'); }, isServer)).rejects.toThrow();
    await expect(b.execute(async () => { throw new Error('server: bad'); }, isServer)).rejects.toThrow();
    expect(b.getState()).toBe('open');
  });
});

describe('PerKeyCircuitBreaker', () => {
  it('isolates state per key — one failing key does not trip others', async () => {
    const pk = new PerKeyCircuitBreaker('test', 2, 10_000);

    await expect(pk.execute('a', async () => { throw new Error('boom'); })).rejects.toThrow();
    await expect(pk.execute('a', async () => { throw new Error('boom'); })).rejects.toThrow();
    expect(pk.getState('a')).toBe('open');

    expect(pk.getState('b')).toBe('closed');
    const resultB = await pk.execute('b', async () => 'ok');
    expect(resultB).toBe('ok');

    // 'a' rejects fast with typed error
    await expect(pk.execute('a', async () => 'ok')).rejects.toBeInstanceOf(CircuitBreakerOpenError);
  });

  it('reset(key) clears only that key', async () => {
    const pk = new PerKeyCircuitBreaker('test', 1, 10_000);
    await expect(pk.execute('a', async () => { throw new Error('boom'); })).rejects.toThrow();
    expect(pk.isOpen('a')).toBe(true);
    pk.reset('a');
    expect(pk.isOpen('a')).toBe(false);
  });

  it('accepts per-key threshold override on first creation', async () => {
    const pk = new PerKeyCircuitBreaker('test', 5, 10_000);

    await expect(
      pk.execute('strict', async () => { throw new Error('boom'); }, { threshold: 1 }),
    ).rejects.toThrow();
    expect(pk.isOpen('strict')).toBe(true);

    // Default threshold (5) on other keys
    await expect(pk.execute('normal', async () => { throw new Error('boom'); })).rejects.toThrow();
    expect(pk.isOpen('normal')).toBe(false);
  });

  it('supports a plain isFailure predicate (back-compat with CircuitBreaker.execute)', async () => {
    const pk = new PerKeyCircuitBreaker('test', 2, 10_000);
    const onlyServer = (err: unknown) =>
      err instanceof Error && err.message.startsWith('server:');

    for (let i = 0; i < 10; i++) {
      await expect(
        pk.execute('a', async () => { throw new Error('client: nope'); }, onlyServer),
      ).rejects.toThrow();
    }
    expect(pk.isOpen('a')).toBe(false);

    await expect(
      pk.execute('a', async () => { throw new Error('server: boom'); }, onlyServer),
    ).rejects.toThrow();
    await expect(
      pk.execute('a', async () => { throw new Error('server: boom'); }, onlyServer),
    ).rejects.toThrow();
    expect(pk.isOpen('a')).toBe(true);
  });

  it('snapshot() returns tracked breakers sorted by most-recently-failed', async () => {
    const pk = new PerKeyCircuitBreaker('test', 1, 10_000);

    await pk.execute('first', async () => 'ok');
    await expect(pk.execute('second', async () => { throw new Error('boom'); })).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 5));
    await expect(pk.execute('third', async () => { throw new Error('boom'); })).rejects.toThrow();

    const snap = pk.snapshot();
    expect(snap.length).toBe(3);
    expect(snap[0].key).toBe('third');  // most recent failure
    expect(snap[1].key).toBe('second');
    expect(snap[2].key).toBe('first');  // no failures → lastFailureTime=0
  });

  it('LRU-evicts oldest key past MAX_KEYS cap', async () => {
    const pk = new PerKeyCircuitBreaker('test', 10, 10_000);
    for (let i = 0; i < 1_005; i++) {
      await pk.execute(`k${i}`, async () => 'ok');
    }
    const snap = pk.snapshot();
    expect(snap.length).toBe(1_000);
    const keys = new Set(snap.map((s) => s.key));
    expect(keys.has('k0')).toBe(false);    // oldest evicted
    expect(keys.has('k1004')).toBe(true);  // newest retained
  }, 30_000);
});
