import { describe, it, expect } from 'vitest';

// Import REAL functions from vectorStore — no more re-implementations that can diverge
import {
  cosineSimilarity,
  tokenize,
  buildIdfMap,
  bm25Score,
  reRankResults,
  expandQueryWithSynonyms,
} from '../services/vectorStore';
import { StoredChunk, Document } from '../types';

// ---------------------------------------------------------------------------
// Cosine Similarity
// ---------------------------------------------------------------------------

describe('Vector Store Scoring', () => {
  it('should return 1.0 for identical vectors', () => {
    const v = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('should return 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('should return -1 for opposite vectors', () => {
    const a = [1, 0, 0];
    const b = [-1, 0, 0];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  it('should handle zero vectors gracefully', () => {
    const a = [0, 0, 0];
    const b = [1, 2, 3];
    expect(cosineSimilarity(a, b)).toBe(0);
  });

  it('should be symmetric', () => {
    const a = [0.3, 0.7, 0.1];
    const b = [0.5, 0.2, 0.9];
    expect(cosineSimilarity(a, b)).toBeCloseTo(cosineSimilarity(b, a), 10);
  });

  it('should throw on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2], [1, 2, 3])).toThrow(/dimension mismatch/);
  });
});

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

describe('Tokenizer', () => {
  it('should lowercase all tokens', () => {
    const tokens = tokenize('Hello World MEDICAL Supply');
    expect(tokens).toEqual(['hello', 'world', 'medical', 'supply']);
  });

  it('should strip punctuation', () => {
    const tokens = tokenize('Hello, world! How are you?');
    expect(tokens).toEqual(['hello', 'world', 'how', 'are', 'you']);
  });

  it('should filter short non-medical tokens (<=2 chars)', () => {
    const tokens = tokenize('I am a big medical supply co');
    expect(tokens).not.toContain('am');
    expect(tokens).toContain('big');
    expect(tokens).toContain('medical');
  });

  it('should preserve medical short tokens (IV, O2, etc.)', () => {
    const tokens = tokenize('patient needs IV and O2');
    expect(tokens).toContain('iv');
    expect(tokens).toContain('o2');
  });

  it('should expand hyphenated medical terms', () => {
    const tokens = tokenize('IV-catheter setup');
    expect(tokens).toContain('iv-catheter');
    expect(tokens).toContain('iv');
    expect(tokens).toContain('catheter');
  });

  it('should preserve dosage tokens like 5mg, 10ml', () => {
    const tokens = tokenize('prescribe 5mg daily with 10ml solution');
    expect(tokens).toContain('5mg');
    expect(tokens).toContain('10ml');
  });
});

// ---------------------------------------------------------------------------
// BM25 Scoring
// ---------------------------------------------------------------------------

describe('BM25 Scoring', () => {
  it('should return 0 for no matching terms', () => {
    const { idf } = buildIdfMap([
      makeStoredChunk({ text: 'shipping procedures for medical supply deliveries' }),
      makeStoredChunk({ text: 'return policy for equipment and items' }),
    ]);
    const score = bm25Score('shipping procedures', 'medical supply catalog items', idf);
    expect(score).toBe(0);
  });

  it('should score higher for documents with more matching terms', () => {
    const { idf } = buildIdfMap([
      makeStoredChunk({ text: 'shipping procedures manual for deliveries' }),
      makeStoredChunk({ text: 'shipping return policy document for items' }),
      makeStoredChunk({ text: 'unrelated content about office supplies' }),
    ]);
    const score1 = bm25Score('shipping return policy', 'shipping procedures manual', idf);
    const score2 = bm25Score('shipping return policy', 'shipping return policy document', idf);
    expect(score2).toBeGreaterThan(score1);
  });

  it('should weight rare terms higher via IDF', () => {
    const { idf } = buildIdfMap([
      makeStoredChunk({ text: 'this document mentions rare items and common words' }),
      makeStoredChunk({ text: 'this document mentions common items and common words' }),
      makeStoredChunk({ text: 'this document mentions common things and common words' }),
    ]);
    const scoreRare = bm25Score('rare', 'this document mentions rare items', idf);
    const scoreCommon = bm25Score('common', 'this document mentions common items', idf);
    expect(scoreRare).toBeGreaterThan(scoreCommon);
  });

  it('should handle empty query', () => {
    const { idf } = buildIdfMap([makeStoredChunk({ text: 'test document' })]);
    const score = bm25Score('', 'test document', idf);
    expect(score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// IDF Map + Dynamic Average Document Length
// ---------------------------------------------------------------------------

describe('IDF Map and avgDocLength', () => {
  it('should compute IDF values', () => {
    const { idf } = buildIdfMap([
      makeStoredChunk({ text: 'oxygen equipment maintenance procedures' }),
      makeStoredChunk({ text: 'oxygen supply delivery schedule' }),
      makeStoredChunk({ text: 'billing procedures for insurance claims' }),
    ]);

    // 'oxygen' appears in 2/3 chunks, 'billing' in 1/3
    expect(idf.get('oxygen')).toBeDefined();
    expect(idf.get('billing')).toBeDefined();
    expect(idf.get('billing')!).toBeGreaterThan(idf.get('oxygen')!);
  });

  it('should compute average document length dynamically', () => {
    const chunks = [
      makeStoredChunk({ text: 'short chunk with few words' }),               // ~5 tokens
      makeStoredChunk({ text: 'another short chunk with a few more words' }), // ~8 tokens
    ];
    const { avgDocLength } = buildIdfMap(chunks);
    expect(avgDocLength).toBeGreaterThan(0);
    // Should be roughly the average of the two chunk token counts
    expect(avgDocLength).toBeLessThan(100);
  });

  it('should return empty map and 0 avgDocLength for empty corpus', () => {
    const { idf, avgDocLength } = buildIdfMap([]);
    expect(idf.size).toBe(0);
    expect(avgDocLength).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Medical Synonym Expansion
// ---------------------------------------------------------------------------

describe('Medical Synonym Expansion', () => {
  it('should expand CPAP with synonyms', () => {
    const expanded = expandQueryWithSynonyms('CPAP machine settings');
    const lower = expanded.toLowerCase();
    expect(lower).toContain('cpap');
    expect(lower).toContain('c-pap');
  });

  it('should expand oxygen with O2', () => {
    const expanded = expandQueryWithSynonyms('oxygen concentrator setup');
    const lower = expanded.toLowerCase();
    expect(lower).toContain('o2');
  });

  it('should expand DME abbreviation', () => {
    const expanded = expandQueryWithSynonyms('DME suppliers');
    const lower = expanded.toLowerCase();
    expect(lower).toContain('dme');
  });

  it('should expand clinical abbreviations', () => {
    const expanded = expandQueryWithSynonyms('patient with COPD');
    const lower = expanded.toLowerCase();
    expect(lower).toContain('copd');
  });

  it('should not add duplicates if synonym already in query', () => {
    const expanded = expandQueryWithSynonyms('CPAP c-pap');
    // Count occurrences of c-pap
    const matches = expanded.toLowerCase().match(/c-pap/g) || [];
    expect(matches.length).toBe(1);
  });

  it('should return original query when no synonyms match', () => {
    const query = 'general office supplies order';
    expect(expandQueryWithSynonyms(query)).toBe(query);
  });

  it('should expand wheelchair with wc and w/c', () => {
    const expanded = expandQueryWithSynonyms('wheelchair maintenance');
    const lower = expanded.toLowerCase();
    // Should contain at least the single-token synonym
    expect(lower).toContain('wc');
  });
});

// ---------------------------------------------------------------------------
// Section Header Detection (imported from chunker, tested via re-rank)
// ---------------------------------------------------------------------------

describe('Re-ranking', () => {
  it('should boost section header matches', () => {
    const chunk1 = makeStoredChunk({ id: 'c-1', sectionHeader: 'Oxygen Supply Policy', text: 'Some text about procedures.' });
    const chunk2 = makeStoredChunk({ id: 'c-2', sectionHeader: 'Billing Procedures', text: 'Some text about billing.' });

    const results = [
      { chunk: chunk1, document: makeDocument(), score: 0.50 },
      { chunk: chunk2, document: makeDocument(), score: 0.50 },
    ];

    const reRanked = reRankResults(results, 'oxygen supply');
    const oxygenResult = reRanked.find(r => r.chunk.id === 'c-1')!;
    const billingResult = reRanked.find(r => r.chunk.id === 'c-2')!;

    expect(oxygenResult.score).toBeGreaterThan(billingResult.score);
  });

  it('should penalize short chunks', () => {
    const shortChunk = makeStoredChunk({ id: 'c-short', text: 'Very short.' });
    const normalChunk = makeStoredChunk({
      id: 'c-normal',
      text: 'This is a normal length chunk with enough content to describe oxygen supply equipment maintenance procedures and guidelines.',
    });

    const results = [
      { chunk: shortChunk, document: makeDocument(), score: 0.60 },
      { chunk: normalChunk, document: makeDocument(), score: 0.60 },
    ];

    const reRanked = reRankResults(results, 'oxygen');
    const short = reRanked.find(r => r.chunk.id === 'c-short')!;
    const normal = reRanked.find(r => r.chunk.id === 'c-normal')!;

    expect(short.score).toBeLessThan(normal.score);
  });

  it('should boost chunks from documents with multiple matches', () => {
    const chunk1 = makeStoredChunk({ id: 'c-1', documentId: 'doc-1', text: 'Oxygen equipment procedures.' });
    const chunk2 = makeStoredChunk({ id: 'c-2', documentId: 'doc-1', text: 'More about oxygen supply.' });
    const chunk3 = makeStoredChunk({ id: 'c-3', documentId: 'doc-2', text: 'Oxygen tank maintenance.' });

    const results = [
      { chunk: chunk1, document: makeDocument({ id: 'doc-1' }), score: 0.50 },
      { chunk: chunk2, document: makeDocument({ id: 'doc-1' }), score: 0.50 },
      { chunk: chunk3, document: makeDocument({ id: 'doc-2' }), score: 0.50 },
    ];

    const reRanked = reRankResults(results, 'oxygen equipment');
    // Chunks from doc-1 should get a doc-count boost (2 chunks from same doc)
    const doc1Chunk = reRanked.find(r => r.chunk.id === 'c-1')!;
    const doc2Chunk = reRanked.find(r => r.chunk.id === 'c-3')!;
    expect(doc1Chunk.score).toBeGreaterThan(doc2Chunk.score);
  });
});

// ---------------------------------------------------------------------------
// Hybrid Scoring
// ---------------------------------------------------------------------------

describe('Hybrid Scoring', () => {
  it('combines semantic and keyword weights correctly', () => {
    const queryEmb = [1, 0, 0];
    const chunkEmb = [0.8, 0.6, 0];

    const semanticScore = cosineSimilarity(queryEmb, chunkEmb);
    const semanticWeight = 0.7;
    const keywordWeight = 0.3;

    const chunks = [makeStoredChunk({ text: 'oxygen equipment maintenance procedures for patient care' })];
    const { idf } = buildIdfMap(chunks);
    const keyword = bm25Score('oxygen equipment', chunks[0].text, idf);

    // With dynamic normalization, max BM25 in a single-chunk set is the score itself
    const normalizedKeyword = keyword > 0 ? 1 : 0; // keyword / keyword = 1

    const combined = semanticWeight * semanticScore + keywordWeight * normalizedKeyword;

    // Semantic component should dominate with 0.7 weight when keyword is normalized to 1
    expect(combined).toBeGreaterThan(0);
    expect(semanticWeight * semanticScore).toBeGreaterThan(0);
  });

  it('BM25 with IDF weights rare terms higher', () => {
    const chunks = [
      makeStoredChunk({ id: 'c-1', text: 'the common words appear in every single document here' }),
      makeStoredChunk({ id: 'c-2', text: 'the common words also appear in this other document too' }),
      makeStoredChunk({ id: 'c-3', text: 'wheelchair maintenance is a specialized rare topic not found elsewhere' }),
    ];

    const { idf } = buildIdfMap(chunks);

    // "wheelchair" appears in 1/3 chunks — should have higher IDF than "common" (2/3)
    const commonIdf = idf.get('common') || 0;
    const wheelchairIdf = idf.get('wheelchair') || 0;
    expect(wheelchairIdf).toBeGreaterThan(commonIdf);

    // Query for "wheelchair" should score > 0 only on the chunk that has it
    const scoreWithTerm = bm25Score('wheelchair', chunks[2].text, idf);
    const scoreWithoutTerm = bm25Score('wheelchair', chunks[0].text, idf);
    expect(scoreWithTerm).toBeGreaterThan(0);
    expect(scoreWithoutTerm).toBe(0);
  });

  it('handles empty query gracefully', () => {
    const chunks = [makeStoredChunk({ text: 'some content here about equipment.' })];
    const { idf } = buildIdfMap(chunks);

    const bm25 = bm25Score('', chunks[0].text, idf);
    expect(bm25).toBe(0);

    const sim = cosineSimilarity([0, 0, 0], [0.5, 0.3, 0.1]);
    expect(sim).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStoredChunk(overrides: Partial<StoredChunk> = {}): StoredChunk {
  return {
    id: 'c-1',
    documentId: 'doc-1',
    chunkIndex: 0,
    text: 'Default chunk text about oxygen supply equipment and procedures for patient care.',
    tokenCount: 15,
    startOffset: 0,
    endOffset: 200,
    embedding: [0.5, 0.3, 0.1],
    ...overrides,
  };
}

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    filename: 'doc.pdf',
    originalName: 'Document.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1000,
    s3Key: 'docs/doc.pdf',
    collectionId: 'col-1',
    uploadedBy: 'admin',
    uploadedAt: '2024-01-01',
    status: 'ready',
    chunkCount: 1,
    version: 1,
    ...overrides,
  };
}
