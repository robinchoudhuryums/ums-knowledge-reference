/**
 * A/B Model Testing Service for RAG Query Comparison.
 *
 * Adapted from Observatory QA's call-analysis A/B testing framework,
 * re-targeted for RAG answer quality comparison. Instead of comparing
 * models on call analysis, we compare models on RAG answer generation
 * by running the same query through two different Bedrock models and
 * comparing response quality, latency, token usage, and cost.
 *
 * Key features:
 * - Run same RAG query through two models in parallel
 * - Track latency, token usage, and estimated cost per model
 * - Welch's t-test for statistical significance on aggregate results
 * - Automated recommendation based on quality/cost/latency tradeoffs
 */
import { v4 as uuidv4 } from 'uuid';
import { InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { bedrockClient, bedrockCircuitBreaker, BEDROCK_GENERATION_MODEL } from '../config/aws';
import { searchVectorStore } from './vectorStore';
import { generateEmbedding } from './embeddings';
import { logger } from '../utils/logger';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ABTestResult {
  id: string;
  question: string;
  baselineModel: string;
  testModel: string;
  status: 'completed' | 'partial' | 'failed';
  baseline: ModelResult | null;
  test: ModelResult | null;
  createdAt: string;
}

export interface ModelResult {
  answer: string;
  confidence: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  error?: string;
}

export interface ABTestAggregateStats {
  testCount: number;
  baselineModel: string;
  testModel: string;
  avgBaselineLatencyMs: number;
  avgTestLatencyMs: number;
  latencyDiffPercent: number;
  avgBaselineCost: number;
  avgTestCost: number;
  costDiffPercent: number;
  avgBaselineTokens: { input: number; output: number };
  avgTestTokens: { input: number; output: number };
  significance: {
    tStatistic: number;
    degreesOfFreedom: number;
    pValue: number;
    isSignificant: boolean;
    confidenceLevel: string;
  } | null;
  recommendation: string;
}

// ─── Model Presets & Cost Estimation ────────────────────────────────────────

const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Pricing per 1K tokens
  'us.anthropic.claude-haiku-4-5-20251001-v1:0': { input: 0.001, output: 0.005 },
  'us.anthropic.claude-sonnet-4-6-20250514-v1:0': { input: 0.003, output: 0.015 },
  'us.anthropic.claude-sonnet-4-20250514-v1:0': { input: 0.003, output: 0.015 },
};

function estimateCost(modelId: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[modelId] || { input: 0.003, output: 0.015 };
  return Math.round(((inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output) * 10000) / 10000;
}

// ─── In-Memory Test Storage ─────────────────────────────────────────────────
// For a single-tenant tool, in-memory storage is sufficient.
// Production: persist to S3 or database.

const testResults: ABTestResult[] = [];
const MAX_STORED_TESTS = 200;

// ─── Core A/B Test Execution ────────────────────────────────────────────────

/**
 * Run a single RAG query through two models and compare results.
 * Both models see identical retrieval context — only the generation differs.
 */
export async function runABTest(
  question: string,
  testModelId: string,
  options?: {
    collectionIds?: string[];
    responseStyle?: 'concise' | 'detailed' | 'comprehensive';
    systemPrompt?: string;
  },
): Promise<ABTestResult> {
  const testId = uuidv4();
  const baselineModel = BEDROCK_GENERATION_MODEL;

  // Step 1: Run shared retrieval pipeline (same context for both models)
  const embedding = await generateEmbedding(question);
  const searchResults = await searchVectorStore(embedding, question, {
    topK: 8,
    collectionIds: options?.collectionIds,
  });

  // Build shared context from search results
  const context = searchResults
    .map((r, i) => `[Source ${i + 1}: ${r.document.originalName}]\n${r.chunk.text}`)
    .join('\n\n---\n\n');

  const systemPrompt = options?.systemPrompt || buildDefaultSystemPrompt(options?.responseStyle);

  const messages = [
    {
      role: 'user' as const,
      content: context
        ? `<document_context>\n${context}\n</document_context>\n\n<user_question>\n${question}\n</user_question>`
        : question,
    },
  ];

  // Step 2: Run both models in parallel (adapted from OQA's Promise.allSettled pattern)
  const [baselineResult, testResult] = await Promise.allSettled([
    invokeModel(baselineModel, systemPrompt, messages),
    invokeModel(testModelId, systemPrompt, messages),
  ]);

  const baseline: ModelResult | null =
    baselineResult.status === 'fulfilled' ? baselineResult.value : {
      answer: '', confidence: 'low', latencyMs: 0, inputTokens: 0, outputTokens: 0,
      estimatedCost: 0, error: sanitizeError(baselineResult.reason),
    };

  const test: ModelResult | null =
    testResult.status === 'fulfilled' ? testResult.value : {
      answer: '', confidence: 'low', latencyMs: 0, inputTokens: 0, outputTokens: 0,
      estimatedCost: 0, error: sanitizeError(testResult.reason),
    };

  const status = baseline?.error && test?.error ? 'failed'
    : baseline?.error || test?.error ? 'partial'
    : 'completed';

  const result: ABTestResult = {
    id: testId,
    question,
    baselineModel,
    testModel: testModelId,
    status,
    baseline,
    test,
    createdAt: new Date().toISOString(),
  };

  // Store result (evict oldest if at capacity)
  testResults.push(result);
  if (testResults.length > MAX_STORED_TESTS) {
    testResults.shift();
  }

  logger.info('A/B test completed', {
    testId,
    status,
    baselineLatencyMs: baseline?.latencyMs,
    testLatencyMs: test?.latencyMs,
  });

  return result;
}

async function invokeModel(
  modelId: string,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
): Promise<ModelResult> {
  const start = Date.now();

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify({
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      system: [{ type: 'text', text: systemPrompt }],
      messages: messages.map(m => ({ role: m.role, content: m.content })),
      temperature: 0.15,
    }),
  });

  const resp = await bedrockCircuitBreaker.execute(() => bedrockClient.send(command));
  const body = JSON.parse(new TextDecoder().decode(resp.body));
  const latencyMs = Date.now() - start;

  const answer = body.content?.[0]?.text || '';
  const inputTokens = body.usage?.input_tokens || 0;
  const outputTokens = body.usage?.output_tokens || 0;

  // Parse confidence from answer
  const confMatch = answer.match(/\[CONFIDENCE:\s*(HIGH|PARTIAL|LOW)\]/i);
  const confidence = confMatch ? confMatch[1].toLowerCase() : 'unknown';

  return {
    answer,
    confidence,
    latencyMs,
    inputTokens,
    outputTokens,
    estimatedCost: estimateCost(modelId, inputTokens, outputTokens),
  };
}

