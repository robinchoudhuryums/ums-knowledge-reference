/**
 * Bedrock model-tier abstraction — ported from CallAnalyzer's model-tiers.ts.
 *
 * Unifies all Bedrock model ID resolution behind a single function:
 * `getModelForTier(tier)`. New code picks a tier by semantic role rather
 * than hardcoding a specific model string or reading a service-specific
 * env var, so model evolution (new Haikus, renamed Sonnets, regional
 * availability changes, A/B test winners) is confined to one source of
 * truth.
 *
 * ─── Tiers ───────────────────────────────────────────────────────────
 *   strong     — Sonnet-class. Current uses: document extraction,
 *                clinical-note extraction. Matches RAG's existing
 *                BEDROCK_EXTRACTION_MODEL default.
 *   fast       — Haiku-class. Current uses: RAG query generation,
 *                vision describe during ingestion, insurance-card
 *                OCR, cross-encoder rerank. Matches RAG's existing
 *                BEDROCK_GENERATION_MODEL default.
 *   reasoning  — Opus-class. Reserved. Nothing reads it today; plumbed
 *                so adding an "extended-reasoning" feature later
 *                doesn't require new resolution code.
 *
 * Embeddings (Titan) are NOT a tier — they're a fundamentally different
 * model family with a different API. BEDROCK_EMBEDDING_MODEL stays as a
 * standalone env var.
 *
 * ─── Resolution chain (most specific first) ─────────────────────────
 *   1. Runtime admin override
 *      (PATCH /api/admin/model-tiers → persisted to S3)
 *   2. Tier-specific env var
 *      (BEDROCK_MODEL_STRONG, BEDROCK_MODEL_FAST, BEDROCK_MODEL_REASONING)
 *   3. Back-compat env var
 *      (BEDROCK_EXTRACTION_MODEL → strong, BEDROCK_GENERATION_MODEL → fast)
 *   4. Baked-in default
 *
 * Runtime overrides survive restart — loadTierOverrides() rehydrates
 * from S3 at boot and is fire-and-forget from server.ts.
 *
 * Legacy constants in config/aws.ts (BEDROCK_GENERATION_MODEL,
 * BEDROCK_EXTRACTION_MODEL) remain as boot-time exports for back-compat
 * with existing consumers. Those consumers see the boot-time value and
 * won't reflect runtime admin overrides — new call sites should use
 * getModelForTier() directly. Migration of existing consumers is
 * incremental.
 */

import { loadMetadata, saveMetadata } from './s3Storage';
import { logger } from '../utils/logger';

export type ModelTier = 'strong' | 'fast' | 'reasoning';

export const MODEL_TIERS: ModelTier[] = ['strong', 'fast', 'reasoning'];

export interface TierOverride {
  model: string;
  updatedBy: string;
  updatedAt: string;
  /** Why this override was set — e.g. "ab-test-promotion", "admin-ui". */
  reason?: string;
}

export interface TierOverridesPersisted {
  strong?: TierOverride;
  fast?: TierOverride;
  reasoning?: TierOverride;
}

export interface TierSnapshot {
  tier: ModelTier;
  /** The model currently being used after resolution. */
  effectiveModel: string;
  /** Where the effective model came from — for UI badges. */
  source: 'override' | 'env' | 'legacy-env' | 'default';
  /** The runtime override, if any. */
  override?: TierOverride;
  /** The env-var value for this tier, if set. */
  envValue?: string;
  /** The baked-in default for this tier. */
  defaultValue: string;
}

// ── Defaults ─────────────────────────────────────────────────────────
// NOTE: These are baked-in suggestions. The actual valid IDs for a
// given AWS account/region change over time. Operators should set
// BEDROCK_MODEL_* env vars or use the Admin UI to override.
const DEFAULTS: Record<ModelTier, string> = {
  strong: 'us.anthropic.claude-sonnet-4-6-20250514-v1:0',
  fast: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  reasoning: 'us.anthropic.claude-opus-4-7',
};

// Tier → env var names in resolution order.
const ENV_VARS: Record<ModelTier, { primary: string; legacy?: string }> = {
  strong: { primary: 'BEDROCK_MODEL_STRONG', legacy: 'BEDROCK_EXTRACTION_MODEL' },
  fast: { primary: 'BEDROCK_MODEL_FAST', legacy: 'BEDROCK_GENERATION_MODEL' },
  reasoning: { primary: 'BEDROCK_MODEL_REASONING' },
};

