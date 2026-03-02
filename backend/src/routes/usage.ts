import { Router, Response } from 'express';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import { getUsageStats, getLimits, setLimits } from '../services/usage';
import { logger } from '../utils/logger';

const router = Router();

// Get usage stats (admin sees all users, regular users see their own)
router.get('/stats', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const stats = await getUsageStats();

    if (req.user!.role === 'admin') {
      res.json(stats);
    } else {
      // Regular users only see their own usage
      const userUsage = stats.today.users[req.user!.id];
      res.json({
        today: {
          queryCount: userUsage?.queryCount || 0,
          lastQuery: userUsage?.lastQuery || null,
        },
        limits: {
          dailyPerUser: stats.limits.dailyPerUser,
        },
      });
    }
  } catch (error) {
    logger.error('Failed to get usage stats', { error: String(error) });
    res.status(500).json({ error: 'Failed to get usage stats' });
  }
});

// Update usage limits (admin only)
router.put('/limits', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const { dailyPerUser, dailyTotal, monthlyTotal } = req.body;
    const current = await getLimits();

    const updated = {
      dailyPerUser: typeof dailyPerUser === 'number' ? dailyPerUser : current.dailyPerUser,
      dailyTotal: typeof dailyTotal === 'number' ? dailyTotal : current.dailyTotal,
      monthlyTotal: typeof monthlyTotal === 'number' ? monthlyTotal : current.monthlyTotal,
    };

    await setLimits(updated);
    res.json({ limits: updated });
  } catch (error) {
    logger.error('Failed to update limits', { error: String(error) });
    res.status(500).json({ error: 'Failed to update limits' });
  }
});

export default router;
