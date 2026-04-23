/**
 * Tests for model-tier resolution. Focused on the pure resolution chain
 * (override → env → legacy env → default); S3 persistence paths are
 * stubbed to avoid real cloud calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../services/s3Storage', () => ({
  loadMetadata: vi.fn(async () => null),
  saveMetadata: vi.fn(async () => {}),
}));

import {
  getModelForTier,
  getTierSnapshot,
  getAllTierSnapshots,
  setTierOverride,
  clearTierOverride,
  loadTierOverrides,
  _resetTierOverridesForTests,
  _setOverrideForTests,
  MODEL_TIERS,
} from '../services/modelTiers';
import * as s3Mock from '../services/s3Storage';

describe('getModelForTier resolution chain', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    _resetTierOverridesForTests();
    // Clear all relevant env vars so each test starts clean
    for (const v of [
      'BEDROCK_MODEL_STRONG',
      'BEDROCK_MODEL_FAST',
      'BEDROCK_MODEL_REASONING',
      'BEDROCK_EXTRACTION_MODEL',
      'BEDROCK_GENERATION_MODEL',
    ]) {
      delete process.env[v];
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetTierOverridesForTests();
  });

  it('returns the baked-in default when no override or env is set', () => {
    expect(getModelForTier('strong')).toMatch(/claude-sonnet/);
    expect(getModelForTier('fast')).toMatch(/claude-haiku/);
    expect(getModelForTier('reasoning')).toMatch(/claude-opus/);
  });

  it('prefers tier-specific env var over default', () => {
    process.env.BEDROCK_MODEL_STRONG = 'us.anthropic.claude-sonnet-99';
    expect(getModelForTier('strong')).toBe('us.anthropic.claude-sonnet-99');
  });

  it('falls back to legacy env var when tier-specific is unset', () => {
    process.env.BEDROCK_EXTRACTION_MODEL = 'us.anthropic.custom-extraction';
    expect(getModelForTier('strong')).toBe('us.anthropic.custom-extraction');
    process.env.BEDROCK_GENERATION_MODEL = 'us.anthropic.custom-generation';
    expect(getModelForTier('fast')).toBe('us.anthropic.custom-generation');
  });

  it('tier-specific env var wins over legacy env var', () => {
    process.env.BEDROCK_MODEL_STRONG = 'new-strong';
    process.env.BEDROCK_EXTRACTION_MODEL = 'legacy-strong';
    expect(getModelForTier('strong')).toBe('new-strong');
  });

  it('override wins over everything', () => {
    process.env.BEDROCK_MODEL_STRONG = 'env-strong';
    _setOverrideForTests('strong', {
      model: 'override-strong',
      updatedBy: 'test',
      updatedAt: new Date().toISOString(),
    });
    expect(getModelForTier('strong')).toBe('override-strong');
  });

  it('reasoning tier has no legacy env var, only primary + default', () => {
    process.env.BEDROCK_MODEL_REASONING = 'custom-reasoning';
    expect(getModelForTier('reasoning')).toBe('custom-reasoning');
  });
});

describe('getTierSnapshot', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    _resetTierOverridesForTests();
    delete process.env.BEDROCK_MODEL_STRONG;
    delete process.env.BEDROCK_EXTRACTION_MODEL;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    _resetTierOverridesForTests();
  });

  it('reports source=default when nothing is set', () => {
    expect(getTierSnapshot('strong').source).toBe('default');
  });

  it('reports source=env when tier-specific env is set', () => {
    process.env.BEDROCK_MODEL_STRONG = 'x';
    expect(getTierSnapshot('strong').source).toBe('env');
  });

  it('reports source=legacy-env when only legacy var is set', () => {
    process.env.BEDROCK_EXTRACTION_MODEL = 'x';
    expect(getTierSnapshot('strong').source).toBe('legacy-env');
  });

  it('reports source=override when override is applied', () => {
    _setOverrideForTests('strong', {
      model: 'override-x',
      updatedBy: 'test',
      updatedAt: new Date().toISOString(),
    });
    expect(getTierSnapshot('strong').source).toBe('override');
  });

  it('getAllTierSnapshots returns exactly one entry per tier', () => {
    const snaps = getAllTierSnapshots();
    expect(snaps.map((s) => s.tier).sort()).toEqual([...MODEL_TIERS].sort());
  });
});

describe('setTierOverride / clearTierOverride', () => {
  beforeEach(() => {
    _resetTierOverridesForTests();
    vi.mocked(s3Mock.saveMetadata).mockClear();
  });

  it('sets an override and persists to S3', async () => {
    await setTierOverride('fast', 'my-fast-model', 'alice', 'testing');
    expect(getModelForTier('fast')).toBe('my-fast-model');
    expect(s3Mock.saveMetadata).toHaveBeenCalledTimes(1);
  });

  it('setTierOverride rejects empty model string', async () => {
    await expect(setTierOverride('fast', '', 'alice')).rejects.toThrow(/non-empty string/);
    await expect(setTierOverride('fast', '   ', 'alice')).rejects.toThrow(/non-empty string/);
  });

  it('clearTierOverride removes override and persists', async () => {
    await setTierOverride('fast', 'my-fast-model', 'alice');
    expect(getTierSnapshot('fast').source).toBe('override');

    await clearTierOverride('fast', 'alice');
    expect(getTierSnapshot('fast').source).toBe('default');
  });
});

describe('loadTierOverrides', () => {
  beforeEach(() => {
    _resetTierOverridesForTests();
    vi.mocked(s3Mock.loadMetadata).mockClear();
  });

  it('no-ops when S3 returns null (no persisted overrides)', async () => {
    vi.mocked(s3Mock.loadMetadata).mockResolvedValueOnce(null);
    await loadTierOverrides();
    expect(getTierSnapshot('strong').source).toBe('default');
  });

  it('restores persisted overrides into memory', async () => {
    vi.mocked(s3Mock.loadMetadata).mockResolvedValueOnce({
      strong: { model: 'restored-strong', updatedBy: 'prior', updatedAt: '2026-01-01T00:00:00Z' },
      fast: { model: 'restored-fast', updatedBy: 'prior', updatedAt: '2026-01-01T00:00:00Z' },
    });
    await loadTierOverrides();
    expect(getModelForTier('strong')).toBe('restored-strong');
    expect(getModelForTier('fast')).toBe('restored-fast');
    // reasoning was not in the payload — falls through to default
    expect(getTierSnapshot('reasoning').source).toBe('default');
  });

  it('ignores malformed persisted entries (missing model string)', async () => {
    // Cast through `unknown` to simulate corrupt data from S3 where the
    // shape doesn't match what the validator expects.
    vi.mocked(s3Mock.loadMetadata).mockResolvedValueOnce({
      strong: { updatedBy: 'prior', updatedAt: '2026-01-01T00:00:00Z' } as unknown as { model: string; updatedBy: string; updatedAt: string },
    });
    await loadTierOverrides();
    expect(getTierSnapshot('strong').source).toBe('default');
  });

  it('tolerates S3 errors — non-fatal, falls through to defaults', async () => {
    vi.mocked(s3Mock.loadMetadata).mockRejectedValueOnce(new Error('S3 down'));
    await expect(loadTierOverrides()).resolves.toBeUndefined();
    expect(getTierSnapshot('strong').source).toBe('default');
  });
});
