import { Router, Response } from 'express';
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
router.post('/', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
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
  } catch (error: any) {
    if (error.message?.includes('already being monitored')) {
      res.status(409).json({ error: error.message });
      return;
    }
    logger.error('Failed to add monitored source', { error: String(error) });
    res.status(500).json({ error: 'Failed to add monitored source' });
  }
});

// Update a monitored source
router.put('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
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
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    logger.error('Failed to update monitored source', { error: String(error) });
    res.status(500).json({ error: 'Failed to update monitored source' });
  }
});

// Delete a monitored source
router.delete('/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    await removeMonitoredSource(req.params.id);

    await logAuditEvent(req.user!.id, req.user!.username, 'delete', {
      action: 'source_monitor_remove',
      sourceId: req.params.id,
    });

    res.json({ message: 'Monitored source removed' });
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    logger.error('Failed to remove monitored source', { error: String(error) });
    res.status(500).json({ error: 'Failed to remove monitored source' });
  }
});

// Force-check a single source now (regardless of interval)
router.post('/:id/check', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const result = await forceCheckSource(req.params.id);

    await logAuditEvent(req.user!.id, req.user!.username, 'upload', {
      action: 'source_monitor_force_check',
      sourceId: req.params.id,
      changed: result.changed,
      ingested: result.ingested,
    });

    res.json(result);
  } catch (error: any) {
    if (error.message?.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    logger.error('Force check failed', { error: String(error) });
    res.status(500).json({ error: 'Source check failed' });
  }
});

// Check all due sources now
router.post('/check-all', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
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

export default router;
