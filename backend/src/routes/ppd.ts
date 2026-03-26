import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  getPpdQuestions,
  getPpdQuestionGroups,
  determinePmdRecommendations,
  PpdResponse,
} from '../services/ppdQuestionnaire';
import { logAuditEvent } from '../services/audit';
import { sendEmail, isEmailConfigured } from '../services/emailService';
import { submitPpd, getPpdSubmission, listPpdSubmissions, updatePpdStatus, deletePpdSubmission, PpdStatus } from '../services/ppdQueue';
import { requireAdmin } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();

// Get the full PPD questionnaire (questions + groups)
router.get('/questions', authenticate, (req: AuthRequest, res: Response) => {
  res.json({
    questions: getPpdQuestions(),
    groups: getPpdQuestionGroups(),
  });
});

// Get questions for a specific language
router.get('/questions/:language', authenticate, (req: AuthRequest, res: Response) => {
  const lang = req.params.language.toLowerCase();
  if (lang !== 'english' && lang !== 'spanish') {
    res.status(400).json({ error: 'Language must be "english" or "spanish"' });
    return;
  }
  const questions = getPpdQuestions().map(q => ({
    ...q,
    displayText: lang === 'spanish' ? q.spanishText : q.text,
  }));
  res.json({
    language: lang,
    questions,
    groups: getPpdQuestionGroups(),
  });
});

// Submit PPD responses and get PMD recommendations
router.post('/recommend', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { patientInfo, responses, language } = req.body as {
      patientInfo?: string;
      responses?: PpdResponse[];
      language?: string;
    };

    if (!responses || !Array.isArray(responses)) {
      res.status(400).json({ error: 'responses[] is required' });
      return;
    }

    if (!patientInfo) {
      res.status(400).json({ error: 'patientInfo (patient name + Trx#) is required' });
      return;
    }

    const recommendations = determinePmdRecommendations(responses);

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      action: 'ppd_recommendation',
      patientInfo,
      language: language || 'english',
      responseCount: responses.length,
      recommendationCount: recommendations.length,
      recommendedCodes: recommendations.map(r => r.hcpcsCode),
    });

    res.json({
      patientInfo,
      recommendations,
      submittedAt: new Date().toISOString(),
      agentName: req.user!.username,
    });
  } catch (error) {
    logger.error('PPD recommendation failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to generate PMD recommendations' });
  }
});

// ─── PPD Submission Queue ─────────────────────────────────────────────

// Submit a completed PPD to the queue for Pre-Appointment Kit team review
router.post('/submit', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { patientInfo, responses, recommendations, productSelections, language } = req.body;

    if (!patientInfo || !responses || !Array.isArray(responses)) {
      res.status(400).json({ error: 'patientInfo and responses[] are required' });
      return;
    }

    const record = await submitPpd({
      patientInfo,
      language: language || 'english',
      responses,
      recommendations: recommendations || [],
      productSelections: productSelections || {},
      submittedBy: req.user!.username,
    });

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      action: 'ppd_submitted',
      submissionId: record.id,
      patientInfo,
    });

    res.status(201).json({ submission: record });
  } catch (error) {
    logger.error('PPD submission failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to submit PPD' });
  }
});

// List PPD submissions (agents see their own, admins see all)
router.get('/submissions', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as PpdStatus | undefined;
    const isAdmin = req.user!.role === 'admin';

    const submissions = await listPpdSubmissions({
      status,
      submittedBy: isAdmin ? undefined : req.user!.username,
    });

    res.json({ submissions, total: submissions.length });
  } catch (error) {
    logger.error('Failed to list PPD submissions', { error: String(error) });
    res.status(500).json({ error: 'Failed to list submissions' });
  }
});

// Get a single PPD submission detail
router.get('/submissions/:id', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const record = await getPpdSubmission(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'PPD submission not found' });
      return;
    }
    res.json({ submission: record });
  } catch (error) {
    logger.error('Failed to get PPD submission', { error: String(error) });
    res.status(500).json({ error: 'Failed to get submission' });
  }
});