function buildDefaultSystemPrompt(style?: string): string {
  const styleNote = style === 'concise' ? 'Keep responses concise (1-3 sentences).'
    : style === 'comprehensive' ? 'Provide comprehensive responses with all relevant details.'
    : 'Provide balanced responses with the answer and supporting details.';
  return `You are a medical supply knowledge base assistant. Answer questions using ONLY the provided document context. ${styleNote} End with [CONFIDENCE: HIGH/PARTIAL/LOW].`;
}

function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  // Strip credentials, paths, and stack traces (HIPAA compliance)
  return msg
    .replace(/AKIA[A-Z0-9]{16}/g, '[REDACTED_KEY]')
    .replace(/\/[^\s]*\.(ts|js):\d+/g, '[internal]')
    .substring(0, 200);
}

// ─── Aggregate Statistics with Welch's t-test ───────────────────────────────

/**
 * Get all stored A/B test results.
 */
export function getTestResults(): ABTestResult[] {
  return testResults;
}

/**
 * Compute aggregate statistics with statistical significance testing.
 * Adapted from Observatory QA's computeAggregateStats() with Welch's t-test.
 */
export function computeAggregateStats(
  modelFilter?: string,
): ABTestAggregateStats | null {
  const tests = modelFilter
    ? testResults.filter(t => t.testModel === modelFilter && t.status === 'completed')
    : testResults.filter(t => t.status === 'completed');

  if (tests.length < 2) return null;

  const baselineLatencies: number[] = [];
  const testLatencies: number[] = [];
  const baselineCosts: number[] = [];
  const testCosts: number[] = [];
  let totalBaselineInput = 0, totalBaselineOutput = 0;
  let totalTestInput = 0, totalTestOutput = 0;

  for (const t of tests) {
    if (t.baseline && !t.baseline.error && t.test && !t.test.error) {
      baselineLatencies.push(t.baseline.latencyMs);
      testLatencies.push(t.test.latencyMs);
      baselineCosts.push(t.baseline.estimatedCost);
      testCosts.push(t.test.estimatedCost);
      totalBaselineInput += t.baseline.inputTokens;
      totalBaselineOutput += t.baseline.outputTokens;
      totalTestInput += t.test.inputTokens;
      totalTestOutput += t.test.outputTokens;
    }
  }

  const n = baselineLatencies.length;
  if (n < 2) return null;

  const avgBaselineLatency = baselineLatencies.reduce((a, b) => a + b, 0) / n;
  const avgTestLatency = testLatencies.reduce((a, b) => a + b, 0) / n;
  const avgBaselineCost = baselineCosts.reduce((a, b) => a + b, 0) / n;
  const avgTestCost = testCosts.reduce((a, b) => a + b, 0) / n;

  // Welch's t-test on latency (primary measurable metric for RAG)
  const significance = n >= 5 ? welchTTest(baselineLatencies, testLatencies) : null;

  // Recommendation
  const latencyDiff = ((avgTestLatency - avgBaselineLatency) / avgBaselineLatency) * 100;
  const costDiff = ((avgTestCost - avgBaselineCost) / avgBaselineCost) * 100;

  let recommendation: string;
  if (costDiff < -20 && latencyDiff < 10) {
    recommendation = `Test model saves ~${Math.abs(Math.round(costDiff))}% on cost with acceptable latency. Consider switching.`;
  } else if (latencyDiff < -20 && costDiff < 10) {
    recommendation = `Test model is ~${Math.abs(Math.round(latencyDiff))}% faster with acceptable cost. Consider switching.`;
  } else if (costDiff > 20 && latencyDiff > 0) {
    recommendation = `Test model is ${Math.round(costDiff)}% more expensive and not faster. Keep current model.`;
  } else {
    recommendation = `Results are mixed. Run more tests for clarity.`;
  }

  return {
    testCount: n,
    baselineModel: tests[0].baselineModel,
    testModel: tests[0].testModel,
    avgBaselineLatencyMs: Math.round(avgBaselineLatency),
    avgTestLatencyMs: Math.round(avgTestLatency),
    latencyDiffPercent: Math.round(latencyDiff * 10) / 10,
    avgBaselineCost: Math.round(avgBaselineCost * 10000) / 10000,
    avgTestCost: Math.round(avgTestCost * 10000) / 10000,
    costDiffPercent: Math.round(costDiff * 10) / 10,
    avgBaselineTokens: {
      input: Math.round(totalBaselineInput / n),
      output: Math.round(totalBaselineOutput / n),
    },
    avgTestTokens: {
      input: Math.round(totalTestInput / n),
      output: Math.round(totalTestOutput / n),
    },
    significance,
    recommendation,
  };
}

