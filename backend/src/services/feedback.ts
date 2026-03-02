import { FeedbackEntry } from '../types';
import { saveMetadata, loadMetadata } from './s3Storage';
import { logger } from '../utils/logger';
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
  const entry: FeedbackEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    userId,
    username,
    queryId: uuidv4(),
    question: data.question,
    answer: data.answer,
    patientName: data.patientName,
    transactionNumber: data.transactionNumber,
    notes: data.notes,
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
  const key = `${FEEDBACK_PREFIX}${date}/index.json`;
  // We store individual files, so we need to list them.
  // For simplicity, we also maintain a daily index.
  const index = await loadMetadata<FeedbackEntry[]>(`${FEEDBACK_PREFIX}${date}-index.json`);
  return index || [];
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
