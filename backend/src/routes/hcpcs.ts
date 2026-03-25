import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { searchHcpcs, getHcpcsCode, getHcpcsByCategory, listCategories } from '../services/hcpcsLookup';

const router = Router();

// Search HCPCS codes by code or description
router.get('/search', authenticate, (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    res.status(400).json({ error: 'Query parameter "q" is required' });
    return;
  }
  const results = searchHcpcs(q);
  res.json({ query: q, count: results.length, results });
});

// Exact HCPCS code lookup
router.get('/code/:code', authenticate, (req: AuthRequest, res: Response) => {
  const code = getHcpcsCode(req.params.code);
  if (!code) {
    res.status(404).json({ error: `HCPCS code ${req.params.code} not found` });
    return;
  }
  res.json({ code });
});

// List all categories
router.get('/categories', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ categories: listCategories() });
});

// Get codes by category
router.get('/category/:category', authenticate, (req: AuthRequest, res: Response) => {
  const results = getHcpcsByCategory(req.params.category);
  res.json({ category: req.params.category, count: results.length, results });
});

export default router;
