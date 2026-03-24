import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// Receive client-side error reports
router.post('/report', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { message, stack, componentName, url, userAgent } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message is required and must be a string' });
      return;
    }

    if (message.length > 5000) {
      res.status(400).json({ error: 'message must be 5000 characters or fewer' });
      return;
    }

    if (stack && (typeof stack !== 'string' || stack.length > 10000)) {
      res.status(400).json({ error: 'stack must be a string of 10000 characters or fewer' });
      return;
    }

    logger.error('Client error report', {
      userId: req.user!.id,
      username: req.user!.username,
      message,
      componentName: componentName || undefined,
      url: url || undefined,
      userAgent: userAgent || undefined,
      stack: stack || undefined,
    });

    res.status(201).json({ received: true });
  } catch (error) {
    logger.error('Failed to process client error report', { error: String(error) });
    res.status(500).json({ error: 'Failed to process error report' });
  }
});

export default router;
