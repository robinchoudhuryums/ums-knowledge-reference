import { QueryLogEntry } from '../types';
import { getQueryLog, flushQueryLog } from './queryLog';
import { logger } from '../utils/logger';

export interface FaqItem {
  question: string;
  frequency: number;
  lastAsked: string;
  avgConfidence: string;
  agents: string[];
}

export interface FaqDashboardData {
  period: { start: string; end: string };
  totalQueries: number;
  uniqueAgents: number;
  confidenceBreakdown: { high: number; partial: number; low: number };
  topQuestions: FaqItem[];
  lowConfidenceQuestions: FaqItem[];
  agentActivity: Array<{ username: string; queryCount: number; avgConfidence: string }>;
  queriesByDay: Array<{ date: string; count: number }>;
}

/**
 * Normalize a question for grouping: lowercase, strip punctuation, trim whitespace.
 * This groups minor variations of the same question together.
 */
function normalizeQuestion(q: string): string {
  return q
    .toLowerCase()
    .replace(/[?!.,;:'"]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build FAQ dashboard data by aggregating query logs over a date range.
 * Defaults to the last 7 days if no range specified.
 */
export async function buildFaqDashboard(
  startDate?: string,
  endDate?: string
): Promise<FaqDashboardData> {
  // Default: last 7 days
  const end = endDate || new Date().toISOString().split('T')[0];
  const start = startDate || (() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return d.toISOString().split('T')[0];
  })();

  // Flush current buffer before reading
  await flushQueryLog();

  // Collect all entries across the date range
  const allEntries: QueryLogEntry[] = [];
  const queriesByDay: Array<{ date: string; count: number }> = [];

  const current = new Date(start);
  const endD = new Date(end);

  while (current <= endD) {
    const dateStr = current.toISOString().split('T')[0];
    try {
      const dayEntries = await getQueryLog(dateStr);
      allEntries.push(...dayEntries);
      queriesByDay.push({ date: dateStr, count: dayEntries.length });
    } catch {
      queriesByDay.push({ date: dateStr, count: 0 });
    }
    current.setDate(current.getDate() + 1);
  }

  if (allEntries.length === 0) {
    return {
      period: { start, end },
      totalQueries: 0,
      uniqueAgents: 0,
      confidenceBreakdown: { high: 0, partial: 0, low: 0 },
      topQuestions: [],
      lowConfidenceQuestions: [],
      agentActivity: [],
      queriesByDay,
    };
  }

  // Confidence breakdown
  const confidenceBreakdown = { high: 0, partial: 0, low: 0 };
  for (const e of allEntries) {
    confidenceBreakdown[e.confidence]++;
  }

  // Unique agents
  const agentSet = new Set(allEntries.map(e => e.username));

  // Group by normalized question
  const questionMap = new Map<string, {
    original: string;
    count: number;
    lastAsked: string;
    confidences: string[];
    agents: Set<string>;
  }>();

  for (const e of allEntries) {
    const key = normalizeQuestion(e.question);
    const existing = questionMap.get(key);
    if (existing) {
      existing.count++;
      existing.confidences.push(e.confidence);
      existing.agents.add(e.username);
      if (e.timestamp > existing.lastAsked) {
        existing.lastAsked = e.timestamp;
        existing.original = e.question; // Keep the most recent wording
      }
    } else {
      questionMap.set(key, {
        original: e.question,
        count: 1,
        lastAsked: e.timestamp,
        confidences: [e.confidence],
        agents: new Set([e.username]),
      });
    }
  }

  function avgConfidence(confidences: string[]): string {
    if (confidences.length === 0) return 'N/A';
    const highCount = confidences.filter(c => c === 'high').length;
    const ratio = highCount / confidences.length;
    if (ratio >= 0.7) return 'high';
    if (ratio >= 0.3) return 'partial';
    return 'low';
  }

  // Top questions by frequency
  const sorted = [...questionMap.values()].sort((a, b) => b.count - a.count);
  const topQuestions: FaqItem[] = sorted.slice(0, 20).map(q => ({
    question: q.original,
    frequency: q.count,
    lastAsked: q.lastAsked,
    avgConfidence: avgConfidence(q.confidences),
    agents: [...q.agents],
  }));

  // Low-confidence questions (questions that most often get low/partial)
  const lowConfSorted = [...questionMap.values()]
    .filter(q => {
      const lowPartial = q.confidences.filter(c => c === 'low' || c === 'partial').length;
      return lowPartial / q.confidences.length > 0.5;
    })
    .sort((a, b) => b.count - a.count);

  const lowConfidenceQuestions: FaqItem[] = lowConfSorted.slice(0, 15).map(q => ({
    question: q.original,
    frequency: q.count,
    lastAsked: q.lastAsked,
    avgConfidence: avgConfidence(q.confidences),
    agents: [...q.agents],
  }));

  // Agent activity
  const agentMap = new Map<string, { count: number; confidences: string[] }>();
  for (const e of allEntries) {
    const existing = agentMap.get(e.username);
    if (existing) {
      existing.count++;
      existing.confidences.push(e.confidence);
    } else {
      agentMap.set(e.username, { count: 1, confidences: [e.confidence] });
    }
  }

  const agentActivity = [...agentMap.entries()]
    .map(([username, data]) => ({
      username,
      queryCount: data.count,
      avgConfidence: avgConfidence(data.confidences),
    }))
    .sort((a, b) => b.queryCount - a.queryCount);

  logger.info('FAQ dashboard built', {
    period: `${start} to ${end}`,
    totalQueries: allEntries.length,
    uniqueQuestions: questionMap.size,
  });

  return {
    period: { start, end },
    totalQueries: allEntries.length,
    uniqueAgents: agentSet.size,
    confidenceBreakdown,
    topQuestions,
    lowConfidenceQuestions,
    agentActivity,
    queriesByDay,
  };
}
