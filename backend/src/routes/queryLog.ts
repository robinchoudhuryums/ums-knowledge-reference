import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { getQueryLog, queryLogToCsv, flushQueryLog } from '../services/queryLog';
import { buildFaqDashboard } from '../services/faqAnalytics';
import { getFeedbackByDate } from '../services/feedback';
import { getObservabilityMetrics } from '../services/ragTrace';
import { logger } from '../utils/logger';

const router = Router();

// RAG observability metrics (admin only)
router.get('/observability/metrics', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const days = parseInt(req.query.days as string) || 7;
    const metrics = await getObservabilityMetrics(days);
    res.json(metrics);
  } catch (error) {
    logger.error('Failed to build observability metrics', { error: String(error) });
    res.status(500).json({ error: 'Failed to build observability metrics' });
  }
});

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

// --- Audit Log Export (admin only) ---

/**
 * GET /api/query-log/audit/:date/json — Export audit log entries for a date as JSON.
 * GET /api/query-log/audit/:startDate/:endDate/json — Export audit log range.
 */
router.get('/audit/:date/json', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
      return;
    }

    const { getAuditLogs } = await import('../services/audit');
    const entries = await getAuditLogs(date);
    res.json({ date, count: entries.length, entries });
  } catch (error) {
    logger.error('Failed to export audit log', { error: String(error) });
    res.status(500).json({ error: 'Failed to export audit log' });
  }
});

router.get('/audit/:startDate/:endDate/json', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { startDate, endDate } = req.params;
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!datePattern.test(startDate) || !datePattern.test(endDate)) {
      res.status(400).json({ error: 'Dates must be in YYYY-MM-DD format' });
      return;
    }

    const { getAuditLogs } = await import('../services/audit');
    const allEntries = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateKey = d.toISOString().split('T')[0];
      const entries = await getAuditLogs(dateKey);
      allEntries.push(...entries);
    }

    res.json({ startDate, endDate, count: allEntries.length, entries: allEntries });
  } catch (error) {
    logger.error('Failed to export audit log range', { error: String(error) });
    res.status(500).json({ error: 'Failed to export audit log range' });
  }
});

// --- Audit Chain Integrity Verification (admin only) ---

/**
 * GET /api/query-log/audit/:date/verify — Verify audit log hash chain integrity for a date.
 */
router.get('/audit/:date/verify', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
      return;
    }

    const { verifyAuditChain } = await import('../services/audit');
    const result = await verifyAuditChain(date);
    res.json({ date, ...result });
  } catch (error) {
    logger.error('Failed to verify audit chain', { error: String(error) });
    res.status(500).json({ error: 'Failed to verify audit chain' });
  }
});

export default router;
