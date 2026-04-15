/**
 * Form Drafts Routes — partial save / resume / discard for PPD, PMD Account,
 * and PAP Account forms.
 *
 *   POST   /api/form-drafts                    upsert a draft
 *   GET    /api/form-drafts                    list my drafts (optional ?formType=)
 *   GET    /api/form-drafts/:formType/:id      load a specific draft
 *   DELETE /api/form-drafts/:formType/:id      discard ("start over")
 */

import { Router, Response } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, AuthRequest } from '../middleware/auth';
import { logger } from '../utils/logger';
import {
  upsertDraft,
  getDraft,
  listDrafts,
  discardDraft,
  isValidFormType,
  FormType,
} from '../services/formDrafts';

const router = Router();

// Generous limit — clients are expected to auto-save every few questions.
// 240/15min ≈ 16/min sustained, comfortably above a human pace.
const draftLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 240,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip || 'unknown',
  message: { error: 'Too many draft saves. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const MAX_LABEL_LEN = 200;

/**
 * POST /api/form-drafts — upsert (create or update) a draft
 * Body: { id?, formType, payload, label?, formVersion?, completionPercent? }
 */
router.post('/', authenticate, draftLimiter, async (req: AuthRequest, res: Response): Promise<void> => {
  const { id, formType, payload, label, formVersion, completionPercent } = req.body as {
    id?: string;
    formType?: unknown;
    payload?: unknown;
    label?: unknown;
    formVersion?: unknown;
    completionPercent?: unknown;
  };

  if (!isValidFormType(formType)) {
    res.status(400).json({ error: 'formType must be one of: ppd, pmd-account, pap-account' });
    return;
  }
  if (payload === undefined) {
    res.status(400).json({ error: 'payload is required' });
    return;
  }
  if (label !== undefined && (typeof label !== 'string' || label.length > MAX_LABEL_LEN)) {
    res.status(400).json({ error: `label must be a string under ${MAX_LABEL_LEN} chars` });
    return;
  }
  if (formVersion !== undefined && typeof formVersion !== 'string') {
    res.status(400).json({ error: 'formVersion must be a string' });
    return;
  }
  if (completionPercent !== undefined) {
    if (typeof completionPercent !== 'number' || completionPercent < 0 || completionPercent > 100 || !Number.isFinite(completionPercent)) {
      res.status(400).json({ error: 'completionPercent must be a number between 0 and 100' });
      return;
    }
  }
  if (id !== undefined && (typeof id !== 'string' || id.length > 100)) {
    res.status(400).json({ error: 'id must be a string under 100 chars' });
    return;
  }

  try {
    const record = await upsertDraft({
      id,
      formType: formType as FormType,
      payload,
      label: typeof label === 'string' ? label : undefined,
      formVersion: typeof formVersion === 'string' ? formVersion : undefined,
      completionPercent: typeof completionPercent === 'number' ? completionPercent : undefined,
      userId: req.user!.id,
    });
    res.status(id ? 200 : 201).json({ draft: record });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('exceeds')) {
      res.status(413).json({ error: msg });
      return;
    }
    logger.error('Failed to upsert form draft', { error: msg });
    res.status(500).json({ error: 'Failed to save draft' });
  }
});

/**
 * GET /api/form-drafts — list my drafts (admins see all with ?all=1)
 */
router.get('/', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const formTypeRaw = req.query.formType;
  const adminView = req.user!.role === 'admin' && req.query.all === '1';

  let formType: FormType | undefined;
  if (formTypeRaw !== undefined) {
    if (!isValidFormType(formTypeRaw)) {
      res.status(400).json({ error: 'formType must be one of: ppd, pmd-account, pap-account' });
      return;
    }
    formType = formTypeRaw;
  }

  try {
    const drafts = await listDrafts({
      userId: req.user!.id,
      adminView,
      formType,
    });
    res.json({ drafts, total: drafts.length });
  } catch (err) {
    logger.error('Failed to list form drafts', { error: String(err) });
    res.status(500).json({ error: 'Failed to list drafts' });
  }
});

/**
 * GET /api/form-drafts/:formType/:id — load a draft
 */
router.get('/:formType/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { formType, id } = req.params;
  if (!isValidFormType(formType)) {
    res.status(400).json({ error: 'formType must be one of: ppd, pmd-account, pap-account' });
    return;
  }

  try {
    const record = await getDraft(req.user!.id, formType, id);
    if (!record) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    // Only the owner (or admins) can load a draft. Drafts can contain PHI.
    if (record.createdBy !== req.user!.id && req.user!.role !== 'admin') {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }
    res.json({ draft: record });
  } catch (err) {
    logger.error('Failed to load form draft', { error: String(err), id });
    res.status(500).json({ error: 'Failed to load draft' });
  }
});

/**
 * DELETE /api/form-drafts/:formType/:id — discard a draft (start over)
 */
router.delete('/:formType/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { formType, id } = req.params;
  if (!isValidFormType(formType)) {
    res.status(400).json({ error: 'formType must be one of: ppd, pmd-account, pap-account' });
    return;
  }

  try {
    const removed = await discardDraft(req.user!.id, formType, id);
    res.json({ removed });
  } catch (err) {
    logger.error('Failed to discard form draft', { error: String(err), id });
    res.status(500).json({ error: 'Failed to discard draft' });
  }
});

export default router;
