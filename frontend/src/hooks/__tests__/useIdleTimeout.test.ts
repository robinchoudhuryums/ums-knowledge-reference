import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIdleTimeout, IDLE_TIMEOUT_MS } from '../useIdleTimeout';

describe('useIdleTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not show warning initially', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onIdle, true));
    expect(result.current.showWarning).toBe(false);
  });

  it('shows warning 2 minutes before timeout', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onIdle, true));

    // Advance to just before warning time (15min - 2min = 13min)
    act(() => { vi.advanceTimersByTime(13 * 60 * 1000 - 100); });
    expect(result.current.showWarning).toBe(false);

    // Advance past warning threshold
    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.showWarning).toBe(true);
  });

  it('calls onIdle after full timeout period', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(onIdle, true));

    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 100); });
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('resets timer on activity events', () => {
    const onIdle = vi.fn();
    renderHook(() => useIdleTimeout(onIdle, true));

    // Advance 10 minutes
    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });

    // Simulate activity
    act(() => { window.dispatchEvent(new Event('mousedown')); });

    // Advance another 10 minutes (would have timed out without reset)
    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });

    // Should NOT have fired — timer was reset at the 10-minute mark
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('does not start timers when disabled', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onIdle, false));

    act(() => { vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 100); });
    expect(onIdle).not.toHaveBeenCalled();
    expect(result.current.showWarning).toBe(false);
  });

  it('clears warning on activity during warning period', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onIdle, true));

    // Enter warning period
    act(() => { vi.advanceTimersByTime(13 * 60 * 1000 + 100); });
    expect(result.current.showWarning).toBe(true);

    // User activity resets
    act(() => { window.dispatchEvent(new Event('keydown')); });
    expect(result.current.showWarning).toBe(false);
  });

  it('provides remaining seconds during warning', () => {
    const onIdle = vi.fn();
    const { result } = renderHook(() => useIdleTimeout(onIdle, true));

    // Enter warning period
    act(() => { vi.advanceTimersByTime(13 * 60 * 1000 + 100); });
    expect(result.current.showWarning).toBe(true);
    expect(result.current.remainingSeconds).toBeGreaterThan(0);
    expect(result.current.remainingSeconds).toBeLessThanOrEqual(120);
  });
});
