import { QueryLogEntry, SourceCitation } from '../types';
import { loadMetadata, saveMetadata } from './s3Storage';
import { logger } from '../utils/logger';

const LOG_PREFIX = 'query-logs/';

/**
 * In-memory buffer for today's query logs.
 * Persisted to S3 as an append-only JSON array per day.
 */
let todayEntries: QueryLogEntry[] = [];
let todayDate = '';
let lastPersist = 0;
const PERSIST_INTERVAL_MS = 15_000;

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

async function ensureTodayLog(): Promise<void> {
  const today = getTodayKey();
  if (todayDate === today) return;

  // Flush previous day if any
  if (todayEntries.length > 0) {
    await forceFlush();
  }

  // Load today's log from S3
  const loaded = await loadMetadata<QueryLogEntry[]>(`${LOG_PREFIX}${today}.json`);
  todayEntries = loaded || [];
  todayDate = today;
}

async function persistIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastPersist < PERSIST_INTERVAL_MS) return;
  await forceFlush();
}

async function forceFlush(): Promise<void> {
  if (todayEntries.length === 0) return;
  await saveMetadata(`${LOG_PREFIX}${todayDate}.json`, todayEntries);
  lastPersist = Date.now();
}

/**
 * Log a query + response for analytics. Called after each successful query.
 */
export async function logQuery(
  userId: string,
  username: string,
  question: string,
  answer: string,
  confidence: 'high' | 'partial' | 'low',
  sources: SourceCitation[],
  collectionIds?: string[]
): Promise<void> {
  await ensureTodayLog();

  // Deduplicate source document names
  const sourceDocNames = [...new Set(sources.map(s => s.documentName))].join('; ');

  todayEntries.push({
    timestamp: new Date().toISOString(),
    userId,
    username,
    question,
    answer: answer.length > 500 ? answer.slice(0, 500) + '...' : answer,
    confidence,
    sourceDocuments: sourceDocNames,
    sourceCount: sources.length,
    collectionIds,
  });

  await persistIfNeeded();
}

/**
 * Flush the in-memory query log to S3 immediately.
 */
export async function flushQueryLog(): Promise<void> {
  await forceFlush();
}

/**
 * Get all query log entries for a given date.
 */
export async function getQueryLog(date: string): Promise<QueryLogEntry[]> {
  const entries = await loadMetadata<QueryLogEntry[]>(`${LOG_PREFIX}${date}.json`);
  return entries || [];
}

/**
 * Convert query log entries to CSV format.
 */
export function queryLogToCsv(entries: QueryLogEntry[]): string {
  const header = 'Timestamp,Agent Username,Question,Answer (truncated),Confidence,Source Documents,Source Count';
  const rows = entries.map(e => {
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    return [
      e.timestamp,
      esc(e.username),
      esc(e.question),
      esc(e.answer),
      e.confidence,
      esc(e.sourceDocuments),
      e.sourceCount,
    ].join(',');
  });
  return [header, ...rows].join('\n');
}
