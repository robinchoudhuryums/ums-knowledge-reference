import { FeedbackEntry } from '../types';
import { saveMetadata, loadMetadata } from './s3Storage';
import { logger } from '../utils/logger';
import { redactPhi } from '../utils/phiRedactor';
import { v4 as uuidv4 } from 'uuid';

const FEEDBACK_PREFIX = 'feedback/';

/**
 * Save a feedback/flag entry. Stored by date for easy admin retrieval.
 */
export async function saveFeedback(
  userId: string,
  username: string,
  data: {
    question: string;
    answer: string;
    patientName?: string;
    transactionNumber?: string;
    notes?: string;
    sources: Array<{ documentName: string; chunkId: string; score: number }>;
  }
): Promise<FeedbackEntry> {
  // Redact potential PHI from all free-text fields before persisting
  const entry: FeedbackEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    userId,
    username,
    queryId: uuidv4(),
    question: redactPhi(data.question).text,
    answer: redactPhi(data.answer).text,
    patientName: data.patientName ? redactPhi(data.patientName).text : undefined,
    transactionNumber: data.transactionNumber,
    notes: data.notes ? redactPhi(data.notes).text : undefined,
    sources: data.sources.map(s => ({
      documentId: '',
      documentName: s.documentName,
      chunkId: s.chunkId,
      text: '',
      score: s.score,
    })),
  };

  const date = new Date().toISOString().split('T')[0];
  const key = `${FEEDBACK_PREFIX}${date}/${entry.id}.json`;

  await saveMetadata(key, entry);
  logger.info('Feedback saved', { feedbackId: entry.id, userId, hasPatientName: !!data.patientName });

  return entry;
}

/**
 * List all feedback entries for a given date.
 */
export async function getFeedbackByDate(date: string): Promise<FeedbackEntry[]> {
  const _key = `${FEEDBACK_PREFIX}${date}/index.json`;
  // We store individual files, so we need to list them.
  // For simplicity, we also maintain a daily index.
  const index = await loadMetadata<FeedbackEntry[]>(`${FEEDBACK_PREFIX}${date}-index.json`);
  return index || [];
}

/**
 * Purge references to a document from feedback entries (last 90 days).
 * Removes matching source citations from feedback.
 * Returns the number of entries modified.
 */
export async function purgeDocumentFromFeedback(documentId: string, documentName?: string): Promise<number> {
  let modified = 0;
  const today = new Date();

  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const dateKey = d.toISOString().split('T')[0];
    const indexKey = `${FEEDBACK_PREFIX}${dateKey}-index.json`;

    try {
      const entries = await loadMetadata<FeedbackEntry[]>(indexKey);
      if (!entries || entries.length === 0) continue;

      let changed = false;
      for (const entry of entries) {
        const beforeLen = entry.sources.length;
        entry.sources = entry.sources.filter(s => {
          if (s.documentId === documentId) return false;
          if (documentName && s.documentName === documentName) return false;
          return true;
        });
        if (entry.sources.length !== beforeLen) {
          changed = true;
          modified++;
        }
      }

      if (changed) {
        await saveMetadata(indexKey, entries);
      }
    } catch {
      // Skip dates that don't exist
    }
  }

  return modified;
}

/**
 * Append to the daily feedback index for easier listing.
 */
export async function appendToFeedbackIndex(entry: FeedbackEntry): Promise<void> {
  const date = entry.timestamp.split('T')[0];
  const indexKey = `${FEEDBACK_PREFIX}${date}-index.json`;
  const existing = await loadMetadata<FeedbackEntry[]>(indexKey) || [];
  existing.push(entry);
  await saveMetadata(indexKey, existing);
}
