/**
 * Tests for the usage tracking service, including the atomic
 * checkAndRecordQuery function that prevents race conditions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock S3 storage
vi.mock('../services/s3Storage', () => {
  let store: Record<string, unknown> = {};
  return {
    loadMetadata: vi.fn(async <T>(key: string): Promise<T | null> => {
      return (store[key] as T) || null;
    }),
    saveMetadata: vi.fn(async (key: string, data: unknown) => {
      store[key] = data;
    }),
    __resetStore: () => { store = {}; },
  };
});

import { checkAndRecordQuery, checkUsageLimit, recordQuery, getUsageStats } from '../services/usage';
import * as s3Mock from '../services/s3Storage';
const { __resetStore } = s3Mock as any;

describe('Usage Tracking', () => {
  beforeEach(() => {
    __resetStore();
    // Reset module state by clearing any cached records
    // Note: We can't fully reset module-level state in vitest,
    // but the store reset handles the S3 persistence layer.
  });

  it('allows queries within daily limit', async () => {
    const result = await checkAndRecordQuery('user-1');
    expect(result.allowed).toBe(true);
    expect(result.usage?.userToday).toBe(1);
  });

  it('atomically checks and records to prevent races', async () => {
    // Simulate concurrent requests by calling checkAndRecordQuery rapidly
    const results = await Promise.all([
      checkAndRecordQuery('user-race'),
      checkAndRecordQuery('user-race'),
      checkAndRecordQuery('user-race'),
    ]);

    // All should succeed (well within limits)
    expect(results.every(r => r.allowed)).toBe(true);

    // Total queries should be 3 (each call atomically increments)
    const stats = await getUsageStats();
    // Account for prior tests: just verify user-race has at least 3
    const userCount = stats.today.users['user-race']?.queryCount || 0;
    expect(userCount).toBe(3);
  });

  it('blocks queries when user daily limit is reached', async () => {
    // Default limit is 30/day. Record 30 queries
    for (let i = 0; i < 30; i++) {
      await checkAndRecordQuery('heavy-user');
    }

    // 31st should be blocked
    const result = await checkAndRecordQuery('heavy-user');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('Daily limit');
  });

  it('tracks per-user counts independently', async () => {
    await checkAndRecordQuery('user-a');
    await checkAndRecordQuery('user-a');
    await checkAndRecordQuery('user-b');

    const stats = await getUsageStats();
    expect(stats.today.users['user-a']?.queryCount).toBe(2);
    expect(stats.today.users['user-b']?.queryCount).toBe(1);
  });

  it('legacy checkUsageLimit does not modify state', async () => {
    const before = await checkUsageLimit('readonly-user');
    expect(before.allowed).toBe(true);
    expect(before.usage?.userToday).toBe(0);

    // Calling check again should still show 0
    const after = await checkUsageLimit('readonly-user');
    expect(after.usage?.userToday).toBe(0);
  });

  it('legacy recordQuery increments count', async () => {
    await recordQuery('legacy-user');
    await recordQuery('legacy-user');

    const stats = await getUsageStats();
    expect(stats.today.users['legacy-user']?.queryCount).toBe(2);
  });
});
