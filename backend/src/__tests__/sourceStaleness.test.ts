import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MonitoredSource } from '../types';

// In-memory S3 so auditStaleSources can read/update the registry
const s3Store = new Map<string, string>();

class FakePutObjectCommand {
  readonly _type = 'Put';
  constructor(public input: { Bucket: string; Key: string; Body: string }) {}
}
class FakeGetObjectCommand {
  readonly _type = 'Get';
  constructor(public input: { Bucket: string; Key: string }) {}
}

const mockSend = vi.fn(async (cmd: { _type: string; input: { Key: string; Body?: string } }) => {
  if (cmd._type === 'Put') {
    s3Store.set(cmd.input.Key, cmd.input.Body as string);
    return {};
  }
  if (cmd._type === 'Get') {
    const body = s3Store.get(cmd.input.Key);
    if (!body) throw Object.assign(new Error('NoSuchKey'), { name: 'NoSuchKey' });
    return { Body: { transformToString: async () => body } };
  }
  return {};
});

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: FakePutObjectCommand,
  GetObjectCommand: FakeGetObjectCommand,
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
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

// Capture alerts sent so tests can verify category + content
const alertCalls: Array<{ category: string; subject: string; details: unknown }> = [];
vi.mock('../services/alertService', () => ({
  sendOperationalAlert: vi.fn(async (category: string, subject: string, details: unknown) => {
    alertCalls.push({ category, subject, details });
  }),
}));

// Stub ingestion and vectorStore — unused in staleness tests but imported at module load
vi.mock('../services/ingestion', () => ({ ingestDocument: vi.fn() }));
vi.mock('../services/vectorStore', () => ({ removeDocumentChunks: vi.fn() }));
vi.mock('../services/s3Storage', () => ({
  getDocumentsIndex: vi.fn(async () => []),
  saveDocumentsIndex: vi.fn(async () => {}),
}));

const SOURCES_INDEX_KEY = 'metadata/monitored-sources.json';

function seedSources(sources: MonitoredSource[]) {
  s3Store.set(SOURCES_INDEX_KEY, JSON.stringify(sources));
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString();
}

describe('auditStaleSources', () => {
  beforeEach(() => {
    s3Store.clear();
    alertCalls.length = 0;
    mockSend.mockClear();
  });

  it('returns no staleness when content changed within cadence', async () => {
    const { auditStaleSources } = await import('../services/sourceMonitor');
    seedSources([{
      id: 's1', name: 'LCD A', url: 'https://example.com/lcd-a',
      collectionId: 'c1', checkIntervalHours: 24, fileType: 'html',
      enabled: true, category: 'LCD',
      createdBy: 'admin', createdAt: daysAgo(200),
      lastContentChangeAt: daysAgo(30),
      expectedUpdateCadenceDays: 120,
    }]);
    const reports = await auditStaleSources();
    expect(reports).toHaveLength(0);
    expect(alertCalls).toHaveLength(0);
  });

  it('alerts when a source has not changed in longer than expected cadence', async () => {
    const { auditStaleSources } = await import('../services/sourceMonitor');
    seedSources([{
      id: 's2', name: 'LCD B', url: 'https://example.com/lcd-b',
      collectionId: 'c1', checkIntervalHours: 24, fileType: 'html',
      enabled: true, category: 'LCD',
      createdBy: 'admin', createdAt: daysAgo(500),
      lastContentChangeAt: daysAgo(180),
      expectedUpdateCadenceDays: 120,
    }]);

    const reports = await auditStaleSources();
    expect(reports).toHaveLength(1);
    expect(reports[0].sourceId).toBe('s2');
    expect(reports[0].daysSinceLastChange).toBeGreaterThanOrEqual(180);
    expect(reports[0].alertedNow).toBe(true);

    expect(alertCalls).toHaveLength(1);
    expect(alertCalls[0].category).toBe('source_stale');
    expect(alertCalls[0].subject).toContain('LCD B');
  });

  it('skips disabled sources', async () => {
    const { auditStaleSources } = await import('../services/sourceMonitor');
    seedSources([{
      id: 's3', name: 'Disabled', url: 'https://example.com/x',
      collectionId: 'c1', checkIntervalHours: 24, fileType: 'html',
      enabled: false, category: 'LCD',
      createdBy: 'admin', createdAt: daysAgo(500),
      lastContentChangeAt: daysAgo(500),
      expectedUpdateCadenceDays: 60,
    }]);
    const reports = await auditStaleSources();
    expect(reports).toHaveLength(0);
  });

  it('skips sources without expectedUpdateCadenceDays', async () => {
    const { auditStaleSources } = await import('../services/sourceMonitor');
    seedSources([{
      id: 's4', name: 'No cadence', url: 'https://example.com/y',
      collectionId: 'c1', checkIntervalHours: 24, fileType: 'html',
      enabled: true, category: 'general',
      createdBy: 'admin', createdAt: daysAgo(500),
      lastContentChangeAt: daysAgo(500),
    }]);
    const reports = await auditStaleSources();
    expect(reports).toHaveLength(0);
    expect(alertCalls).toHaveLength(0);
  });

  it('uses createdAt as the anchor when content has never changed', async () => {
    const { auditStaleSources } = await import('../services/sourceMonitor');
    seedSources([{
      id: 's5', name: 'Never updated', url: 'https://example.com/z',
      collectionId: 'c1', checkIntervalHours: 24, fileType: 'html',
      enabled: true, category: 'LCD',
      createdBy: 'admin', createdAt: daysAgo(40),
      // No lastContentChangeAt — use createdAt
      expectedUpdateCadenceDays: 30,
    }]);
    const reports = await auditStaleSources();
    expect(reports).toHaveLength(1);
    expect(reports[0].lastContentChangeAt).toBeUndefined();
    expect(reports[0].alertedNow).toBe(true);
  });

  it('does not re-alert a source that was alerted within 24h', async () => {
    const { auditStaleSources } = await import('../services/sourceMonitor');
    seedSources([{
      id: 's6', name: 'Already alerted', url: 'https://example.com/a',
      collectionId: 'c1', checkIntervalHours: 24, fileType: 'html',
      enabled: true, category: 'LCD',
      createdBy: 'admin', createdAt: daysAgo(500),
      lastContentChangeAt: daysAgo(200),
      expectedUpdateCadenceDays: 60,
      lastStalenessAlertAt: new Date(Date.now() - 60_000).toISOString(), // 1 min ago
    }]);

    const reports = await auditStaleSources();
    expect(reports).toHaveLength(1);
    expect(reports[0].alertedNow).toBe(false); // throttled
    expect(alertCalls).toHaveLength(0);
  });

  it('re-alerts if the previous staleness alert was >24h ago', async () => {
    const { auditStaleSources } = await import('../services/sourceMonitor');
    seedSources([{
      id: 's7', name: 'Re-alert', url: 'https://example.com/r',
      collectionId: 'c1', checkIntervalHours: 24, fileType: 'html',
      enabled: true, category: 'LCD',
      createdBy: 'admin', createdAt: daysAgo(500),
      lastContentChangeAt: daysAgo(200),
      expectedUpdateCadenceDays: 60,
      lastStalenessAlertAt: daysAgo(2), // 2 days ago
    }]);

    const reports = await auditStaleSources();
    expect(reports).toHaveLength(1);
    expect(reports[0].alertedNow).toBe(true);
    expect(alertCalls).toHaveLength(1);
  });
});