// Update PPD submission status (admin/reviewer)
router.put('/submissions/:id/status', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { status, reviewNotes, returnReason } = req.body as {
      status: PpdStatus;
      reviewNotes?: string;
      returnReason?: string;
    };

    if (!status || !['pending', 'in_review', 'completed', 'returned'].includes(status)) {
      res.status(400).json({ error: 'Valid status is required (pending, in_review, completed, returned)' });
      return;
    }

    const record = await updatePpdStatus(req.params.id, {
      status,
      reviewedBy: req.user!.username,
      reviewNotes,
      returnReason,
    });

    if (!record) {
      res.status(404).json({ error: 'PPD submission not found' });
      return;
    }

    await logAuditEvent(req.user!.id, req.user!.username, 'query', {
      action: 'ppd_status_updated',
      submissionId: req.params.id,
      newStatus: status,
    });

    res.json({ submission: record });
  } catch (error) {
    logger.error('PPD status update failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to update status' });
  }
});

// Delete a PPD submission (admin only)
router.delete('/submissions/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const deleted = await deletePpdSubmission(req.params.id);
    if (!deleted) {
      res.status(404).json({ error: 'PPD submission not found' });
      return;
    }

    await logAuditEvent(req.user!.id, req.user!.username, 'delete', {
      action: 'ppd_deleted',
      submissionId: req.params.id,
    });

    res.json({ message: 'PPD submission deleted' });
  } catch (error) {
    logger.error('PPD deletion failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete submission' });
  }
});

// Check if email is configured
router.get('/email-status', authenticate, (_req: AuthRequest, res: Response) => {
  res.json({ configured: isEmailConfigured() });
});

// Send PPD form via email
router.post('/send-email', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { to, patientInfo, responses, recommendations, productSelections } = req.body as {
      to: string;
      patientInfo: string;
      responses: PpdResponse[];
      recommendations: Array<{ hcpcsCode: string; description: string; category: string; justification: string; imageUrl?: string; brochureUrl?: string; status?: string; preferred?: boolean }>;
      productSelections?: Record<string, { status: string; preferred: boolean }>;
    };

    if (!to || !patientInfo) {
      res.status(400).json({ error: 'to (email) and patientInfo are required' });
      return;
    }

    // Build the HTML email
    const html = buildPpdEmailHtml(patientInfo, responses, recommendations, productSelections || {});

    const result = await sendEmail({
      to,
      subject: `PPD for ${patientInfo}`,
      html,
      bcc: process.env.PPD_BCC_EMAIL,
    });

    if (result.success) {
      await logAuditEvent(req.user!.id, req.user!.username, 'query', {
        action: 'ppd_email_sent',
        patientInfo,
        to,
        messageId: result.messageId,
      });
      res.json({ success: true, messageId: result.messageId });
    } else {
      res.status(500).json({ error: result.error || 'Failed to send email' });
    }
  } catch (error) {
    logger.error('PPD email send failed', { error: String(error) });
    res.status(500).json({ error: 'Failed to send PPD email' });
  }
});

