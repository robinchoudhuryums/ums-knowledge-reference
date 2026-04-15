/**
 * Full-lifecycle ingestion test (S2-2).
 *
 * Unlike ingestion.test.ts, this test does NOT mock the chunker, so we
 * actually exercise chunkDocument against a real multi-paragraph text
 * and assert:
 *   - Chunks are produced and handed to addChunksToStore
 *   - Content-hash dedup rejects a second upload of identical content
 *   - Rollback removes chunks when a downstream step fails after chunks
 *     have already been written to the store (INV-07)
 *   - The documents index is updated under the mutex (status transitions)
 *
 * External boundaries (S3, Bedrock, vision) are stubbed because the test
 * is about ingestion coordination, not AWS integration.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Stateful in-memory stubs ────────────────────────────────────────────────

const docsIndex: Array<Record<string, unknown>> = [];
const storedChunks: Array<{ id: string; documentId: string; text: string }> = [];

vi.mock('../services/s3Storage', () => ({
  getDocumentsIndex: vi.fn(async () => docsIndex.map(d => ({ ...d }))),
  saveDocumentsIndex: vi.fn(async (docs: Array<Record<string, unknown>>) => {
    docsIndex.length = 0;
    docsIndex.push(...docs.map(d => ({ ...d })));
  }),
  uploadDocumentToS3: vi.fn(async () => {}),
}));

vi.mock('../services/textExtractor', () => ({
  extractText: vi.fn(async () => ({
    text:
      // Enough text to force multiple real chunks
      ('Medicare covers durable medical equipment when prescribed by a physician. ').repeat(40) +
      '\n\n' +
      ('Power mobility devices require a face-to-face exam and a 7-element order. ').repeat(40),
  })),
}));

vi.mock('../services/visionExtractor', () => ({
  extractImageDescriptions: vi.fn(async () => ''),
}));

vi.mock('../services/embeddings', () => ({
  generateEmbeddingsBatch: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2])),
}));

vi.mock('../services/vectorStore', () => ({
  addChunksToStore: vi.fn(async (chunks: Array<{ id: string; documentId: string; text: string }>) => {
    storedChunks.push(...chunks.map(c => ({ id: c.id, documentId: c.documentId, text: c.text })));
  }),
  removeDocumentChunks: vi.fn(async (documentId: string) => {
    // Filter in-place to simulate real deletion
    for (let i = storedChunks.length - 1; i >= 0; i--) {
      if (storedChunks[i].documentId === documentId) storedChunks.splice(i, 1);
    }
  }),
}));

vi.mock('../services/audit', () => ({
  logAuditEvent: vi.fn(async () => {}),
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../utils/stripMetadata', () => ({
  stripImageMetadata: vi.fn(async (buffer: Buffer) => ({
    buffer,
    stripped: false,
    metadataFound: false,
    originalSize: buffer.length,
    strippedSize: buffer.length,
  })),
}));

vi.mock('../utils/traceSpan', () => ({
  withSpan: vi.fn(async <T>(_name: string, _attrs: unknown, fn: () => Promise<T>) => fn()),
}));

// RDS path disabled so embedding-reuse lookup no-ops
vi.mock('../db/index', () => ({
  useRds: vi.fn(async () => false),
}));

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Ingestion — full lifecycle (S2-2)', () => {
  beforeEach(() => {
    docsIndex.length = 0;
    storedChunks.length = 0;
    vi.clearAllMocks();
  });

  it('produces multiple real chunks and writes them to the vector store', async () => {
    const { ingestDocument } = await import('../services/ingestion');

    const buf = Buffer.from('pretend-pdf-bytes-1');
    const result = await ingestDocument(buf, 'coverage-guide.pdf', 'application/pdf', 'col-lcd', 'alice');

    expect(result.chunkCount).toBeGreaterThan(1);
    expect(storedChunks.length).toBe(result.chunkCount);
    expect(storedChunks.every(c => c.documentId === result.document.id)).toBe(true);
    expect(docsIndex).toHaveLength(1);
    expect(docsIndex[0].status).toBe('ready');
    expect(docsIndex[0].contentHash).toBeDefined();
  });

  it('rejects a second upload with identical content hash in the same collection (INV-08)', async () => {
    const { ingestDocument } = await import('../services/ingestion');

    const buf = Buffer.from('exact-same-bytes');
    await ingestDocument(buf, 'v1.pdf', 'application/pdf', 'col-a', 'alice');

    const chunkCountAfterFirst = storedChunks.length;
    expect(chunkCountAfterFirst).toBeGreaterThan(0);

    // Second upload of IDENTICAL content under a different filename but same collection
    await expect(
      ingestDocument(buf, 'v2-rename.pdf', 'application/pdf', 'col-a', 'alice'),
    ).rejects.toThrow(/identical content/i);

    // Dedup path must not have left extra chunks in the store
    expect(storedChunks.length).toBe(chunkCountAfterFirst);

    // And only one non-error document should exist in the index
    const readyDocs = docsIndex.filter(d => d.status === 'ready');
    expect(readyDocs).toHaveLength(1);
  });

  it('rolls back chunks when a downstream failure happens after chunks were stored (INV-07)', async () => {
    // Arrange: pretend one document already exists in the index so the
    // ingestion takes the "existing version" path. We then make
    // saveDocumentsIndex throw on the FIRST save inside the lock, which
    // happens after addChunksToStore has already run.
    const s3 = await import('../services/s3Storage');
    const originalSave = s3.saveDocumentsIndex;

    let failOnce = true;
    (s3.saveDocumentsIndex as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      if (failOnce) {
        failOnce = false;
        throw new Error('simulated S3 save failure');
      }
    });

    const { ingestDocument } = await import('../services/ingestion');

    const buf = Buffer.from('will-fail-midflight');
    await expect(
      ingestDocument(buf, 'fail.pdf', 'application/pdf', 'col-rb', 'alice'),
    ).rejects.toThrow(/simulated S3 save failure/);

    // Assert rollback: no leftover chunks for the failed document
    expect(storedChunks.filter(c => c.documentId && c.documentId.startsWith('doc'))).toHaveLength(0);
    // storedChunks may still have ANY unrelated items — but there should be none.
    expect(storedChunks.length).toBe(0);

    // And the failed document should be recorded in the index as 'error'
    expect(docsIndex.some(d => d.status === 'error')).toBe(true);

    // Restore original for the next test
    (s3.saveDocumentsIndex as unknown as ReturnType<typeof vi.fn>).mockImplementation(originalSave);
  });
});
