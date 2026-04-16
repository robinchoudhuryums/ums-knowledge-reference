import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory S3 to avoid real AWS calls
const s3Store = new Map<string, string>();
const sent: Array<{ op: string; key: string; body?: string }> = [];

class FakePutObjectCommand {
  readonly _type = 'Put';
  constructor(public input: { Bucket: string; Key: string; Body: string }) {}
}
class FakeGetObjectCommand {
  readonly _type = 'Get';
  constructor(public input: { Bucket: string; Key: string }) {}
}
class FakeListObjectsV2Command {
  readonly _type = 'List';
  constructor(public input: { Bucket: string; Prefix?: string }) {}
}

const mockSend = vi.fn(async (cmd: { _type: string; input: { Key: string; Body?: string } }) => {
  if (cmd._type === 'Put') {
    s3Store.set(cmd.input.Key, cmd.input.Body as string);
    sent.push({ op: 'Put', key: cmd.input.Key, body: cmd.input.Body as string });
    return {};
  }
  if (cmd._type === 'Get') {
    const body = s3Store.get(cmd.input.Key);
    if (!body) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return {
      Body: {
        transformToString: async () => body,
      },
    };
  }
  return {};
});

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: FakePutObjectCommand,
  GetObjectCommand: FakeGetObjectCommand,
  ListObjectsV2Command: FakeListObjectsV2Command,
  S3Client: vi.fn(),
}));

vi.mock('../config/aws', () => ({
  s3Client: { send: mockSend },
  S3_BUCKET: 'test-bucket',
  S3_PREFIXES: {
    documents: 'documents/',
    vectors: 'vectors/',
    metadata: 'metadata/',
    audit: 'audit/',
  },
}));

describe('extractionFeedback service', () => {
  beforeEach(() => {
    s3Store.clear();
    sent.length = 0;
    mockSend.mockClear();
  });

  it('persists a correction and surfaces it in the listing', async () => {
    const { submitExtractionCorrection, listExtractionCorrections } = await import('../services/extractionFeedback');

    const record = await submitExtractionCorrection({
      templateId: 'cmn-oxygen',
      templateName: 'CMN — Oxygen',
      modelUsed: 'us.anthropic.claude-sonnet-4-6-20250514-v1:0',
      reportedConfidence: 'high',
      actualQuality: 'minor_errors',
      correctedFields: [
        { key: 'patientName', originalValue: 'J Doe', correctedValue: 'John Doe' },
        { key: 'spO2', originalValue: null, correctedValue: 88 },
      ],
      reviewerNote: 'Oximetry value was missed',
      submittedBy: 'reviewer@ums.test',
    });

    expect(record.id).toBeTruthy();
    expect(record.correctedFields).toHaveLength(2);
    expect(record.submittedAt).toBeTruthy();

    const listing = await listExtractionCorrections();
    expect(listing).toHaveLength(1);
    expect(listing[0].id).toBe(record.id);
    expect(listing[0].correctedFieldCount).toBe(2);
  });

  it('writes newest entries first', async () => {
    const { submitExtractionCorrection, listExtractionCorrections } = await import('../services/extractionFeedback');

    await submitExtractionCorrection({
      templateId: 't1', templateName: 'T1', modelUsed: 'm',
      reportedConfidence: 'high', actualQuality: 'correct',
      correctedFields: [], submittedBy: 'a',
    });
    await submitExtractionCorrection({
      templateId: 't1', templateName: 'T1', modelUsed: 'm',
      reportedConfidence: 'low', actualQuality: 'major_errors',
      correctedFields: [{ key: 'x', originalValue: 'a', correctedValue: 'b' }],
      submittedBy: 'b',
    });

    const listing = await listExtractionCorrections();
    expect(listing[0].submittedBy).toBe('b');
    expect(listing[1].submittedBy).toBe('a');
  });

  it('computes accuracy and overconfidence stats correctly', async () => {
    const { submitExtractionCorrection, getExtractionQualityStats } = await import('../services/extractionFeedback');

    // 3 correct, 1 minor_errors (was reported high = overconfident), 1 unusable (was low, not overconfident)
    const cases = [
      { rc: 'high', aq: 'correct' },
      { rc: 'high', aq: 'correct' },
      { rc: 'medium', aq: 'correct' },
      { rc: 'high', aq: 'minor_errors' },
      { rc: 'low', aq: 'unusable' },
    ] as const;

    for (const c of cases) {
      await submitExtractionCorrection({
        templateId: 'cmn', templateName: 'CMN', modelUsed: 'm',
        reportedConfidence: c.rc, actualQuality: c.aq,
        correctedFields: [], submittedBy: 'u',
      });
    }

    const stats = await getExtractionQualityStats();
    expect(stats.total).toBe(5);
    expect(stats.byActualQuality.correct).toBe(3);
    expect(stats.accuracyRate).toBeCloseTo(0.6);
    // 1 case (high + minor_errors) is overconfident; low+unusable is NOT overconfident
    expect(stats.overconfidenceRate).toBeCloseTo(0.2);
  });

  it('returns zeroed stats when no corrections exist', async () => {
    const { getExtractionQualityStats } = await import('../services/extractionFeedback');
    const stats = await getExtractionQualityStats();
    expect(stats.total).toBe(0);
    expect(stats.accuracyRate).toBe(0);
    expect(stats.overconfidenceRate).toBe(0);
  });

  it('returns null when fetching a missing correction', async () => {
    const { getExtractionCorrection } = await import('../services/extractionFeedback');
    const found = await getExtractionCorrection('no-such-id', 'no-such-template');
    expect(found).toBeNull();
  });
});
