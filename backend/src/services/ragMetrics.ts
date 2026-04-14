/**
 * RAG Retrieval Metrics
 *
 * Computes recall@K and MRR (Mean Reciprocal Rank) for retrieval evaluation.
 * Used by the evaluation test suite and the CLI evaluation script.
 *
 * These metrics measure how well the retrieval pipeline finds relevant documents
 * before the LLM generation step — independent of answer quality.
 */

/**
 * Recall@K: fraction of expected items found in the top-K results.
 * @param retrieved - ordered list of retrieved item identifiers (e.g., HCPCS codes, document IDs)
 * @param expected - set of expected relevant item identifiers
 * @param k - number of top results to consider (default: all retrieved)
 * @returns 0.0 to 1.0
 */
export function recallAtK(retrieved: string[], expected: string[], k?: number): number {
  if (expected.length === 0) return 1.0; // No expectations = trivially satisfied
  const topK = k ? retrieved.slice(0, k) : retrieved;
  const expectedSet = new Set(expected.map(e => e.toUpperCase()));
  const found = topK.filter(r => expectedSet.has(r.toUpperCase())).length;
  return found / expected.length;
}

/**
 * Mean Reciprocal Rank: average of 1/rank for the first relevant result per query.
 * @param queriesResults - array of { retrieved, expected } for each query
 * @returns 0.0 to 1.0 (higher is better)
 */
export function meanReciprocalRank(
  queriesResults: Array<{ retrieved: string[]; expected: string[] }>
): number {
  if (queriesResults.length === 0) return 0;
  let sumRR = 0;
  for (const { retrieved, expected } of queriesResults) {
    const expectedSet = new Set(expected.map(e => e.toUpperCase()));
    const rank = retrieved.findIndex(r => expectedSet.has(r.toUpperCase()));
    if (rank >= 0) {
      sumRR += 1 / (rank + 1);
    }
    // If not found, reciprocal rank is 0 (no contribution)
  }
  return sumRR / queriesResults.length;
}

/**
 * Keyword coverage: fraction of expected keywords found in the text.
 * Case-insensitive.
 */
export function keywordCoverage(text: string, expectedKeywords: string[]): number {
  if (expectedKeywords.length === 0) return 1.0;
  const lower = text.toLowerCase();
  const found = expectedKeywords.filter(kw => lower.includes(kw.toLowerCase())).length;
  return found / expectedKeywords.length;
}

/**
 * Format evaluation results as a summary report.
 */
export function formatEvalReport(results: {
  category: string;
  question: string;
  recall: number;
  keywordCov: number;
  retrievedCodes: string[];
  expectedCodes: string[];
}[]): string {
  const lines: string[] = [];
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('  RAG Retrieval Evaluation Report');
  lines.push('═══════════════════════════════════════════════════════════════');
  lines.push('');

  // Group by category
  const byCategory = new Map<string, typeof results>();
  for (const r of results) {
    const group = byCategory.get(r.category) || [];
    group.push(r);
    byCategory.set(r.category, group);
  }

  let totalRecall = 0;
  let totalKw = 0;
  let count = 0;

  for (const [category, items] of byCategory) {
    lines.push(`── ${category.toUpperCase()} ──`);
    for (const item of items) {
      const recallPct = (item.recall * 100).toFixed(0);
      const kwPct = (item.keywordCov * 100).toFixed(0);
      const status = item.recall >= 0.8 ? '✓' : item.recall >= 0.5 ? '~' : '✗';
      lines.push(`  ${status} [R:${recallPct}% K:${kwPct}%] ${item.question}`);
      if (item.recall < 1.0 && item.expectedCodes.length > 0) {
        const missing = item.expectedCodes.filter(c => !item.retrievedCodes.includes(c));
        if (missing.length > 0) lines.push(`    Missing: ${missing.join(', ')}`);
      }
      totalRecall += item.recall;
      totalKw += item.keywordCov;
      count++;
    }
    lines.push('');
  }

  const avgRecall = count > 0 ? (totalRecall / count * 100).toFixed(1) : '0.0';
  const avgKw = count > 0 ? (totalKw / count * 100).toFixed(1) : '0.0';

  lines.push('── AGGREGATE ──');
  lines.push(`  Average Recall:    ${avgRecall}%`);
  lines.push(`  Average Keyword:   ${avgKw}%`);
  lines.push(`  Total Questions:   ${count}`);
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}
