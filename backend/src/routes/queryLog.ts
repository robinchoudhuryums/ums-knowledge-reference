import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { getQueryLog, queryLogToCsv, flushQueryLog } from '../services/queryLog';
import { logger } from '../utils/logger';

const router = Router();

// Get query log entries for a given date (admin only)
router.get('/:date', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.params;
    // Validate date format YYYY-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
      return;
    }

    // Flush in-memory buffer before reading so we get the latest entries
    await flushQueryLog();
    const entries = await getQueryLog(date);
    res.json({ date, count: entries.length, entries });
  } catch (error) {
    logger.error('Failed to get query log', { error: String(error) });
    res.status(500).json({ error: 'Failed to get query log' });
  }
});

// Download query log as CSV for a given date (admin only)
router.get('/:date/csv', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
      return;
    }

    await flushQueryLog();
    const entries = await getQueryLog(date);
    const csv = queryLogToCsv(entries);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="query-log-${date}.csv"`);
    res.send(csv);
  } catch (error) {
    logger.error('Failed to export query log CSV', { error: String(error) });
    res.status(500).json({ error: 'Failed to export query log' });
  }
});

export default router;
