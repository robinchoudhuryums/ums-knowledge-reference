/**
 * Cross-Encoder Re-Ranking
 *
 * Uses Claude Haiku via Bedrock to re-score query-chunk relevance after
 * initial retrieval. This produces more accurate ranking than heuristic
 * boosts because it considers the full semantic relationship between
 * the query and each candidate chunk.
 *
 * Flow:
 *   1. Initial retrieval returns top candidates (2x topK)
 *   2. Heuristic re-ranking (existing reRankResults) applies fast boosts
 *   3. Cross-encoder re-ranking (this module) sends top candidates to Claude
 *      for pairwise relevance scoring
 *   4. Results re-sorted by Claude's relevance scores
 *
 * Configuration:
 *   CROSS_ENCODER_RERANK=true   — Enable cross-encoder re-ranking (default: false)
 *   CROSS_ENCODER_TOP_N=8      — Number of candidates to re-score (default: 8)
 *
 * Trade-offs:
 *   + Significantly better precision on nuanced queries
 *   - Adds ~200-500ms latency per query (one Bedrock call)
 *   - Adds cost (~100 input tokens per candidate)
 */

import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';
import { withSpan } from '../utils/traceSpan';

const ENABLED = process.env.CROSS_ENCODER_RERANK === 'true';
const TOP_N = Math.min(parseInt(process.env.CROSS_ENCODER_TOP_N || '8', 10) || 8, 20);

/**
 * Re-rank candidates using Claude as a cross-encoder.
 * Returns the same candidates with updated scores based on LLM-assessed relevance.
 *
 * Falls back to the original scores if the LLM call fails.
 */
export async function crossEncoderRerank<T extends { chunk: { text: string }; score: number }>(
  query: string,
  candidates: T[],
): Promise<T[]> {
  if (!ENABLED || candidates.length === 0) return candidates;

  // Only re-score the top N candidates (the rest keep their original scores)
  const toScore: T[] = candidates.slice(0, TOP_N);
  const rest: T[] = candidates.slice(TOP_N);

  try {
    return await withSpan('rag.rerank.cross_encoder', { candidates: toScore.length }, async () => {
      // Build a compact prompt asking Claude to score relevance
      const passages = toScore.map((c, i) =>
        `[${i + 1}] ${c.chunk.text.slice(0, 300)}`
      ).join('\n\n');

      const prompt = `Rate the relevance of each passage to the query on a scale of 0-10.
Return ONLY a JSON array of numbers in the same order, e.g. [8, 3, 7, ...]

Query: ${query.slice(0, 200)}

Passages:
${passages}`;

      const command = new InvokeModelCommand({
        modelId: BEDROCK_GENERATION_MODEL,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify({
          anthropic_version: 'bedrock-2023-05-31',
          max_tokens: 100,
          temperature: 0,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      const response = await bedrockClient.send(command);
      const body = JSON.parse(new TextDecoder().decode(response.body));
      const text = body.content?.[0]?.text || '';

      // Parse the JSON array of scores
      const match = text.match(/\[[\d\s,.]+\]/);
      if (!match) {
        logger.warn('Cross-encoder rerank: could not parse scores', { response: text.slice(0, 200) });
        return [...toScore, ...rest];
      }

      const scores: number[] = JSON.parse(match[0]);
      if (scores.length !== toScore.length) {
        logger.warn('Cross-encoder rerank: score count mismatch', { expected: toScore.length, got: scores.length });
        return [...toScore, ...rest];
      }

      // Blend the cross-encoder score with the original score
      // Weight: 60% cross-encoder, 40% original (preserves retrieval signal)
      const reScored: T[] = toScore.map((candidate, i) => ({
        ...candidate,
        score: 0.4 * candidate.score + 0.6 * (scores[i] / 10),
      }));

      // Sort re-scored candidates by new score
      reScored.sort((a, b) => b.score - a.score);

      return [...reScored, ...rest];
    });
  } catch (err) {
    // Non-fatal — fall back to original ranking
    logger.warn('Cross-encoder rerank failed, using original ranking', { error: String(err) });
    return candidates;
  }
}

/** Check if cross-encoder re-ranking is enabled. */
export function isCrossEncoderEnabled(): boolean {
  return ENABLED;
}
