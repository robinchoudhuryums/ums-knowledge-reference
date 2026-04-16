/**
 * Gold-standard RAG evaluation dataset loader.
 *
 * The dataset itself lives in `goldStandardRag.json` so it can be reviewed,
 * diffed, and versioned without touching code. This loader validates the
 * shape at load time so a malformed entry fails fast instead of silently
 * producing zero-recall results.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

export interface GoldPair {
  question: string;
  category: string;
  expectedKeywords: string[];
  expectedCodes: string[];
}

export interface GoldStandard {
  version: string;
  description: string;
  lastUpdated: string;
  pairs: GoldPair[];
}

const DATA_PATH = join(__dirname, 'goldStandardRag.json');

/**
 * Load and validate the gold-standard dataset.
 * Throws if the file is missing, malformed, or has fewer than 10 pairs
 * (sanity floor for a meaningful eval run).
 */
export function loadGoldStandard(): GoldStandard {
  const raw = readFileSync(DATA_PATH, 'utf8');
  const parsed = JSON.parse(raw) as GoldStandard;

  if (!parsed.version || !parsed.pairs || !Array.isArray(parsed.pairs)) {
    throw new Error('Gold-standard dataset: missing required fields (version, pairs[])');
  }
  if (parsed.pairs.length < 10) {
    throw new Error(`Gold-standard dataset: needs ≥10 pairs, found ${parsed.pairs.length}`);
  }

  for (let i = 0; i < parsed.pairs.length; i++) {
    const p = parsed.pairs[i];
    if (!p.question || typeof p.question !== 'string') {
      throw new Error(`Gold-standard pair[${i}]: missing question`);
    }
    if (!p.category || typeof p.category !== 'string') {
      throw new Error(`Gold-standard pair[${i}]: missing category`);
    }
    if (!Array.isArray(p.expectedKeywords)) {
      throw new Error(`Gold-standard pair[${i}]: expectedKeywords must be array`);
    }
    if (!Array.isArray(p.expectedCodes)) {
      throw new Error(`Gold-standard pair[${i}]: expectedCodes must be array`);
    }
  }

  return parsed;
}
