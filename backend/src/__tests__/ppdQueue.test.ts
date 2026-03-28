/**
 * Tests for PPD Queue service — state machine transitions, form versioning,
 * submission CRUD, and index management.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────────────────

const mockS3Send = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(),
  PutObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
  GetObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
  DeleteObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
  ListObjectsV2Command: class { input: unknown; constructor(input: unknown) { this.input = input; } },
  GetBucketEncryptionCommand: vi.fn(),
  GetPublicAccessBlockCommand: vi.fn(),
  GetBucketVersioningCommand: vi.fn(),
}));

vi.mock('../config/aws', () => ({
  s3Client: { send: (...args: unknown[]) => mockS3Send(...args) },
  S3_BUCKET: 'test-bucket',
  S3_PREFIXES: { documents: 'documents/', vectors: 'vectors/', metadata: 'metadata/', audit: 'audit/' },
  bedrockClient: {},
  BEDROCK_GENERATION_MODEL: 'test-model',
  BEDROCK_EMBEDDING_MODEL: 'test-embed',
  BEDROCK_EXTRACTION_MODEL: 'test-extraction',
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({ v4: () => 'test-uuid-1234' }));

import { isValidTransition, PpdStatus } from '../services/ppdQueue';

// ── State Machine Tests ────────────────────────────────────────────────

describe('PPD Queue — State Machine', () => {
  describe('isValidTransition', () => {
    it('allows pending → in_review', () => {
      expect(isValidTransition('pending', 'in_review')).toBe(true);
    });

    it('allows in_review → completed', () => {
      expect(isValidTransition('in_review', 'completed')).toBe(true);
    });

    it('allows in_review → returned', () => {
      expect(isValidTransition('in_review', 'returned')).toBe(true);
    });

    it('allows returned → in_review (re-review after corrections)', () => {
      expect(isValidTransition('returned', 'in_review')).toBe(true);
    });

    it('rejects pending → completed (must go through review)', () => {
      expect(isValidTransition('pending', 'completed')).toBe(false);
    });

    it('rejects pending → returned (must go through review)', () => {
      expect(isValidTransition('pending', 'returned')).toBe(false);
    });

    it('rejects completed → any (terminal state)', () => {
      expect(isValidTransition('completed', 'pending')).toBe(false);
      expect(isValidTransition('completed', 'in_review')).toBe(false);
      expect(isValidTransition('completed', 'returned')).toBe(false);
    });

    it('rejects returned → completed (must go back through review)', () => {
      expect(isValidTransition('returned', 'completed')).toBe(false);
    });

    it('rejects same-state transitions', () => {
      const statuses: PpdStatus[] = ['pending', 'in_review', 'completed', 'returned'];
      for (const s of statuses) {
        expect(isValidTransition(s, s)).toBe(false);
      }
    });
  });
});

// ── Form Version Tests ─────────────────────────────────────────────────

describe('PPD Queue — Form Versioning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submitPpd embeds formVersion in the stored record', async () => {
    // Mock: loadIndex returns empty, save calls succeed
    let savedRecord: Record<string, unknown> | null = null;

    mockS3Send.mockImplementation(async (cmd: any) => {
      const key = cmd.input?.Key || '';
      // loadIndex → empty array
      if (key.includes('ppd-queue-index.json') && !cmd.input?.Body) {
        return { Body: { transformToString: async () => '[]' } };
      }
      // Capture the saved record
      if (key.includes('ppd-queue/') && key.endsWith('.json') && cmd.input?.Body) {
        savedRecord = JSON.parse(cmd.input.Body);
      }
      return {};
    });

    const { submitPpd } = await import('../services/ppdQueue');
    await submitPpd({
      patientInfo: 'Test Patient - TRX001',
      language: 'english',
      responses: [{ questionId: 'q1', answer: 'yes' }],
      recommendations: [],
      productSelections: {},
      submittedBy: 'agent-001',
    });

    expect(savedRecord).not.toBeNull();
    expect(savedRecord!.formVersion).toBeDefined();
    expect(typeof savedRecord!.formVersion).toBe('string');
    expect((savedRecord!.formVersion as string).length).toBeGreaterThan(0);
  });

  it('PPD_FORM_VERSION is exported and is a non-empty string', async () => {
    const { PPD_FORM_VERSION } = await import('../services/ppdQuestionnaire');
    expect(typeof PPD_FORM_VERSION).toBe('string');
    expect(PPD_FORM_VERSION.length).toBeGreaterThan(0);
  });

  it('AC_FORM_VERSION is exported and is a non-empty string', async () => {
    const { AC_FORM_VERSION } = await import('../services/accountCreation');
    expect(typeof AC_FORM_VERSION).toBe('string');
    expect(AC_FORM_VERSION.length).toBeGreaterThan(0);
  });

  it('PAP_FORM_VERSION is exported and is a non-empty string', async () => {
    const { PAP_FORM_VERSION } = await import('../services/papAccountCreation');
    expect(typeof PAP_FORM_VERSION).toBe('string');
    expect(PAP_FORM_VERSION.length).toBeGreaterThan(0);
  });
});

// ── Status Update with State Machine Enforcement ──────────────────────

describe('PPD Queue — updatePpdStatus enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects invalid transition with descriptive error', async () => {
    // Mock getPpdSubmission to return a record with status='pending'
    mockS3Send.mockImplementation(async (cmd: any) => {
      const key = cmd.input?.Key || '';
      if (key.includes('ppd-queue/') && key.endsWith('.json') && !cmd.input?.Body) {
        return {
          Body: {
            transformToString: async () => JSON.stringify({
              id: 'sub-001',
              formVersion: '2.0',
              patientInfo: 'Test Patient',
              language: 'english',
              responses: [],
              recommendations: [],
              productSelections: {},
              status: 'pending',
              submittedBy: 'agent-001',
              submittedAt: '2026-03-01T00:00:00Z',
            }),
          },
        };
      }
      return {};
    });

    const { updatePpdStatus } = await import('../services/ppdQueue');

    // pending → completed is invalid (must go through in_review)
    await expect(
      updatePpdStatus('sub-001', { status: 'completed', reviewedBy: 'admin' })
    ).rejects.toThrow('Invalid status transition: pending → completed');
  });

  it('allows valid transition pending → in_review', async () => {
    mockS3Send.mockImplementation(async (cmd: any) => {
      const key = cmd.input?.Key || '';
      if (key.includes('ppd-queue/') && key.endsWith('.json') && !cmd.input?.Body) {
        return {
          Body: {
            transformToString: async () => JSON.stringify({
              id: 'sub-002',
              formVersion: '2.0',
              patientInfo: 'Test Patient',
              language: 'english',
              responses: [],
              recommendations: [],
              productSelections: {},
              status: 'pending',
              submittedBy: 'agent-001',
              submittedAt: '2026-03-01T00:00:00Z',
            }),
          },
        };
      }
      // loadIndex returns entry for the update
      if (key.includes('ppd-queue-index') && !cmd.input?.Body) {
        return {
          Body: {
            transformToString: async () => JSON.stringify([
              { id: 'sub-002', status: 'pending', submittedBy: 'agent-001', submittedAt: '2026-03-01T00:00:00Z', recommendationCount: 0, patientInfo: 'Test Patient' },
            ]),
          },
        };
      }
      return {};
    });

    const { updatePpdStatus } = await import('../services/ppdQueue');
    const result = await updatePpdStatus('sub-002', { status: 'in_review', reviewedBy: 'reviewer-001' });

    expect(result).not.toBeNull();
    expect(result!.status).toBe('in_review');
    expect(result!.reviewedBy).toBe('reviewer-001');
  });
});
