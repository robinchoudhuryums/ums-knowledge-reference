import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/s3Storage', () => {
  let store: Record<string, unknown> = {};
  return {
    loadMetadata: vi.fn(async <T>(key: string): Promise<T | null> => (store[key] as T) || null),
    saveMetadata: vi.fn(async (key: string, data: unknown) => { store[key] = data; }),
    __resetStore: () => { store = {}; },
    __getStore: () => store,
  };
});

vi.mock('../utils/phiRedactor', () => ({
  redactPhi: vi.fn((text: string) => ({ text, redacted: false })),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { saveFeedback, getFeedbackByDate, appendToFeedbackIndex, purgeDocumentFromFeedback } from '../services/feedback';
import { saveMetadata } from '../services/s3Storage';
import { redactPhi } from '../utils/phiRedactor';
import type { FeedbackEntry } from '../types';

import * as s3Module from '../services/s3Storage';

beforeEach(() => {
  vi.clearAllMocks();
  (s3Module as any).__resetStore();
});

describe('feedback service', () => {
  const sampleData = {
    question: 'What is the policy?',
    answer: 'The policy states that...',
    patientName: 'John Doe',
    transactionNumber: 'TX-123',
    notes: 'Needs clarification',
    sources: [
      { documentName: 'policy.pdf', chunkId: 'doc1-chunk-0', score: 0.85 },
    ],
  };

  it('saveFeedback creates entry with auto-generated id and timestamp', async () => {
    const entry = await saveFeedback('user1', 'testuser', sampleData);

    expect(entry.id).toBeDefined();
    expect(entry.id.length).toBeGreaterThan(0);
    expect(entry.timestamp).toBeDefined();
    expect(entry.userId).toBe('user1');
    expect(entry.username).toBe('testuser');
    expect(entry.queryId).toBeDefined();
    expect(entry.question).toBe('What is the policy?');
    expect(entry.answer).toBe('The policy states that...');
    expect(entry.patientName).toBe('John Doe');
    expect(entry.transactionNumber).toBe('TX-123');
    expect(entry.notes).toBe('Needs clarification');
    expect(entry.sources).toHaveLength(1);
  });

  it('saveFeedback calls redactPhi on question, answer, patientName, notes', async () => {
    await saveFeedback('user1', 'testuser', sampleData);

    expect(redactPhi).toHaveBeenCalledWith('What is the policy?');
    expect(redactPhi).toHaveBeenCalledWith('The policy states that...');
    expect(redactPhi).toHaveBeenCalledWith('John Doe');
    expect(redactPhi).toHaveBeenCalledWith('Needs clarification');
  });

  it('saveFeedback persists entry to S3 with correct key format', async () => {
    const entry = await saveFeedback('user1', 'testuser', sampleData);

    const today = new Date().toISOString().split('T')[0];
    const expectedKey = `feedback/${today}/${entry.id}.json`;

    expect(saveMetadata).toHaveBeenCalledWith(expectedKey, entry);
  });

  it('getFeedbackByDate returns entries from the daily index', async () => {
    const date = '2026-03-25';
    const indexKey = `feedback/${date}-index.json`;
    const entries: FeedbackEntry[] = [
      {
        id: 'fb1',
        timestamp: `${date}T10:00:00.000Z`,
        userId: 'user1',
        username: 'testuser',
        queryId: 'q1',
        question: 'test?',
        answer: 'yes',
        sources: [],
      },
    ];

    // Pre-populate the store with the index
    await (saveMetadata as any)(indexKey, entries);
    vi.clearAllMocks();

    const result = await getFeedbackByDate(date);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('fb1');
  });

  it('appendToFeedbackIndex appends to existing index array', async () => {
    const date = '2026-03-25';
    const indexKey = `feedback/${date}-index.json`;

    const existing: FeedbackEntry = {
      id: 'fb1',
      timestamp: `${date}T10:00:00.000Z`,
      userId: 'user1',
      username: 'testuser',
      queryId: 'q1',
      question: 'first?',
      answer: 'yes',
      sources: [],
    };

    // Pre-populate with one entry
    await (saveMetadata as any)(indexKey, [existing]);

    const newEntry: FeedbackEntry = {
      id: 'fb2',
      timestamp: `${date}T11:00:00.000Z`,
      userId: 'user2',
      username: 'testuser2',
      queryId: 'q2',
      question: 'second?',
      answer: 'no',
      sources: [],
    };

    await appendToFeedbackIndex(newEntry);

    const store = (s3Module as any).__getStore();
    const saved = store[indexKey] as FeedbackEntry[];
    expect(saved).toHaveLength(2);
    expect(saved[0].id).toBe('fb1');
    expect(saved[1].id).toBe('fb2');
  });

  it('purgeDocumentFromFeedback removes matching sources and returns modified count', async () => {
    const today = new Date().toISOString().split('T')[0];
    const indexKey = `feedback/${today}-index.json`;

    const entries: FeedbackEntry[] = [
      {
        id: 'fb1',
        timestamp: `${today}T10:00:00.000Z`,
        userId: 'user1',
        username: 'testuser',
        queryId: 'q1',
        question: 'test?',
        answer: 'yes',
        sources: [
          { documentId: 'doc-abc', documentName: 'policy.pdf', chunkId: 'doc-abc-chunk-0', text: '', score: 0.9 },
          { documentId: 'doc-xyz', documentName: 'other.pdf', chunkId: 'doc-xyz-chunk-0', text: '', score: 0.8 },
        ],
      },
      {
        id: 'fb2',
        timestamp: `${today}T11:00:00.000Z`,
        userId: 'user2',
        username: 'testuser2',
        queryId: 'q2',
        question: 'another?',
        answer: 'no',
        sources: [
          { documentId: 'doc-xyz', documentName: 'other.pdf', chunkId: 'doc-xyz-chunk-1', text: '', score: 0.7 },
        ],
      },
    ];

    await (saveMetadata as any)(indexKey, entries);

    const modified = await purgeDocumentFromFeedback('doc-abc');

    expect(modified).toBe(1);

    const store = (s3Module as any).__getStore();
    const updated = store[indexKey] as FeedbackEntry[];
    expect(updated[0].sources).toHaveLength(1);
    expect(updated[0].sources[0].documentId).toBe('doc-xyz');
    expect(updated[1].sources).toHaveLength(1);
  });
});
