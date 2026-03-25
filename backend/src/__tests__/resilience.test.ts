import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRetry, withTimeout, CircuitBreaker } from '../utils/resilience';

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
