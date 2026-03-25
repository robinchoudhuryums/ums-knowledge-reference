import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getHcpcsForDiagnosis, getDiagnosesForHcpcs, searchDiagnoses, listIcd10Categories } from '../services/icd10Mapping';

const router = Router();

// Get HCPCS codes justified by an ICD-10 diagnosis
router.get('/for-diagnosis/:code', authenticate, (req: AuthRequest, res: Response) => {
  const mappings = getHcpcsForDiagnosis(req.params.code);
  res.json({ icd10Code: req.params.code, count: mappings.length, mappings });
});

// Get ICD-10 codes that justify a HCPCS code
router.get('/for-hcpcs/:code', authenticate, (req: AuthRequest, res: Response) => {
  const mappings = getDiagnosesForHcpcs(req.params.code);
  res.json({ hcpcsCode: req.params.code, count: mappings.length, mappings });
});

// Search ICD-10 codes
router.get('/search', authenticate, (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) {
    res.status(400).json({ error: 'Query parameter "q" is required' });
    return;
  }
  const results = searchDiagnoses(q);
  res.json({ query: q, count: results.length, results });
});

// List ICD-10 categories
router.get('/categories', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ categories: listIcd10Categories() });
});

export default router;
