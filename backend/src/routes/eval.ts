/**
 * Eval Routes — expose metadata about the gold-standard RAG evaluation dataset.
 *
 * Read-only endpoints for the admin dashboard to preview the dataset
 * without shipping the JSON as a build-time import.
 */

import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { loadGoldStandard } from '../evalData/loader';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/eval/dataset — full gold-standard dataset (admin only).
 * The file is already committed to the repo and non-sensitive, but the
 * endpoint is admin-gated so casual users can't enumerate internal policy
 * coverage via /api routes.
 */
router.get('/dataset', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  try {
    const dataset = loadGoldStandard();
    // Categories summary for dashboard cards
    const byCategory = new Map<string, number>();
    for (const p of dataset.pairs) {
      byCategory.set(p.category, (byCategory.get(p.category) || 0) + 1);
    }
    res.json({
      version: dataset.version,
      description: dataset.description,
      lastUpdated: dataset.lastUpdated,
      totalPairs: dataset.pairs.length,
      categories: Array.from(byCategory.entries()).map(([name, count]) => ({ name, count })),
      pairs: dataset.pairs,
    });
  } catch (err) {
    logger.error('Failed to load gold-standard dataset', { error: String(err) });
    res.status(500).json({ error: 'Failed to load dataset' });
  }
});

export default router;
