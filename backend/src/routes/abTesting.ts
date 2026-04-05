/**
 * A/B Model Testing Routes.
 *
 * Endpoints for comparing Bedrock models on RAG query quality.
 * Adapted from Observatory QA's ab-testing.ts for the RAG context.
 *
 * All endpoints require admin role.
 */
import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { runABTest, getTestResults, computeAggregateStats } from '../services/abTesting';
import { BEDROCK_GENERATION_MODEL } from '../config/aws';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/ab-tests/run
 * Run a single A/B test: same query through baseline + test model.
 */
router.post('/run', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { question, testModel, collectionIds, responseStyle } = req.body;

    if (!question || typeof question !== 'string') {
      res.status(400).json({ error: 'question is required' });
      return;
    }
    if (!testModel || typeof testModel !== 'string') {
      res.status(400).json({ error: 'testModel is required (e.g., us.anthropic.claude-sonnet-4-6-20250514-v1:0)' });
      return;
    }
    if (testModel === BEDROCK_GENERATION_MODEL) {
      res.status(400).json({ error: 'testModel must differ from baseline model' });
      return;
    }

    const result = await runABTest(question, testModel, { collectionIds, responseStyle });
    res.json(result);
  } catch (err: any) {
    logger.error('A/B test failed', { error: err.message });
    res.status(500).json({ error: 'A/B test failed', message: err.message?.substring(0, 200) });
  }
});

/**
 * POST /api/ab-tests/batch
 * Run multiple questions through both models.
 */
router.post('/batch', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { questions, testModel, collectionIds, responseStyle } = req.body;

    if (!Array.isArray(questions) || questions.length === 0) {
      res.status(400).json({ error: 'questions array is required' });
      return;
    }
    if (questions.length > 20) {
      res.status(400).json({ error: 'Maximum 20 questions per batch' });
      return;
    }
    if (!testModel || typeof testModel !== 'string') {
      res.status(400).json({ error: 'testModel is required' });
      return;
    }

    // Run tests sequentially to avoid overwhelming Bedrock rate limits
    const results = [];
    for (const question of questions) {
      if (typeof question !== 'string' || question.trim().length === 0) continue;
      try {
        const result = await runABTest(question, testModel, { collectionIds, responseStyle });
        results.push(result);
      } catch (err: any) {
        results.push({
          id: 'error',
          question,
          status: 'failed',
          error: err.message?.substring(0, 200),
        });
      }
    }

    res.json({ batchSize: results.length, results });
  } catch (err: any) {
    logger.error('A/B batch test failed', { error: err.message });
    res.status(500).json({ error: 'Batch test failed' });
  }
});

/**
 * GET /api/ab-tests
 * List all stored A/B test results.
 */
router.get('/', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  const results = getTestResults();
  res.json({
    total: results.length,
    baselineModel: BEDROCK_GENERATION_MODEL,
    results: results.slice(-50), // Last 50
  });
});

/**
 * GET /api/ab-tests/stats
 * Aggregate statistics with Welch's t-test significance.
 */
router.get('/stats', authenticate, requireAdmin, (req: AuthRequest, res: Response): void => {
  const modelFilter = req.query.model as string | undefined;
  const stats = computeAggregateStats(modelFilter);

  if (!stats) {
    res.json({
      message: 'Not enough completed tests for statistics (need at least 2)',
      testCount: getTestResults().filter(t => t.status === 'completed').length,
    });
    return;
  }

  res.json(stats);
});

export default router;
