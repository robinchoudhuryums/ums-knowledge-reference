/**
 * RAG Trace Service — captures detailed observability data for every RAG query.
 *
 * Schema mirrors what would be a rag_traces table in SQL, stored as S3 JSON.
 * Writes are async (fire-and-forget) so they don't add latency to user responses.
 */

import { loadMetadata, saveMetadata } from './s3Storage';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

const TRACE_PREFIX = 'rag-traces/';

export interface RagTrace {
  traceId: string;
  timestamp: string;
  userId: string;
  username: string;
  queryText: string;
  reformulatedQuery?: string;
  retrievedChunkIds: string[];
  retrievalScores: number[];
  avgRetrievalScore: number;
  chunksPassedToModel: number;
  modelId: string;
  responseText: string;
  confidence: 'high' | 'partial' | 'low';
  responseTimeMs: number;
  embeddingTimeMs?: number;
  retrievalTimeMs?: number;
  generationTimeMs?: number;
  sessionId?: string;
  collectionIds?: string[];
  streamed: boolean;
  inputTokens?: number;
  outputTokens?: number;
  createdAt: string;
}

export interface RagFeedback {
  feedbackId: string;
  traceId: string;
  feedbackType: 'thumbs_up' | 'thumbs_down';
  matchPct?: number;
  notes?: string;
  userId: string;
  username: string;
  createdAt: string;
}

// In-memory buffer for today's traces — flushed periodically to S3
let todayTraces: RagTrace[] = [];
let todayFeedback: RagFeedback[] = [];
let todayDate = '';
let lastPersist = 0;
const PERSIST_INTERVAL_MS = 15_000;

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

async function ensureToday(): Promise<void> {
  const today = getTodayKey();
  if (todayDate === today) return;

  // Flush previous day
  if (todayTraces.length > 0 || todayFeedback.length > 0) {
    await forceFlush();
  }

  // Load today's data from S3
  const [traces, feedback] = await Promise.all([
    loadMetadata<RagTrace[]>(`${TRACE_PREFIX}${today}-traces.json`),
    loadMetadata<RagFeedback[]>(`${TRACE_PREFIX}${today}-feedback.json`),
  ]);
  todayTraces = traces || [];
  todayFeedback = feedback || [];
  todayDate = today;
}

async function persistIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastPersist < PERSIST_INTERVAL_MS) return;
  await forceFlush();
}

async function forceFlush(): Promise<void> {
  const promises: Promise<void>[] = [];
  if (todayTraces.length > 0) {
    promises.push(saveMetadata(`${TRACE_PREFIX}${todayDate}-traces.json`, todayTraces));
  }
  if (todayFeedback.length > 0) {
    promises.push(saveMetadata(`${TRACE_PREFIX}${todayDate}-feedback.json`, todayFeedback));
  }
  if (promises.length > 0) {
    await Promise.all(promises);
    lastPersist = Date.now();
  }
}

/**
 * Generate a new trace ID. Call this at the start of the RAG pipeline.
 */
export function generateTraceId(): string {
  return uuidv4();
}

/**
 * Log a RAG trace asynchronously. Called after the RAG pipeline completes.
 */
export async function logRagTrace(trace: Omit<RagTrace, 'createdAt'>): Promise<void> {
  try {
    await ensureToday();
    todayTraces.push({
      ...trace,
      createdAt: new Date().toISOString(),
    });
    await persistIfNeeded();
  } catch (error) {
    logger.error('Failed to log RAG trace', { error: String(error), traceId: trace.traceId });
  }
}

/**
 * Log feedback linked to a trace.
 */
export async function logRagFeedback(feedback: Omit<RagFeedback, 'feedbackId' | 'createdAt'>): Promise<RagFeedback> {
  await ensureToday();
  const entry: RagFeedback = {
    ...feedback,
    feedbackId: uuidv4(),
    createdAt: new Date().toISOString(),
  };
  todayFeedback.push(entry);
  await persistIfNeeded();
  return entry;
}

/**
 * Force-flush traces and feedback to S3.
 */
export async function flushTraces(): Promise<void> {
  await forceFlush();
}

/**
 * Get traces for a given date.
 */
export async function getTraces(date: string): Promise<RagTrace[]> {
  if (date === todayDate) {
    await forceFlush();
    return todayTraces;
  }
  return await loadMetadata<RagTrace[]>(`${TRACE_PREFIX}${date}-traces.json`) || [];
}

/**
 * Get feedback for a given date.
 */
export async function getTraceFeedback(date: string): Promise<RagFeedback[]> {
  if (date === todayDate) {
    await forceFlush();
    return todayFeedback;
  }
  return await loadMetadata<RagFeedback[]>(`${TRACE_PREFIX}${date}-feedback.json`) || [];
}

/**
 * Aggregate observability metrics across a date range.
 */
