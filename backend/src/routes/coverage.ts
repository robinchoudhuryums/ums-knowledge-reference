import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getChecklist, searchChecklists, listAvailableChecklists, validateDocumentation } from '../services/coverageChecklists';

const router = Router();

// Get coverage checklist for a HCPCS code
router.get('/checklist/:hcpcsCode', authenticate, (req: AuthRequest, res: Response) => {
  const checklist = getChecklist(req.params.hcpcsCode);
  if (!checklist) {
    res.status(404).json({ error: `No coverage checklist found for ${req.params.hcpcsCode}` });
    return;
  }
  res.json({ checklist });
});

// Search checklists
router.get('/search', authenticate, (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    res.status(400).json({ error: 'Query parameter "q" is required' });
    return;
  }
  const results = searchChecklists(q);
  res.json({ query: q, count: results.length, results });
});

// List all available checklists
router.get('/list', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ checklists: listAvailableChecklists() });
});

// Validate documentation completeness
router.post('/validate', authenticate, (req: AuthRequest, res: Response) => {
  const { hcpcsCode, completedItems } = req.body;
  if (!hcpcsCode || !Array.isArray(completedItems)) {
    res.status(400).json({ error: 'hcpcsCode and completedItems[] are required' });
    return;
  }
  const result = validateDocumentation(hcpcsCode, completedItems);
  if (!result) {
    res.status(404).json({ error: `No coverage checklist found for ${hcpcsCode}` });
    return;
  }
  res.json({ hcpcsCode, ...result });
});

export default router;
