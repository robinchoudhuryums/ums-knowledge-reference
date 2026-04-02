import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getAccountCreationQuestions, getAccountCreationGroups, AccountCreationResponse, validateAccountCreationResponses } from '../services/accountCreation';
import { logAuditEvent } from '../services/audit';
import { sendEmail, isEmailConfigured } from '../services/emailService';
import { readInsuranceCard, compareInsuranceFields } from '../services/insuranceCardReader';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/htmlEscape';
import rateLimit from 'express-rate-limit';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip || 'unknown',
  message: { error: 'Too many submissions. Please wait before submitting again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

// Get the account creation questionnaire
router.get('/questions', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({
    questions: getAccountCreationQuestions(),
    groups: getAccountCreationGroups(),
  });
});

// Submit account creation form and optionally email it
router.post('/submit', authenticate, submitLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { patientName, dob, responses, sendTo } = req.body as {
      patientName: string;
      dob?: string;
      responses: AccountCreationResponse[];
      sendTo?: string; // email address or empty
    };

    if (!patientName || !responses || !Array.isArray(responses)) {
      res.status(400).json({ error: 'patientName and responses[] are required' });
      return;
    }

    // Server-side validation of required fields
    const validation = validateAccountCreationResponses(responses);
    if (!validation.valid) {
      logger.warn('Account creation submitted with missing required fields', {
        userId: req.user!.id,
        missingCount: validation.missingRequired.length,
        missingIds: validation.missingRequired,
      });
      // Log but don't block — agents may submit partial forms intentionally
    }

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      action: 'account_creation_submitted',
      patientName,
      responseCount: responses.length,
    });

    // If sendTo is provided and email is configured, send it
    if (sendTo && isEmailConfigured()) {
      // Validate email format and reject control characters (header injection prevention)
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
      if (/[\x00-\x1F\x7F\r\n]/.test(sendTo) || !emailRegex.test(sendTo)) {
        res.status(400).json({ error: 'Invalid email address format' });
        return;
      }
      const html = buildAccountCreationHtml(patientName, dob || '', responses);
      const emailResult = await sendEmail({
        to: sendTo,
        subject: `PMD Account Creation for ${patientName.replace(/[\r\n]/g, '')} ${(dob || '').replace(/[\r\n]/g, '')}`.trim(),
        html,
        bcc: process.env.PMD_BCC_EMAIL || process.env.PPD_BCC_EMAIL,
      });

      if (!emailResult.success) {
        logger.error('Account creation email failed', { error: emailResult.error, to: sendTo });
        res.status(500).json({ error: 'Failed to send email. Please try again.' });
        return;
      }

      await logAuditEvent(req.user!.id, req.user!.username, 'query', {
        action: 'account_creation_emailed',
        patientName,
        to: sendTo,
        messageId: emailResult.messageId,
      });

      res.json({ success: true, emailed: true, messageId: emailResult.messageId });
    } else {
      res.json({ success: true, emailed: false });
    }
  } catch (error) {
    logger.error('Account creation submission failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to process account creation form' });
  }
});

function buildAccountCreationHtml(
  patientName: string,
  dob: string,
  responses: AccountCreationResponse[],
): string {
  const questions = getAccountCreationQuestions();
  const groups = getAccountCreationGroups();
  const headerColor = '#223b5d';

  const getAnswer = (qId: string): string => {
    const r = responses.find(r => r.questionId === qId);
    if (!r || r.answer === null || r.answer === undefined) return '';
    return String(r.answer);
  };

  let rows = '';
  for (const group of groups) {
    rows += `<tr><td colspan="2" style="height:12px;"></td></tr>`;
    rows += `<tr style="background:${headerColor};"><td colspan="2" style="padding:10px;border:1px solid #ccc;text-align:center;font-weight:bold;color:#ffffff;">${escapeHtml(group)}</td></tr>`;

    const groupQuestions = questions.filter(q => q.group === group);
    let rowIdx = 0;
    for (const q of groupQuestions) {
      const answer = getAnswer(q.id);
      const bg = rowIdx % 2 === 0 ? '#ffffff' : '#e6f2ff';

      let displayAnswer: string;
      if (q.type === 'checkbox') {
        const checked = answer === 'true' || answer === 'Yes';
        const checkColor = q.id === 'ac19' ? '#FFC107' : '#00875A';
        displayAnswer = checked
          ? `<div style="width:16px;height:16px;border:1px solid #777;background:#fff;text-align:center;line-height:16px;font-weight:bold;color:${checkColor};display:inline-block;">&#10003;</div>`
          : `<div style="width:16px;height:16px;border:1px solid #ccc;background:#f4f4f4;display:inline-block;"></div>`;
      } else {
        displayAnswer = answer ? escapeHtml(answer) : '<span style="color:#999;font-style:italic;">N/A</span>';
      }

      const qStyle = q.isSecondary
        ? 'font-weight:normal;font-style:italic;color:#444;padding-left:25px;'
        : 'font-weight:bold;color:#333;';

      rows += `<tr style="background:${bg};"><td style="padding:8px;border:1px solid #ddd;width:50%;${qStyle}">${q.number}. ${escapeHtml(q.text)}</td><td style="padding:8px;border:1px solid #ddd;text-align:center;">${displayAnswer}</td></tr>`;
      rowIdx++;
    }
  }

  return `
    <div style="background-color:#e9ecef;padding:30px;font-family:sans-serif;">
      <div style="background-color:rgba(255,255,255,0.9);padding:20px;border-radius:8px;max-width:800px;margin:auto;">
        <h2 style="margin:0 0 15px;color:#333;">PMD Account Creation Form for ${escapeHtml(patientName)} ${escapeHtml(dob)}</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${rows}
        </table>
      </div>
    </div>
  `;
}

// ─── Insurance Card OCR ───────────────────────────────────────────────
// Shared endpoint: upload insurance card image → OCR → extract fields.
// Used by both PMD and PAP account creation forms.

router.post('/read-insurance-card', authenticate, upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: 'No image file uploaded' });
      return;
    }

    if (!file.mimetype.startsWith('image/')) {
      res.status(400).json({ error: 'File must be an image (JPEG, PNG, etc.)' });
      return;
    }

    const extracted = await readInsuranceCard(file.buffer, file.originalname, req.user?.id);

    // If agent provided existing entries, compare them
    const enteredInsurance = req.body?.enteredInsurance;
    const enteredMemberId = req.body?.enteredMemberId;
    const enteredName = req.body?.enteredName;
    const enteredDob = req.body?.enteredDob;

    let mismatches: Array<{ field: string; extracted: string; entered: string }> = [];
    if (enteredInsurance || enteredMemberId || enteredName || enteredDob) {
      mismatches = compareInsuranceFields(extracted, {
        insuranceName: enteredInsurance,
        memberId: enteredMemberId,
        subscriberName: enteredName,
        dob: enteredDob,
      });
    }

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      action: 'insurance_card_ocr',
      filename: file.originalname,
      fieldsExtracted: Object.entries(extracted).filter(([k, v]) => k !== 'rawText' && v !== null).length,
      mismatchCount: mismatches.length,
    });

    res.json({ extracted, mismatches });
  } catch (error) {
    logger.error('Insurance card OCR failed', { error: String(error) });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to read insurance card' });
  }
});

export default router;