const S3_KEY = 'config/model-tiers.json';

// In-memory overrides, loaded from S3 at startup via loadTierOverrides().
const overrides: Partial<Record<ModelTier, TierOverride>> = {};

// ── Resolution ───────────────────────────────────────────────────────

function envFor(tier: ModelTier): string | undefined {
  const { primary, legacy } = ENV_VARS[tier];
  const p = process.env[primary];
  if (p) return p;
  if (legacy) {
    const l = process.env[legacy];
    if (l) return l;
  }
  return undefined;
}

function resolveEnvSource(tier: ModelTier): { value: string; legacy: boolean } | undefined {
  const { primary, legacy } = ENV_VARS[tier];
  const p = process.env[primary];
  if (p) return { value: p, legacy: false };
  if (legacy) {
    const l = process.env[legacy];
    if (l) return { value: l, legacy: true };
  }
  return undefined;
}

/**
 * Get the effective model ID for a tier. O(1); safe to call on hot paths.
 * Returns the resolved ID after applying override → env → legacy → default.
 */
export function getModelForTier(tier: ModelTier): string {
  return overrides[tier]?.model ?? envFor(tier) ?? DEFAULTS[tier];
}

/** Per-tier introspection for the Admin UI. */
export function getTierSnapshot(tier: ModelTier): TierSnapshot {
  const override = overrides[tier];
  const env = resolveEnvSource(tier);
  const effectiveModel = override?.model ?? env?.value ?? DEFAULTS[tier];
  const source: TierSnapshot['source'] = override
    ? 'override'
    : env
      ? env.legacy ? 'legacy-env' : 'env'
      : 'default';
  return {
    tier,
    effectiveModel,
    source,
    override,
    envValue: env?.value,
    defaultValue: DEFAULTS[tier],
  };
}

export function getAllTierSnapshots(): TierSnapshot[] {
  return MODEL_TIERS.map(getTierSnapshot);
}

// ── Persistence ──────────────────────────────────────────────────────

async function persistOverrides(): Promise<void> {
  try {
    const payload: TierOverridesPersisted = { ...overrides };
    await saveMetadata(S3_KEY, payload);
  } catch (err) {
    logger.warn('modelTiers: failed to persist overrides to S3', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Set a tier override. Persists to S3 for survival across restarts.
 *
 * Pass `clearTierOverride()` to remove an override and fall back through
 * the resolution chain.
 */
export async function setTierOverride(
  tier: ModelTier,
  model: string,
  updatedBy: string,
  reason?: string,
): Promise<TierOverride> {
  if (!model || typeof model !== 'string' || model.trim().length === 0) {
    throw new Error('setTierOverride: model must be a non-empty string');
  }
  const override: TierOverride = {
    model,
    updatedBy,
    updatedAt: new Date().toISOString(),
    reason,
  };
  overrides[tier] = override;
  await persistOverrides();
  logger.info('modelTiers: override applied', { tier, model, updatedBy, reason });
  return override;
}

export async function clearTierOverride(tier: ModelTier, updatedBy: string): Promise<void> {
  delete overrides[tier];
  await persistOverrides();
  logger.info('modelTiers: override cleared', { tier, updatedBy });
}

/**
 * Startup hydration. Restores overrides from S3. Fire-and-forget from
 * server.ts — failures are non-fatal (app starts with defaults / env).
 */
export async function loadTierOverrides(): Promise<void> {
  try {
    const persisted = await loadMetadata<TierOverridesPersisted>(S3_KEY);
    if (!persisted) return;
    let restored = 0;
    for (const tier of MODEL_TIERS) {
      const o = persisted[tier];
      if (o && typeof o.model === 'string' && o.model.length > 0) {
        overrides[tier] = o;
        restored += 1;
      }
    }
    if (restored > 0) {
      logger.info('modelTiers: restored overrides from S3', { count: restored });
    }
  } catch (err) {
    logger.warn('modelTiers: failed to load overrides from S3', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ── Test seams ───────────────────────────────────────────────────────

/** Test-only: clear all overrides without persisting. */
export function _resetTierOverridesForTests(): void {
  for (const tier of MODEL_TIERS) delete overrides[tier];
}

/** Test-only: set an override without hitting S3. */
export function _setOverrideForTests(tier: ModelTier, override: TierOverride): void {
  overrides[tier] = override;
}
