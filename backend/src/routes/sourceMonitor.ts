import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, requireAdmin, AuthRequest } from '../middleware/auth';
import {
  getMonitoredSources,
  addMonitoredSource,
  updateMonitoredSource,
  removeMonitoredSource,
  forceCheckSource,
  checkAllDueSources,
} from '../services/sourceMonitor';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';

const router = Router();

// Rate limit admin write operations to prevent accidental or abusive bulk actions.
// Force-check and seed operations are expensive (external HTTP calls).
const adminWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip || 'unknown',
  message: { error: 'Too many source monitor requests. Please wait before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// List all monitored sources
router.get('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const sources = await getMonitoredSources();
    res.json({ sources });
  } catch (error) {
    logger.error('Failed to list monitored sources', { error: String(error) });
    res.status(500).json({ error: 'Failed to list monitored sources' });
  }
});

// Add a new monitored source
router.post('/', authenticate, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { name, url, collectionId, checkIntervalHours, fileType, category } = req.body;

    if (!name || !url || !collectionId) {
      res.status(400).json({ error: 'name, url, and collectionId are required' });
      return;
    }

    // Basic URL validation
    try {
      new URL(url);
    } catch {
      res.status(400).json({ error: 'Invalid URL format' });
      return;
    }

    const source = await addMonitoredSource({
      name,
      url,
      collectionId,
      checkIntervalHours,
      fileType,
      category,
      createdBy: req.user!.username,
    });

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      action: 'source_monitor_add',
      sourceId: source.id,
      name: source.name,
      url: source.url,
    });

    res.status(201).json({ source });
  } catch (error: unknown) {
    if ((error as Error).message?.includes('already being monitored')) {
      res.status(409).json({ error: (error as Error).message });
      return;
    }
    logger.error('Failed to add monitored source', { error: String(error) });
    res.status(500).json({ error: 'Failed to add monitored source' });
  }
});

// Update a monitored source
router.put('/:id', authenticate, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { name, url, collectionId, checkIntervalHours, fileType, enabled, category } = req.body;

    const source = await updateMonitoredSource(req.params.id, {
      name,
      url,
      collectionId,
      checkIntervalHours,
      fileType,
      enabled,
      category,
    });

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      action: 'source_monitor_update',
      sourceId: source.id,
      name: source.name,
    });

    res.json({ source });
  } catch (error: unknown) {
    if ((error as Error).message?.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    logger.error('Failed to update monitored source', { error: String(error) });
    res.status(500).json({ error: 'Failed to update monitored source' });
  }
});

// Delete a monitored source
router.delete('/:id', authenticate, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    await removeMonitoredSource(req.params.id);

    await logAuditEvent(req.user!.id, req.user!.username, 'delete', {
      action: 'source_monitor_remove',
      sourceId: req.params.id,
    });

    res.json({ message: 'Monitored source removed' });
  } catch (error: unknown) {
    if ((error as Error).message?.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    logger.error('Failed to remove monitored source', { error: String(error) });
    res.status(500).json({ error: 'Failed to remove monitored source' });
  }
});

// Force-check a single source now (regardless of interval)
router.post('/:id/check', authenticate, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const result = await forceCheckSource(req.params.id);

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      action: 'source_monitor_force_check',
      sourceId: req.params.id,
      changed: result.changed,
      ingested: result.ingested,
    });

    res.json(result);
  } catch (error: unknown) {
    if ((error as Error).message?.includes('not found')) {
      res.status(404).json({ error: (error as Error).message });
      return;
    }
    logger.error('Force check failed', { error: String(error) });
    res.status(500).json({ error: 'Source check failed' });
  }
});

// Check all due sources now
router.post('/check-all', authenticate, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const result = await checkAllDueSources();

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      action: 'source_monitor_check_all',
      checked: result.checked,
      changed: result.changed,
      ingested: result.ingested,
      errors: result.errors,
    });

    res.json(result);
  } catch (error) {
    logger.error('Check all sources failed', { error: String(error) });
    res.status(500).json({ error: 'Source check failed' });
  }
});

// ─── Seed LCD Sources ─────────────────────────────────────────────────
// Pre-configured list of CMS LCD URLs for DME coverage policies.
// POST /api/sources/seed-lcds creates an "LCD Policies" collection (if needed)
// and registers all LCD sources for automated monitoring.

const LCD_SOURCES = [
  { name: 'LCD L33797 — Oxygen & Oxygen Equipment', lcdId: '33797' },
  { name: 'LCD L33718 — CPAP/RAD', lcdId: '33718' },
  { name: 'LCD L33895 — Hospital Beds', lcdId: '33895' },
  { name: 'LCD L33693 — Support Surfaces', lcdId: '33693' },
  { name: 'LCD L33789 — Power Mobility Devices', lcdId: '33789' },
  { name: 'LCD L33831 — Enteral Nutrition', lcdId: '33831' },
  { name: 'LCD L33829 — Pneumatic Compression', lcdId: '33829' },
  { name: 'LCD L33791 — Walking Devices & Accessories', lcdId: '33791' },
];

router.post('/seed-lcds', authenticate, requireAdmin, adminWriteLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { getCollectionsIndex, saveCollectionsIndex } = await import('../services/s3Storage');
    const { v4: uuidv4 } = await import('uuid');

    // 1. Find or create "LCD Policies" collection
    const collections = await getCollectionsIndex();
    let lcdCollection = collections.find(c => c.name === 'LCD Policies');
    if (!lcdCollection) {
      lcdCollection = {
        id: uuidv4(),
        name: 'LCD Policies',
        description: 'CMS Local Coverage Determinations for DME — auto-monitored for changes',
        createdBy: req.user!.username,
        createdAt: new Date().toISOString(),
        documentCount: 0,
      };
      collections.push(lcdCollection);
      await saveCollectionsIndex(collections);
      logger.info('Created LCD Policies collection', { id: lcdCollection.id });
    }

    // 2. Get existing sources to avoid duplicates
    const existingSources = await getMonitoredSources();
    const existingUrls = new Set(existingSources.map(s => s.url));

    // 3. Add each LCD source
    const added: string[] = [];
    const skipped: string[] = [];

    for (const lcd of LCD_SOURCES) {
      const url = `https://www.cms.gov/medicare-coverage-database/view/lcd.aspx?lcdid=${lcd.lcdId}`;
      if (existingUrls.has(url)) {
        skipped.push(lcd.name);
        continue;
      }

      try {
        await addMonitoredSource({
          name: lcd.name,
          url,
          collectionId: lcdCollection.id,
          checkIntervalHours: 168, // Weekly
          fileType: 'html',
          category: 'LCD',
          createdBy: req.user!.username,
        });
        added.push(lcd.name);
      } catch (err: unknown) {
        // Skip duplicates silently, log other errors
        if (!(err as Error).message?.includes('already being monitored')) {
          logger.error('Failed to add LCD source', { name: lcd.name, error: String(err) });
        }
        skipped.push(lcd.name);
      }
    }

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      action: 'seed_lcd_sources',
      added: added.length,
      skipped: skipped.length,
      collectionId: lcdCollection.id,
    });

    res.json({
      message: `Seeded ${added.length} LCD sources (${skipped.length} already existed)`,
      collectionId: lcdCollection.id,
      collectionName: 'LCD Policies',
      added,
      skipped,
    });
  } catch (error) {
    logger.error('Failed to seed LCD sources', { error: String(error) });
    res.status(500).json({ error: 'Failed to seed LCD sources' });
  }
});

export default router;