// ─── Statistical Helpers (ported from Observatory QA) ───────────────────────

/**
 * Welch's t-test for two independent samples with unequal variances.
 * Adapted from Observatory QA's ab-testing.ts.
 */
export function welchTTest(
  sample1: number[],
  sample2: number[],
): { tStatistic: number; degreesOfFreedom: number; pValue: number; isSignificant: boolean; confidenceLevel: string } {
  const n1 = sample1.length;
  const n2 = sample2.length;
  if (n1 < 2 || n2 < 2) {
    return { tStatistic: 0, degreesOfFreedom: 0, pValue: 1, isSignificant: false, confidenceLevel: 'not significant' };
  }

  const mean1 = sample1.reduce((a, b) => a + b, 0) / n1;
  const mean2 = sample2.reduce((a, b) => a + b, 0) / n2;
  const var1 = sample1.reduce((sum, x) => sum + (x - mean1) ** 2, 0) / (n1 - 1);
  const var2 = sample2.reduce((sum, x) => sum + (x - mean2) ** 2, 0) / (n2 - 1);

  const se = Math.sqrt(var1 / n1 + var2 / n2);
  if (se === 0) {
    // Zero variance: if means are equal, no difference; if different, infinitely significant
    const identical = Math.abs(mean1 - mean2) < 1e-10;
    return {
      tStatistic: identical ? 0 : (mean1 < mean2 ? -Infinity : Infinity),
      degreesOfFreedom: n1 + n2 - 2,
      pValue: identical ? 1 : 0,
      isSignificant: !identical,
      confidenceLevel: identical ? 'not significant' : '99%',
    };
  }

  const t = (mean1 - mean2) / se;

  // Welch-Satterthwaite degrees of freedom
  const num = (var1 / n1 + var2 / n2) ** 2;
  const den = (var1 / n1) ** 2 / (n1 - 1) + (var2 / n2) ** 2 / (n2 - 1);
  const df = Math.round((num / den) * 100) / 100;

  const pValue = tDistPValue(Math.abs(t), df);

  const isSignificant = pValue < 0.05;
  const confidenceLevel = pValue < 0.01 ? '99%' : pValue < 0.05 ? '95%' : 'not significant';

  return {
    tStatistic: Math.round(t * 1000) / 1000,
    degreesOfFreedom: df,
    pValue: Math.round(pValue * 10000) / 10000,
    isSignificant,
    confidenceLevel,
  };
}

/**
 * Approximate p-value from t-distribution.
 * Uses Cornish-Fisher approximation for moderate df, normal for large df.
 */
function tDistPValue(absT: number, df: number): number {
  if (df <= 0) return 1;
  // For large df, t-distribution ≈ normal
  if (df > 100) {
    return 2 * normalCdfComplement(absT);
  }
  // Cornish-Fisher approximation
  const adjustedZ = absT * Math.pow(1 + absT * absT / df, -0.5);
  return Math.min(1, Math.max(0, 2 * normalCdfComplement(adjustedZ)));
}

/**
 * Standard normal CDF complement P(Z > z).
 * Abramowitz & Stegun approximation 26.2.17.
 */
function normalCdfComplement(z: number): number {
  if (z < 0) return 1 - normalCdfComplement(-z);
  const b1 = 0.319381530, b2 = -0.356563782, b3 = 1.781477937, b4 = -1.821255978, b5 = 1.330274429;
  const p = 0.2316419;
  const t = 1 / (1 + p * z);
  const poly = t * (b1 + t * (b2 + t * (b3 + t * (b4 + t * b5))));
  return poly * Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
