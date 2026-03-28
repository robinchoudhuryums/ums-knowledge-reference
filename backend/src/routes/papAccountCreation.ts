import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { getPapQuestions, getPapGroups, PapResponse } from '../services/papAccountCreation';
import { logAuditEvent } from '../services/audit';
import { sendEmail, isEmailConfigured } from '../services/emailService';
import { logger } from '../utils/logger';
import { escapeHtml } from '../utils/htmlEscape';
import rateLimit from 'express-rate-limit';

const submitLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as AuthRequest).user?.id || req.ip || 'unknown',
  message: { error: 'Too many submissions. Please wait before submitting again.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();

router.get('/questions', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ questions: getPapQuestions(), groups: getPapGroups() });
});

router.post('/submit', authenticate, submitLimiter, async (req: AuthRequest, res: Response) => {
  try {
    const { patientName, dob, responses, sendTo } = req.body as {
      patientName: string;
      dob?: string;
      responses: PapResponse[];
      sendTo?: string;
    };

    if (!patientName || !responses || !Array.isArray(responses)) {
      res.status(400).json({ error: 'patientName and responses[] are required' });
      return;
    }

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      action: 'pap_account_creation_submitted',
      patientName,
      responseCount: responses.length,
    });

    if (sendTo && isEmailConfigured()) {
      const html = buildPapHtml(patientName, dob || '', responses);
      const emailResult = await sendEmail({
        to: sendTo,
        subject: `PAP Account Creation for ${patientName.replace(/[\r\n]/g, '')} ${(dob || '').replace(/[\r\n]/g, '')}`.trim(),
        html,
        bcc: process.env.PAP_BCC_EMAIL || process.env.PPD_BCC_EMAIL,
      });

      if (!emailResult.success) {
        res.status(500).json({ error: `Email failed: ${emailResult.error}` });
        return;
      }

      await logAuditEvent(req.user!.id, req.user!.username, 'query', {
        action: 'pap_account_creation_emailed',
        patientName,
        to: sendTo,
      });

      res.json({ success: true, emailed: true, messageId: emailResult.messageId });
    } else {
      res.json({ success: true, emailed: false });
    }
  } catch (error) {
    logger.error('PAP account creation failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to process PAP account creation form' });
  }
});

function buildPapHtml(patientName: string, dob: string, responses: PapResponse[]): string {
  const questions = getPapQuestions();
  const groups = getPapGroups();
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

      // Conditional formatting
      if (q.conditionalFormatting && answer && q.conditionalFormatting[answer]) {
        const rule = q.conditionalFormatting[answer];
        displayAnswer = `<div style="background-color:${rule.bgColor};color:${rule.textColor};border:1px solid ${rule.bgColor};border-radius:4px;padding:5px 8px;font-weight:bold;display:inline-block;">${escapeHtml(answer)}</div>`;
      } else if (q.type === 'checkbox') {
        const checked = answer === 'true' || answer === 'Yes';
        displayAnswer = checked
          ? `<div style="width:16px;height:16px;border:1px solid #777;background:#fff;text-align:center;line-height:16px;font-weight:bold;color:#00875A;display:inline-block;">&#10003;</div>`
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
        <h2 style="margin:0 0 15px;color:#333;">PAP Account Creation for ${escapeHtml(patientName)} ${escapeHtml(dob)}</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${rows}
        </table>
      </div>
    </div>
  `;
}

export default router;
