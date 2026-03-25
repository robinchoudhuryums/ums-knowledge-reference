import { QueryLogEntry, SourceCitation } from '../types';
import { loadMetadata, saveMetadata } from './s3Storage';

import { redactPhi } from '../utils/phiRedactor';

const LOG_PREFIX = 'query-logs/';

/**
 * In-memory buffer for today's query logs.
 * Persisted to S3 as an append-only JSON array per day.
 */
let todayEntries: QueryLogEntry[] = [];
let todayDate = '';
let lastPersist = 0;
const PERSIST_INTERVAL_MS = 15_000;

// Lock to prevent concurrent day-boundary transitions from racing
let ensurePromise: Promise<void> | null = null;

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

async function ensureTodayLog(): Promise<void> {
  const today = getTodayKey();
  if (todayDate === today) return;

  // If another call is already transitioning, wait for it
  if (ensurePromise) {
    await ensurePromise;
    return;
  }

  ensurePromise = (async () => {
    // Double-check after acquiring lock
    if (todayDate === today) return;

    // Flush previous day if any
    if (todayEntries.length > 0) {
      await forceFlush();
    }

    // Load today's log from S3
    const loaded = await loadMetadata<QueryLogEntry[]>(`${LOG_PREFIX}${today}.json`);
    todayEntries = loaded || [];
    todayDate = today;
  })();

  try {
    await ensurePromise;
  } finally {
    ensurePromise = null;
  }
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

  // Redact potential PHI from question and answer before persisting
  const redactedQuestion = redactPhi(question).text;
  const truncatedAnswer = answer.length > 500 ? answer.slice(0, 500) + '...' : answer;
  const redactedAnswer = redactPhi(truncatedAnswer).text;

  todayEntries.push({
    timestamp: new Date().toISOString(),
    userId,
    username,
    question: redactedQuestion,
    answer: redactedAnswer,
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
 * Purge references to a document from query logs (last 90 days).
 * Removes the document name from sourceDocuments fields.
 * Returns the number of entries modified.
 */
export async function purgeDocumentFromQueryLogs(documentId: string, documentName?: string): Promise<number> {
  let modified = 0;
  const today = new Date();

  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    const key = `${LOG_PREFIX}${dateKey}.json`;

    try {
      const entries = await loadMetadata<QueryLogEntry[]>(key);
      if (!entries || entries.length === 0) continue;

      let changed = false;
      for (const entry of entries) {
        if (documentName && entry.sourceDocuments.includes(documentName)) {
          entry.sourceDocuments = entry.sourceDocuments
            .split('; ')
            .filter(name => name !== documentName)
            .join('; ');
          entry.sourceCount = Math.max(0, entry.sourceCount - 1);
          changed = true;
          modified++;
        }
      }

      if (changed) {
        await saveMetadata(key, entries);
      }
    } catch {
      // Skip dates that don't exist
    }
  }

  // Also scrub today's in-memory buffer
  if (documentName) {
    for (const entry of todayEntries) {
      if (entry.sourceDocuments.includes(documentName)) {
        entry.sourceDocuments = entry.sourceDocuments
          .split('; ')
          .filter(name => name !== documentName)
          .join('; ');
        entry.sourceCount = Math.max(0, entry.sourceCount - 1);
        modified++;
      }
    }
  }

  return modified;
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
