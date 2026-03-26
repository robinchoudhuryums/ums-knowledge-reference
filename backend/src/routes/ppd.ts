import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  getPpdQuestions,
  getPpdQuestionGroups,
  determinePmdRecommendations,
  PpdResponse,
} from '../services/ppdQuestionnaire';
import { logAuditEvent } from '../services/audit';
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

export default router;
