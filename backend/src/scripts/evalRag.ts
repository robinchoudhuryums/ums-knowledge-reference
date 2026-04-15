/**
 * Gold-Standard RAG Evaluation Harness
 *
 * Runs every pair from goldStandardRag.json through the live retrieval +
 * enrichment pipeline using the currently-configured embedding model, then
 * emits both a human-readable report and a JUnit-compatible XML file for CI.
 *
 * Usage:
 *   cd backend && npx tsx src/scripts/evalRag.ts
 *
 * Environment:
 *   RAG_EVAL_RECALL_THRESHOLD  Minimum average recall@10 (default 0.5). Exit 1 if below.
 *   RAG_EVAL_MRR_THRESHOLD     Minimum MRR (default 0.4). Exit 1 if below.
 *   RAG_EVAL_OUTPUT_DIR        Where to write junit.xml + results.json (default ./eval-output)
 *
 * Intended to run on a schedule (nightly) against a populated vector store.
 * Not run as part of `npm test` because it requires live AWS credentials and
 * a populated index. The unit test in `__tests__/goldStandardEval.test.ts`
 * exercises the scoring logic without those dependencies.
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { TitanEmbeddingProvider } from '../services/titanEmbeddingProvider';
import { searchVectorStore } from '../services/vectorStore';
import { recallAtK, meanReciprocalRank, keywordCoverage, formatEvalReport } from '../services/ragMetrics';
import { enrichQueryWithStructuredData } from '../services/referenceEnrichment';
import { loadGoldStandard, GoldPair } from '../evalData/loader';
import { logger } from '../utils/logger';

interface RunResult {
  question: string;
  category: string;
  recall: number;
  keywordCov: number;
  reciprocalRank: number;
  retrievedCodes: string[];
  expectedCodes: string[];
  error?: string;
}

async function evaluatePair(pair: GoldPair, provider: TitanEmbeddingProvider): Promise<RunResult> {
  try {
    const embedding = await provider.generateEmbedding(pair.question);
    const searchResults = await searchVectorStore(embedding, pair.question, { topK: 10 });

    const retrievedText = searchResults.map(r => r.chunk.text).join(' ');
    const codePattern = /\b[A-Z]\d{4}\b/g;
    const retrievedCodes = [...new Set(retrievedText.match(codePattern) || [])];

    const enrichments = enrichQueryWithStructuredData(pair.question);
    const enrichmentText = enrichments.map(e => e.contextBlock).join(' ');
    const enrichmentCodes = [...new Set(enrichmentText.match(codePattern) || [])];
    const allCodes = [...new Set([...retrievedCodes, ...enrichmentCodes])];

    const recall = recallAtK(allCodes, pair.expectedCodes);
    const kwCov = keywordCoverage(retrievedText + ' ' + enrichmentText, pair.expectedKeywords);
    const rr = meanReciprocalRank([{ retrieved: allCodes, expected: pair.expectedCodes }]);

    return {
      question: pair.question,
      category: pair.category,
      recall,
      keywordCov: kwCov,
      reciprocalRank: rr,
      retrievedCodes: allCodes,
      expectedCodes: pair.expectedCodes,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Gold-standard eval pair failed', { question: pair.question, error: msg });
    return {
      question: pair.question,
      category: pair.category,
      recall: 0,
      keywordCov: 0,
      reciprocalRank: 0,
      retrievedCodes: [],
      expectedCodes: pair.expectedCodes,
      error: msg,
    };
  }
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '"': return '&quot;';
      case '\'': return '&apos;';
      default: return c;
    }
  });
}

function buildJunitXml(results: RunResult[], recallThreshold: number): string {
  const failures = results.filter(r => r.error || r.recall < recallThreshold).length;
  const testcases = results.map(r => {
    const name = escapeXml(r.question.slice(0, 100));
    const className = escapeXml(r.category);
    if (r.error) {
      return `    <testcase name="${name}" classname="${className}"><failure message="eval error">${escapeXml(r.error)}</failure></testcase>`;
    }
    if (r.recall < recallThreshold) {
      const missing = r.expectedCodes.filter(c => !r.retrievedCodes.includes(c)).join(', ');
      return `    <testcase name="${name}" classname="${className}"><failure message="recall below threshold">recall=${r.recall.toFixed(2)} &lt; ${recallThreshold}; missing: ${escapeXml(missing)}</failure></testcase>`;
    }
    return `    <testcase name="${name}" classname="${className}" />`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="rag-gold-standard" tests="${results.length}" failures="${failures}">
${testcases}
  </testsuite>
</testsuites>
`;
}

async function main() {
  const recallThreshold = parseFloat(process.env.RAG_EVAL_RECALL_THRESHOLD || '0.5');
  const mrrThreshold = parseFloat(process.env.RAG_EVAL_MRR_THRESHOLD || '0.4');
  const outputDir = process.env.RAG_EVAL_OUTPUT_DIR || './eval-output';

  const dataset = loadGoldStandard();
  console.log(`\nGold-standard RAG evaluation — ${dataset.pairs.length} pairs (v${dataset.version})`);
  console.log(`Thresholds: avg recall ≥ ${recallThreshold}, MRR ≥ ${mrrThreshold}\n`);

  const provider = new TitanEmbeddingProvider(process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0');

  const results: RunResult[] = [];
  for (const pair of dataset.pairs) {
    const r = await evaluatePair(pair, provider);
    results.push(r);
  }

  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgKw = results.reduce((s, r) => s + r.keywordCov, 0) / results.length;
  const mrr = meanReciprocalRank(results.map(r => ({ retrieved: r.retrievedCodes, expected: r.expectedCodes })));

  console.log(formatEvalReport(results.map(r => ({
    category: r.category,
    question: r.question,
    recall: r.recall,
    keywordCov: r.keywordCov,
    retrievedCodes: r.retrievedCodes,
    expectedCodes: r.expectedCodes,
  }))));

  console.log(`\n  Aggregate MRR: ${(mrr * 100).toFixed(1)}%`);
  console.log(`  Threshold check: recall ${avgRecall >= recallThreshold ? 'PASS' : 'FAIL'}  |  MRR ${mrr >= mrrThreshold ? 'PASS' : 'FAIL'}\n`);

  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, 'junit.xml'), buildJunitXml(results, recallThreshold));
  writeFileSync(join(outputDir, 'results.json'), JSON.stringify({
    datasetVersion: dataset.version,
    avgRecall,
    avgKeywordCoverage: avgKw,
    mrr,
    thresholds: { recall: recallThreshold, mrr: mrrThreshold },
    results,
  }, null, 2));

  const belowRecall = avgRecall < recallThreshold;
  const belowMrr = mrr < mrrThreshold;
  if (belowRecall || belowMrr) {
    console.error(`\nFAIL: below threshold(s) — ${belowRecall ? 'recall ' : ''}${belowMrr ? 'mrr' : ''}`);
    process.exit(1);
  }
  console.log(`\nOK: wrote ${outputDir}/junit.xml + results.json`);
}

main().catch(err => {
  console.error('RAG eval harness failed:', err);
  process.exit(2);
});
