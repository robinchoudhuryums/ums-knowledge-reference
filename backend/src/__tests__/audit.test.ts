import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture entries written via PutObjectCommand
const writtenEntries: any[] = [];
const mockSend = vi.fn();

// Command constructors that preserve their input so mockSend can inspect it
class FakePutObjectCommand {
  readonly _type = 'Put';
  constructor(public input: any) {}
}
class FakeGetObjectCommand {
  readonly _type = 'Get';
  constructor(public input: any) {}
}
class FakeListObjectsV2Command {
  readonly _type = 'List';
  constructor(public input: any) {}
}

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: FakePutObjectCommand,
  GetObjectCommand: FakeGetObjectCommand,
  ListObjectsV2Command: FakeListObjectsV2Command,
  S3Client: vi.fn(),
}));

// Mock database — audit chain DB coordination should fall back to in-process
vi.mock('../config/database', () => ({
  checkDatabaseConnection: vi.fn(async () => false),
  getPool: vi.fn(() => null),
  closeDatabasePool: vi.fn(async () => {}),
}));

vi.mock('../config/aws', () => ({
  s3Client: { send: (...args: unknown[]) => mockSend(...args) },
  S3_BUCKET: 'test-bucket',
  S3_PREFIXES: {
    audit: 'audit/',
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('Audit Service', () => {
  beforeEach(() => {
    writtenEntries.length = 0;
    mockSend.mockReset();
    mockSend.mockImplementation(async (command: any) => {
      if (command._type === 'Put') {
        const body = command.input?.Body;
        if (body) {
          writtenEntries.push(JSON.parse(body));
        }
      }
      return {};
    });
    // Reset module-level lastEntryHash between tests
    vi.resetModules();
  });

  async function getAuditModule() {
    return await import('../services/audit');
  }

  it('should create an entry with correct fields', async () => {
    const { logAuditEvent } = await getAuditModule();

    await logAuditEvent('user-1', 'testuser', 'login', { ip: '10.0.0.1' });

    expect(writtenEntries).toHaveLength(1);
    const entry = writtenEntries[0];
    expect(entry.id).toBeDefined();
    expect(typeof entry.id).toBe('string');
    expect(entry.timestamp).toBeDefined();
    expect(entry.userId).toBe('user-1');
    expect(entry.username).toBe('testuser');
    expect(entry.action).toBe('login');
    expect(entry.details).toEqual({ ip: '10.0.0.1' });
    expect(entry.previousHash).toBeDefined();
    expect(entry.entryHash).toBeDefined();
  });

  it('should redact PHI in string detail values', async () => {
    const { logAuditEvent } = await getAuditModule();

    await logAuditEvent('user-1', 'testuser', 'query', {
      question: 'Patient SSN is 123-45-6789',
      count: 5,
    });

    expect(writtenEntries).toHaveLength(1);
    const entry = writtenEntries[0];
    // SSN should be redacted (phiRedactor uses [SSN] tag)
    expect(entry.details.question).not.toContain('123-45-6789');
    expect(entry.details.question).toContain('[SSN]');
    // Non-string values should be unchanged
    expect(entry.details.count).toBe(5);
  });

  it('should link sequential events via previousHash to entryHash', async () => {
    const { logAuditEvent } = await getAuditModule();

    await logAuditEvent('user-1', 'testuser', 'login', { ip: '10.0.0.1' });
    await logAuditEvent('user-1', 'testuser', 'query', { question: 'test' });

    expect(writtenEntries).toHaveLength(2);
    const first = writtenEntries[0];
    const second = writtenEntries[1];
    // The second entry's previousHash should equal the first entry's entryHash
    expect(second.previousHash).toBe(first.entryHash);
    // First entry should reference GENESIS
    expect(first.previousHash).toBe('GENESIS');
  });

  it('should produce a valid SHA-256 hex string for entryHash', async () => {
    const { logAuditEvent } = await getAuditModule();

    await logAuditEvent('user-1', 'testuser', 'login', { ip: '10.0.0.1' });

    expect(writtenEntries).toHaveLength(1);
    const entry = writtenEntries[0];
    // SHA-256 hex is exactly 64 hex characters
    expect(entry.entryHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('should verify a clean audit chain as valid', async () => {
    const { logAuditEvent, verifyAuditChain } = await getAuditModule();

    // Write two entries to build a chain
    await logAuditEvent('user-1', 'testuser', 'login', { ip: '10.0.0.1' });
    await logAuditEvent('user-1', 'testuser', 'query', { question: 'test' });

    // Now set up mockSend to serve these entries for verification
    const entries = [...writtenEntries];
    mockSend.mockReset();
    mockSend.mockImplementation(async (command: any) => {
      if (command._type === 'List') {
        return {
          Contents: entries.map((e: any) => ({ Key: `audit/2026-03-27/${e.id}.json` })),
        };
      }
      if (command._type === 'Get') {
        const id = command.input.Key.split('/').pop()?.replace('.json', '');
        const entry = entries.find((e: any) => e.id === id);
        return {
          Body: {
            transformToString: async () => JSON.stringify(entry),
          },
        };
      }
      return {};
    });

    const result = await verifyAuditChain('2026-03-27');
    expect(result.valid).toBe(true);
    expect(result.totalEntries).toBe(2);
  });
});