export async function getObservabilityMetrics(days: number = 7): Promise<ObservabilityMetrics> {
  const today = new Date();
  const dates: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().split('T')[0]);
  }

  // Flush current buffer before reading
  await flushTraces();

  let totalTraces = 0;
  let totalResponseTimeMs = 0;
  let totalRetrievalScore = 0;
  let totalThumbsUp = 0;
  let totalThumbsDown = 0;
  const dailyStats: DailyObservability[] = [];
  const lowScoreLowRating: CorrelationEntry[] = [];
  const allTraceMap = new Map<string, RagTrace>();

  for (const date of dates) {
    const [traces, feedback] = await Promise.all([
      getTraces(date),
      getTraceFeedback(date),
    ]);

    // Build trace lookup for this date
    const traceMap = new Map<string, RagTrace>();
    for (const t of traces) {
      traceMap.set(t.traceId, t);
      allTraceMap.set(t.traceId, t);
    }

    const dayTraces = traces.length;
    const dayAvgResponseTime = dayTraces > 0
      ? Math.round(traces.reduce((s, t) => s + t.responseTimeMs, 0) / dayTraces)
      : 0;
    const dayAvgRetrievalScore = dayTraces > 0
      ? traces.reduce((s, t) => s + t.avgRetrievalScore, 0) / dayTraces
      : 0;

    let dayUp = 0;
    let dayDown = 0;
    for (const fb of feedback) {
      if (fb.feedbackType === 'thumbs_up') dayUp++;
      else if (fb.feedbackType === 'thumbs_down') dayDown++;

      // Correlation: low rating + trace data
      if (fb.feedbackType === 'thumbs_down') {
        const trace = traceMap.get(fb.traceId);
        if (trace) {
          lowScoreLowRating.push({
            traceId: fb.traceId,
            date,
            queryText: trace.queryText,
            avgRetrievalScore: trace.avgRetrievalScore,
            confidence: trace.confidence,
            responseTimeMs: trace.responseTimeMs,
            feedbackNotes: fb.notes,
          });
        }
      }
    }

    totalTraces += dayTraces;
    totalResponseTimeMs += traces.reduce((s, t) => s + t.responseTimeMs, 0);
    totalRetrievalScore += traces.reduce((s, t) => s + t.avgRetrievalScore, 0);
    totalThumbsUp += dayUp;
    totalThumbsDown += dayDown;

    dailyStats.push({
      date,
      traceCount: dayTraces,
      avgResponseTimeMs: dayAvgResponseTime,
      avgRetrievalScore: Math.round(dayAvgRetrievalScore * 1000) / 1000,
      thumbsUp: dayUp,
      thumbsDown: dayDown,
    });
  }

  const avgResponseTimeMs = totalTraces > 0 ? Math.round(totalResponseTimeMs / totalTraces) : 0;
  const avgRetrievalScore = totalTraces > 0
    ? Math.round((totalRetrievalScore / totalTraces) * 1000) / 1000
    : 0;
  const thumbsUpRatio = (totalThumbsUp + totalThumbsDown) > 0
    ? Math.round((totalThumbsUp / (totalThumbsUp + totalThumbsDown)) * 100)
    : 0;

  // Classify thumbs-down entries: retrieval failure vs generation failure
  // Retrieval failure: low retrieval score (< 0.4)
  // Generation failure: decent retrieval score but still thumbs down
  const retrievalFailures = lowScoreLowRating.filter(e => e.avgRetrievalScore < 0.4);
  const generationFailures = lowScoreLowRating.filter(e => e.avgRetrievalScore >= 0.4);

  return {
    period: { start: dates[dates.length - 1], end: dates[0], days },
    totalTraces,
    avgResponseTimeMs,
    avgRetrievalScore,
    thumbsUp: totalThumbsUp,
    thumbsDown: totalThumbsDown,
    thumbsUpRatio,
    dailyStats: dailyStats.reverse(),
    retrievalFailures: retrievalFailures.slice(0, 20),
    generationFailures: generationFailures.slice(0, 20),
  };
}

export interface DailyObservability {
  date: string;
  traceCount: number;
  avgResponseTimeMs: number;
  avgRetrievalScore: number;
  thumbsUp: number;
  thumbsDown: number;
}

export interface CorrelationEntry {
  traceId: string;
  date: string;
  queryText: string;
  avgRetrievalScore: number;
  confidence: string;
  responseTimeMs: number;
  feedbackNotes?: string;
}

export interface ObservabilityMetrics {
  period: { start: string; end: string; days: number };
  totalTraces: number;
  avgResponseTimeMs: number;
  avgRetrievalScore: number;
  thumbsUp: number;
  thumbsDown: number;
  thumbsUpRatio: number;
  dailyStats: DailyObservability[];
  retrievalFailures: CorrelationEntry[];
  generationFailures: CorrelationEntry[];
}