function buildPpdEmailHtml(
  patientInfo: string,
  responses: PpdResponse[],
  recommendations: Array<{ hcpcsCode: string; description: string; category: string; justification: string; imageUrl?: string; brochureUrl?: string; status?: string; preferred?: boolean }>,
  selections: Record<string, { status: string; preferred: boolean }>,
): string {
  const questions = getPpdQuestions();
  const headerColor = '#223b5d';

  const getAnswer = (qId: string): string => {
    const r = responses.find(r => r.questionId === qId);
    if (!r || r.answer === null || r.answer === undefined) return '';
    return String(r.answer);
  };

  const groups = getPpdQuestionGroups();
  let rows = '';

  for (const group of groups) {
    rows += `<tr><td colspan="2" style="height:12px;"></td></tr>`;
    rows += `<tr style="background:${headerColor};"><td colspan="2" style="padding:10px;border:1px solid #ccc;text-align:center;font-weight:bold;color:#ffffff;">${group}</td></tr>`;

    const groupQuestions = questions.filter(q => q.group === group);
    let rowIdx = 0;
    for (const q of groupQuestions) {
      const answer = getAnswer(q.id);
      if (q.subQuestionOf) {
        const parentAns = getAnswer(q.subQuestionOf);
        if (!parentAns || !parentAns.toLowerCase().includes('yes')) continue;
      }

      const bg = rowIdx % 2 === 0 ? '#ffffff' : '#e6f2ff';
      let displayAnswer = answer || '<span style="color:#999;font-style:italic;">N/A</span>';

      // Style yes/no answers
      if (q.type === 'yes-no' && answer) {
        const lower = answer.toLowerCase();
        if (lower === 'yes' || lower === 'true') {
          displayAnswer = `<span style="background:#d4edda;color:#155724;border:1px solid #c3e6cb;font-weight:bold;border-radius:4px;padding:4px 8px;">${answer}</span>`;
        } else if (lower === 'no' || lower === 'false') {
          displayAnswer = `<span style="background:#f8d7da;color:#721c24;border:1px solid #f5c6cb;font-weight:bold;border-radius:4px;padding:4px 8px;">${answer}</span>`;
        }
      }

      const qStyle = q.subQuestionOf
        ? 'font-weight:normal;font-style:italic;color:#444;padding-left:25px;'
        : 'font-weight:bold;color:#333;';

      rows += `<tr style="background:${bg};"><td style="padding:8px;border:1px solid #ddd;width:50%;${qStyle}">${q.number}. ${q.text}</td><td style="padding:8px;border:1px solid #ddd;text-align:center;font-weight:bold;">${displayAnswer}</td></tr>`;
      rowIdx++;
    }
  }

  // Recommendations section
  let recHtml = '';
  const complex = recommendations.filter(r => r.category === 'complex-rehab');
  const standard = recommendations.filter(r => r.category === 'standard');

  const renderRec = (items: typeof recommendations) => {
    let html = '<ul style="list-style:none;padding:0;">';
    for (const rec of items) {
      const itemId = rec.hcpcsCode.replace(/\s+/g, '-');
      const sel = selections[itemId];
      const isPreferred = sel?.preferred || rec.preferred;
      const status = sel?.status || rec.status || 'none';

      let rowStyle = 'padding:10px;border-bottom:1px solid #ddd;display:flex;align-items:flex-start;gap:15px;';
      if (status === 'rejected') rowStyle += 'background:#f8f9fa;opacity:0.6;filter:grayscale(100%);';

      html += `<li style="${rowStyle}">`;

      // Star
      if (isPreferred) {
        html += `<span style="font-size:24px;color:#FFD700;line-height:1;">&#9733;</span>`;
      }

      // Image
      if (rec.imageUrl) {
        html += `<img src="${rec.imageUrl}" alt="${rec.hcpcsCode}" style="width:100px;height:auto;border:1px solid #eee;" />`;
      }

      // Content
      html += '<div style="font-size:14px;flex-grow:1;">';
      const title = rec.brochureUrl
        ? `<a href="${rec.brochureUrl}" target="_blank" style="text-decoration:none;color:#1a73e8;">${rec.hcpcsCode}</a>`
        : rec.hcpcsCode;

      let badge = '';
      if (status === 'accepted') badge = '<span style="background:#e6fffa;color:#00875A;border:1px solid #b3f5e1;padding:2px 6px;border-radius:4px;font-size:12px;">Accepted</span>';
      else if (status === 'rejected') badge = '<span style="background:#ffebe6;color:#DE350B;border:1px solid #ffbdad;padding:2px 6px;border-radius:4px;font-size:12px;">Rejected</span>';
      else if (status === 'undecided') badge = '<span style="background:#e2e8f0;color:#334155;border:1px solid #94a3b8;padding:2px 6px;border-radius:4px;font-size:12px;">Undecided</span>';

      html += `<div style="font-weight:bold;font-size:16px;margin-bottom:8px;">${title} ${badge}</div>`;
      html += `<div style="color:#555;">${rec.justification}</div>`;
      html += '</div></li>';
    }
    html += '</ul>';
    return html;
  };

  if (complex.length > 0) {
    recHtml += '<h4 style="color:#b71c1c;">Complex Rehab</h4>' + renderRec(complex);
  }
  if (standard.length > 0) {
    recHtml += '<h4 style="color:#1565c0;">Standard Powerchair</h4>' + renderRec(standard);
  }
  if (!complex.length && !standard.length) {
    recHtml = '<p style="color:#666;font-style:italic;">No products matched all criteria.</p>';
  }

  return `
    <div style="background-color:#e9ecef;padding:30px;font-family:sans-serif;">
      <div style="background-color:rgba(255,255,255,0.9);padding:20px;border-radius:8px;max-width:800px;margin:auto;">
        <h2 style="margin:0 0 15px;text-align:left;color:#333;">PPD for ${patientInfo}</h2>
        <table style="border-collapse:collapse;width:100%;font-size:14px;">
          ${rows}
        </table>
        <div style="padding:20px 0 5px;border-top:2px solid #ccc;margin-top:15px;">
          <h3>Recommended HCPCS:</h3>
          ${recHtml}
        </div>
      </div>
    </div>
  `;
}

export default router;
