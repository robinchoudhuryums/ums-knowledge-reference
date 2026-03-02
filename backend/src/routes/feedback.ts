import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { saveFeedback, appendToFeedbackIndex, getFeedbackByDate } from '../services/feedback';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';

const router = Router();

// Submit feedback/flag for a response
router.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { question, answer, patientName, transactionNumber, notes, sources } = req.body;

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

    await logAuditEvent(req.user!.id, req.user!.username, 'feedback', {
      feedbackId: entry.id,
      hasPatientName: !!patientName,
      hasTransactionNumber: !!transactionNumber,
    });

    res.status(201).json({ id: entry.id, message: 'Feedback submitted successfully' });
  } catch (error) {
    logger.error('Feedback submission failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to submit feedback' });
  }
});

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
