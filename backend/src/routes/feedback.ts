import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { saveFeedback, appendToFeedbackIndex, getFeedbackByDate } from '../services/feedback';
import { logRagFeedback } from '../services/ragTrace';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';

const router = Router();

// Submit feedback/flag for a response
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question, answer, patientName, transactionNumber, notes, sources, traceId, feedbackType } = req.body;

    if (!question || !answer) {
      res.status(400).json({ error: 'Question and answer are required' });
      return;
    }

    const entry = await saveFeedback(req.user!.id, req.user!.username, {
      question,
      answer,
      patientName: patientName || undefined,
      transactionNumber: transactionNumber || undefined,
      notes: notes || undefined,
      sources: sources || [],
    });

    // Also add to daily index for easy admin listing
    await appendToFeedbackIndex(entry);

    // If traceId is provided, also log to rag_feedback for observability
    if (traceId) {
      logRagFeedback({
        traceId,
        feedbackType: feedbackType || 'thumbs_down',
        notes: notes || undefined,
        userId: req.user!.id,
        username: req.user!.username,
      }).catch(err => logger.warn('Fire-and-forget operation failed', { error: String(err) }));
    }

    await logAuditEvent(req.user!.id, req.user!.username, 'feedback', {
      feedbackId: entry.id,
      hasPatientName: !!patientName,
      hasTransactionNumber: !!transactionNumber,
      traceId: traceId || undefined,
    });

    res.status(201).json({ id: entry.id, message: 'Feedback submitted successfully' });
  } catch (error) {
    logger.error('Feedback submission failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Submit thumbs up/down feedback linked to a trace
router.post('/trace', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { traceId, feedbackType, notes } = req.body;

    if (!traceId || !feedbackType) {
      res.status(400).json({ error: 'traceId and feedbackType are required' });
      return;
    }

    if (!['thumbs_up', 'thumbs_down'].includes(feedbackType)) {
      res.status(400).json({ error: 'feedbackType must be thumbs_up or thumbs_down' });
      return;
    }

    const entry = await logRagFeedback({
      traceId,
      feedbackType,
      notes: notes || undefined,
      userId: req.user!.id,
      username: req.user!.username,
    });

    res.status(201).json({ feedbackId: entry.feedbackId });
  } catch (error) {
    logger.error('Trace feedback submission failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

// Also log rag_feedback when existing flag feedback includes a traceId
// (handled by the existing POST / endpoint — the traceId is passed through)

// List feedback for a date (admin only)
router.get('/:date', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    if (req.user!.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' });
      return;
    }

    const entries = await getFeedbackByDate(req.params.date);
    res.json({ entries });
  } catch (error) {
    logger.error('Failed to list feedback', { error: String(error) });
    res.status(500).json({ error: 'Failed to list feedback' });
  }
});

export default router;
