import { describe, it, expect, vi, beforeEach } from 'vitest';

const s3Store = new Map<string, string>();
const deleted: string[] = [];

class FakePutObjectCommand {
  readonly _type = 'Put';
  constructor(public input: { Bucket: string; Key: string; Body: string }) {}
}
class FakeGetObjectCommand {
  readonly _type = 'Get';
  constructor(public input: { Bucket: string; Key: string }) {}
}
class FakeDeleteObjectCommand {
  readonly _type = 'Delete';
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
  if (cmd._type === 'Delete') {
    deleted.push(cmd.input.Key);
    s3Store.delete(cmd.input.Key);
    return {};
  }
  return {};
});

vi.mock('@aws-sdk/client-s3', () => ({
  PutObjectCommand: FakePutObjectCommand,
  GetObjectCommand: FakeGetObjectCommand,
  DeleteObjectCommand: FakeDeleteObjectCommand,
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

describe('formDrafts service', () => {
  beforeEach(() => {
    s3Store.clear();
    deleted.length = 0;
    mockSend.mockClear();
  });

  it('creates a new draft and lists it for the owner', async () => {
    const { upsertDraft, listDrafts } = await import('../services/formDrafts');
    const rec = await upsertDraft({
      formType: 'ppd',
      payload: { q1: 'yes', q2: 'no' },
      label: 'Jane Doe / Trx-1234',
      completionPercent: 10,
      userId: 'user-a',
    });
    expect(rec.id).toBeTruthy();
    expect(rec.createdAt).toBe(rec.updatedAt);

    const drafts = await listDrafts({ userId: 'user-a' });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe(rec.id);
    expect(drafts[0].label).toBe('Jane Doe / Trx-1234');
    expect(drafts[0].completionPercent).toBe(10);
  });

  it('updates in place when id is provided and preserves createdAt', async () => {
    const { upsertDraft, getDraft } = await import('../services/formDrafts');
    const first = await upsertDraft({
      formType: 'ppd',
      payload: { q1: 'yes' },
      userId: 'user-a',
      completionPercent: 5,
    });

    await new Promise(r => setTimeout(r, 5));
    const second = await upsertDraft({
      id: first.id,
      formType: 'ppd',
      payload: { q1: 'yes', q2: 'no' },
      userId: 'user-a',
      completionPercent: 40,
    });

    expect(second.id).toBe(first.id);
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt >= first.updatedAt).toBe(true);

    const loaded = await getDraft('user-a', 'ppd', first.id);
    expect(loaded?.completionPercent).toBe(40);
    expect((loaded?.payload as Record<string, unknown>).q2).toBe('no');
  });

  it('hides drafts from other non-admin users', async () => {
    const { upsertDraft, listDrafts, getDraft } = await import('../services/formDrafts');
    const aRec = await upsertDraft({
      formType: 'pmd-account',
      payload: {},
      userId: 'user-a',
    });

    // User B has no drafts of their own and cannot enumerate user A's
    const bDrafts = await listDrafts({ userId: 'user-b' });
    expect(bDrafts).toHaveLength(0);

    // User B cannot load user A's draft through the service (route also checks)
    const viaB = await getDraft('user-b', 'pmd-account', aRec.id);
    expect(viaB).toBeNull();
  });

  it('admin view returns all drafts across users', async () => {
    const { upsertDraft, listDrafts } = await import('../services/formDrafts');
    await upsertDraft({ formType: 'ppd', payload: {}, userId: 'user-a' });
    await upsertDraft({ formType: 'pap-account', payload: {}, userId: 'user-b' });

    const all = await listDrafts({ userId: 'admin', adminView: true });
    expect(all).toHaveLength(2);

    const onlyPpd = await listDrafts({ userId: 'admin', adminView: true, formType: 'ppd' });
    expect(onlyPpd).toHaveLength(1);
    expect(onlyPpd[0].formType).toBe('ppd');
  });

  it('discardDraft removes S3 object and index entry', async () => {
    const { upsertDraft, discardDraft, listDrafts, getDraft } = await import('../services/formDrafts');
    const rec = await upsertDraft({ formType: 'ppd', payload: { q: 1 }, userId: 'user-a' });

    const removed = await discardDraft('user-a', 'ppd', rec.id);
    expect(removed).toBe(true);

    const drafts = await listDrafts({ userId: 'user-a' });
    expect(drafts).toHaveLength(0);
    const loaded = await getDraft('user-a', 'ppd', rec.id);
    expect(loaded).toBeNull();
  });

  it('discardDraft is idempotent on missing id', async () => {
    const { discardDraft } = await import('../services/formDrafts');
    const removed = await discardDraft('user-a', 'ppd', 'does-not-exist');
    expect(removed).toBe(false);
  });

  it('rejects oversized payloads', async () => {
    const { upsertDraft } = await import('../services/formDrafts');
    const bigPayload = { blob: 'x'.repeat(3 * 1024 * 1024) };
    await expect(upsertDraft({
      formType: 'ppd',
      payload: bigPayload,
      userId: 'user-a',
    })).rejects.toThrow(/exceeds/i);
  });

  it('validates form type via isValidFormType', async () => {
    const { isValidFormType } = await import('../services/formDrafts');
    expect(isValidFormType('ppd')).toBe(true);
    expect(isValidFormType('pmd-account')).toBe(true);
    expect(isValidFormType('pap-account')).toBe(true);
    expect(isValidFormType('evil')).toBe(false);
    expect(isValidFormType(42)).toBe(false);
    expect(isValidFormType(undefined)).toBe(false);
  });
});
