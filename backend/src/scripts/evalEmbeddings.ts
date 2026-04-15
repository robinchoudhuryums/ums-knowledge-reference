/**
 * Embedding Model Evaluation Script
 *
 * Compares embedding models by running the gold-standard Q&A pairs through
 * each provider and measuring retrieval quality (recall@K, MRR, keyword coverage).
 *
 * Prerequisites:
 *   - Vector store populated with documents (run ingestion first)
 *   - AWS credentials configured for Bedrock access
 *   - Both embedding models available in your Bedrock region
 *
 * Usage:
 *   # Compare current model against Cohere:
 *   cd backend && npx tsx src/scripts/evalEmbeddings.ts
 *
 *   # Compare specific models:
 *   cd backend && EVAL_MODELS=amazon.titan-embed-text-v2:0,cohere.embed-english-v3 npx tsx src/scripts/evalEmbeddings.ts
 *
 * Output: side-by-side recall@K, MRR, and keyword coverage for each model.
 */

import { TitanEmbeddingProvider } from '../services/titanEmbeddingProvider';
import { CohereEmbeddingProvider } from '../services/cohereEmbeddingProvider';
import { EmbeddingProvider } from '../services/embeddingProvider';
import { searchVectorStore } from '../services/vectorStore';
import { recallAtK, meanReciprocalRank, keywordCoverage, formatEvalReport } from '../services/ragMetrics';
import { enrichQueryWithStructuredData } from '../services/referenceEnrichment';
import { loadGoldStandard } from '../evalData/loader';
import { logger } from '../utils/logger';

// Gold-standard Q&A pairs loaded from evalData/goldStandardRag.json so the eval
// harness, unit tests, and documentation stay in sync.
const EVAL_PAIRS = loadGoldStandard().pairs;

interface ModelResult {
  modelId: string;
  results: {
    category: string;
    question: string;
    recall: number;
    keywordCov: number;
    retrievedCodes: string[];
    expectedCodes: string[];
  }[];
  avgRecall: number;
  avgKeywordCov: number;
  mrr: number;
}

async function evaluateModel(provider: EmbeddingProvider): Promise<ModelResult> {
  const results: ModelResult['results'] = [];
  const mrrInputs: { retrieved: string[]; expected: string[] }[] = [];

  for (const pair of EVAL_PAIRS) {
    try {
      const embedding = await provider.generateEmbedding(pair.question);

      const searchResults = await searchVectorStore(embedding, pair.question, { topK: 10 });

      // Extract HCPCS codes from retrieved chunks
      const retrievedText = searchResults.map(r => r.chunk.text).join(' ');
      const codePattern = /\b[A-Z]\d{4}\b/g;
      const retrievedCodes = [...new Set(retrievedText.match(codePattern) || [])];

      // Also check enrichment codes
      const enrichments = enrichQueryWithStructuredData(pair.question);
      const enrichmentText = enrichments.map(e => e.contextBlock).join(' ');
      const enrichmentCodes = [...new Set(enrichmentText.match(codePattern) || [])];
      const allCodes = [...new Set([...retrievedCodes, ...enrichmentCodes])];

      const recall = recallAtK(allCodes, pair.expectedCodes);
      const kwCov = keywordCoverage(retrievedText + ' ' + enrichmentText, pair.expectedKeywords);

      results.push({
        category: pair.category,
        question: pair.question,
        recall,
        keywordCov: kwCov,
        retrievedCodes: allCodes,
        expectedCodes: pair.expectedCodes,
      });

      mrrInputs.push({ retrieved: allCodes, expected: pair.expectedCodes });
    } catch (err) {
      logger.error(`Eval failed for "${pair.question}"`, { model: provider.modelId, error: String(err) });
      results.push({
        category: pair.category,
        question: pair.question,
        recall: 0,
        keywordCov: 0,
        retrievedCodes: [],
        expectedCodes: pair.expectedCodes,
      });
      mrrInputs.push({ retrieved: [], expected: pair.expectedCodes });
    }
  }

  const avgRecall = results.reduce((s, r) => s + r.recall, 0) / results.length;
  const avgKeywordCov = results.reduce((s, r) => s + r.keywordCov, 0) / results.length;
  const mrr = meanReciprocalRank(mrrInputs);

  return { modelId: provider.modelId, results, avgRecall, avgKeywordCov, mrr };
}

async function main() {
  const modelStr = process.env.EVAL_MODELS || 'amazon.titan-embed-text-v2:0,cohere.embed-english-v3';
  const modelIds = modelStr.split(',').map(s => s.trim());

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Embedding Model Evaluation');
  console.log(`  Models: ${modelIds.join(' vs ')}`);
  console.log(`  Questions: ${EVAL_PAIRS.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  const modelResults: ModelResult[] = [];

  for (const modelId of modelIds) {
    console.log(`\n── Evaluating: ${modelId} ──\n`);
    const provider = modelId.includes('cohere')
      ? new CohereEmbeddingProvider(modelId)
      : new TitanEmbeddingProvider(modelId);

    const result = await evaluateModel(provider);
    modelResults.push(result);

    console.log(formatEvalReport(result.results));
    console.log(`  MRR: ${(result.mrr * 100).toFixed(1)}%\n`);
  }

  // Side-by-side comparison
  if (modelResults.length >= 2) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  COMPARISON');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const headers = ['Metric', ...modelResults.map(r => r.modelId.split('.').pop() || r.modelId)];
    console.log(headers.map(h => h.padEnd(25)).join(''));
    console.log('-'.repeat(25 * headers.length));

    const rows = [
      ['Avg Recall@10', ...modelResults.map(r => `${(r.avgRecall * 100).toFixed(1)}%`)],
      ['Avg Keyword Coverage', ...modelResults.map(r => `${(r.avgKeywordCov * 100).toFixed(1)}%`)],
      ['MRR', ...modelResults.map(r => `${(r.mrr * 100).toFixed(1)}%`)],
    ];

    for (const row of rows) {
      console.log(row.map(c => c.padEnd(25)).join(''));
    }

    // Winner
    const best = modelResults.reduce((a, b) => (a.avgRecall + a.mrr) > (b.avgRecall + b.mrr) ? a : b);
    console.log(`\n  Recommended: ${best.modelId} (highest combined recall + MRR)`);
    console.log('═══════════════════════════════════════════════════════════════');
  }
}

main().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
