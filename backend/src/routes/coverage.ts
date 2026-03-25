import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getChecklist, searchChecklists, listAvailableChecklists, validateDocumentation } from '../services/coverageChecklists';
import { logger } from '../utils/logger';

const router = Router();

// Get coverage checklist for a HCPCS code
router.get('/checklist/:hcpcsCode', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const checklist = getChecklist(req.params.hcpcsCode);
    if (!checklist) {
      res.status(404).json({ error: `No coverage checklist found for HCPCS code ${req.params.hcpcsCode}` });
      return;
    }
    res.json({ checklist });
  } catch (error) {
    logger.error('Failed to get coverage checklist', { error: String(error) });
    res.status(500).json({ error: 'Failed to get coverage checklist' });
  }
});

// Search checklists by code, description, or LCD number
router.get('/search', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const q = (req.query.q as string || '').trim();
    if (!q) {
      res.status(400).json({ error: 'Query parameter "q" is required' });
      return;
    }
    const results = searchChecklists(q);
    res.json({ query: q, count: results.length, results });
  } catch (error) {
    logger.error('Failed to search checklists', { error: String(error) });
    res.status(500).json({ error: 'Failed to search checklists' });
  }
});

// List all available checklists
router.get('/list', authenticate, (_req: AuthRequest, res: Response) => {
  try {
    res.json({ checklists: listAvailableChecklists() });
  } catch (error) {
    logger.error('Failed to list checklists', { error: String(error) });
    res.status(500).json({ error: 'Failed to list checklists' });
  }
});

// Validate documentation completeness
router.post('/validate', authenticate, (req: AuthRequest, res: Response) => {
  try {
    const { hcpcsCode, completedItems } = req.body;
    if (!hcpcsCode || !Array.isArray(completedItems)) {
      res.status(400).json({ error: 'hcpcsCode (string) and completedItems (string[]) are required' });
      return;
    }
    const result = validateDocumentation(hcpcsCode, completedItems);
    if (!result) {
      res.status(404).json({ error: `No coverage checklist found for HCPCS code ${hcpcsCode}` });
      return;
    }
    res.json({ hcpcsCode, ...result });
  } catch (error) {
    logger.error('Failed to validate documentation', { error: String(error) });
    res.status(500).json({ error: 'Failed to validate documentation' });
  }
});

export default router;
