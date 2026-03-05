import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { getQueryLog, queryLogToCsv, flushQueryLog } from '../services/queryLog';
import { buildFaqDashboard } from '../services/faqAnalytics';
import { getFeedbackByDate } from '../services/feedback';
import { logger } from '../utils/logger';

const router = Router();

// FAQ analytics dashboard (admin only)
router.get('/faq/dashboard', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const startDate = req.query.start as string | undefined;
    const endDate = req.query.end as string | undefined;

    // Validate date formats if provided
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !datePattern.test(startDate)) {
      res.status(400).json({ error: 'start must be in YYYY-MM-DD format' });
      return;
    }
    if (endDate && !datePattern.test(endDate)) {
      res.status(400).json({ error: 'end must be in YYYY-MM-DD format' });
      return;
    }

    const dashboard = await buildFaqDashboard(startDate, endDate);
    res.json(dashboard);
  } catch (error) {
    logger.error('Failed to build FAQ dashboard', { error: String(error) });
    res.status(500).json({ error: 'Failed to build FAQ dashboard' });
  }
});

// Answer quality metrics dashboard (admin only)
router.get('/quality/metrics', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const today = new Date();
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      dates.push(d.toISOString().split('T')[0]);
    }

    // Gather query logs and feedback across the date range
    let totalQueries = 0;
    let totalFlagged = 0;
    const confidenceCounts = { high: 0, partial: 0, low: 0 };
    const unansweredQuestions: Array<{ question: string; date: string }> = [];
    const dailyStats: Array<{ date: string; queries: number; flagged: number; highPct: number }> = [];

    for (const date of dates) {
      await flushQueryLog();
      const logs = await getQueryLog(date);
      const feedback = await getFeedbackByDate(date);

      totalQueries += logs.length;
      totalFlagged += feedback.length;

      let dayHigh = 0;
      for (const log of logs) {
        confidenceCounts[log.confidence]++;
        if (log.confidence === 'high') dayHigh++;
        if (log.confidence === 'low') {
          unansweredQuestions.push({ question: log.question, date });
        }
      }

      dailyStats.push({
        date,
        queries: logs.length,
        flagged: feedback.length,
        highPct: logs.length > 0 ? Math.round((dayHigh / logs.length) * 100) : 0,
      });
    }

    const qualityScore = totalQueries > 0
      ? Math.round(((confidenceCounts.high + confidenceCounts.partial * 0.5) / totalQueries) * 100)
      : 0;

    res.json({
      period: { start: dates[dates.length - 1], end: dates[0], days },
      totalQueries,
      totalFlagged,
      confidenceCounts,
      qualityScore,
      unansweredQuestions: unansweredQuestions.slice(0, 20),
      dailyStats: dailyStats.reverse(),
    });
  } catch (error) {
    logger.error('Failed to build quality metrics', { error: String(error) });
    res.status(500).json({ error: 'Failed to build quality metrics' });
  }
});

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
