import { StoredChunk, VectorStoreIndex, SearchResult, Document, DocumentChunk } from '../types';
import { saveVectorIndex, loadVectorIndex, getDocumentsIndex } from './s3Storage';
import { getEmbeddingProvider } from './embeddings';
import { useRds, dbAddChunks, dbRemoveDocumentChunks, dbSearchVectorStore, dbSearchChunksByKeyword, dbGetVectorStoreStats } from '../db';
import { logger } from '../utils/logger';
import { crossEncoderRerank, isCrossEncoderEnabled } from './crossEncoderRerank';

// In-memory cache of the vector index for fast search
let cachedIndex: VectorStoreIndex | null = null;

// Initialization lock to prevent concurrent initializeVectorStore() calls
let initPromise: Promise<void> | null = null;

// IDF cache — rebuilt when index changes.
// Uses a version counter (incremented on every add/remove) instead of chunk count,
// so the cache is correctly invalidated even when a delete+add results in the same count.
let idfCache: Map<string, number> | null = null;
let idfVersion = 0;
let currentIdfVersion = -1;

// Corpus-level average document (chunk) length in tokens, computed alongside IDF.
// Used by BM25 for length normalization instead of a hardcoded constant.
let cachedAvgDocLength = 0;

// Incremental IDF support: maintain running doc-frequency counts and total tokens
// so we can update IDF without scanning all chunks on every add/remove.
// These are populated on initial build and updated incrementally thereafter.
let docFreqCounts: Map<string, number> | null = null;
let totalCorpusTokens = 0;
let corpusChunkCount = 0;

// Tracks whether the stored embeddings use a different model/dimension than the
// current provider. Set during initializeVectorStore(), exposed via getVectorStoreStats().
let embeddingModelMismatch: { stored: string; current: string; storedDims: number; currentDims: number } | null = null;

// ---------------------------------------------------------------------------
// Medical synonym map for query expansion.
// When a user searches for one form, we also match the other forms.
// This improves BM25 recall for domain-specific abbreviations and aliases.
// Each key maps to its known synonyms/aliases (bidirectional).
// ---------------------------------------------------------------------------
const MEDICAL_SYNONYMS: ReadonlyMap<string, readonly string[]> = new Map([
  // Equipment synonyms
  ['wheelchair', ['wc', 'w/c', 'power wheelchair', 'manual wheelchair']],
  ['cpap', ['continuous positive airway pressure', 'c-pap']],
  ['bipap', ['bilevel', 'bi-pap', 'bilevel positive airway pressure', 'bpap']],
  ['oxygen', ['o2', 'supplemental oxygen']],
  ['concentrator', ['oxygen concentrator', 'poc', 'portable oxygen concentrator']],
  ['nebulizer', ['neb', 'aerosol therapy']],
  ['catheter', ['cath', 'foley', 'intermittent catheter', 'straight cath']],
  ['hospital bed', ['semi-electric bed', 'full-electric bed']],
  ['walker', ['rollator', 'rolling walker']],
  ['scooter', ['pov', 'power operated vehicle', 'mobility scooter']],
  ['pmd', ['power mobility device', 'power wheelchair', 'power chair']],
  ['ventilator', ['vent', 'mechanical ventilation', 'life support']],
  ['suction', ['suction machine', 'aspirator']],
  ['commode', ['bedside commode', 'bsc', '3-in-1 commode']],
  ['lift', ['patient lift', 'hoyer lift', 'hoyer']],
  ['tens', ['tens unit', 'transcutaneous electrical nerve stimulation']],
  ['cane', ['quad cane', 'straight cane']],
  ['crutches', ['forearm crutches', 'axillary crutches']],
  ['trapeze', ['bed trapeze', 'overhead trapeze']],
  ['mattress', ['pressure mattress', 'alternating pressure', 'overlay']],
  ['mask', ['nasal mask', 'full face mask', 'nasal pillow']],
  ['tubing', ['oxygen tubing', 'cpap tubing', 'circuit']],
  ['humidifier', ['heated humidifier', 'hme']],

  // Clinical abbreviations
  ['copd', ['chronic obstructive pulmonary disease']],
  ['chf', ['congestive heart failure', 'heart failure']],
  ['osa', ['obstructive sleep apnea', 'sleep apnea']],
  ['als', ['amyotrophic lateral sclerosis', 'lou gehrig']],
  ['cva', ['cerebrovascular accident', 'stroke']],
  ['dvt', ['deep vein thrombosis']],
  ['uti', ['urinary tract infection']],
  ['bmi', ['body mass index']],
  ['ard', ['acute respiratory distress']],
  ['ms', ['multiple sclerosis']],
  ['sci', ['spinal cord injury']],
  ['tbi', ['traumatic brain injury']],
  ['esrd', ['end stage renal disease', 'dialysis']],
  ['iddm', ['insulin dependent diabetes']],
  ['niddm', ['non-insulin dependent diabetes']],
  ['cab', ['coronary artery bypass']],
  ['afib', ['atrial fibrillation', 'a-fib']],
  ['pe', ['pulmonary embolism']],
  ['ra', ['rheumatoid arthritis']],
  ['oa', ['osteoarthritis']],

  // DME industry / billing terms
  ['abn', ['advance beneficiary notice']],
  ['cmn', ['certificate of medical necessity']],
  ['lcd', ['local coverage determination']],
  ['dme', ['durable medical equipment']],
  ['hme', ['home medical equipment']],
  ['snf', ['skilled nursing facility']],
  ['alf', ['assisted living facility']],
  ['f2f', ['face to face', 'face-to-face']],
  ['spo2', ['oxygen saturation', 'pulse oximetry', 'pulse ox']],
  ['abg', ['arterial blood gas']],
  ['pft', ['pulmonary function test', 'spirometry']],
  ['lmn', ['lifelong medical necessity']],
  ['dmrc', ['dme regional carrier', 'dme mac']],
  ['cba', ['competitive bidding area']],
  ['aob', ['assignment of benefits']],
  ['eob', ['explanation of benefits']],
  ['par', ['participating provider']],
  ['npi', ['national provider identifier']],
  ['ptan', ['provider transaction access number']],
  ['mbi', ['medicare beneficiary identifier']],
  ['hicn', ['health insurance claim number']],
  ['adl', ['activities of daily living']],
  ['mradl', ['mobility related activities of daily living']],

  // Billing/insurance terms
  ['prior auth', ['prior authorization', 'pa']],
  ['prior authorization', ['prior auth', 'pa']],
  ['deductible', ['ded']],
  ['coinsurance', ['coins']],
  ['allowable', ['allowed amount', 'fee schedule']],
  ['denial', ['denied', 'claim denial', 'rejected']],
  ['appeal', ['redetermination', 'reconsideration']],
  ['modifier', ['hcpcs modifier', 'cpt modifier']],
]);

// Build reverse lookup: for any synonym, find its group
const synonymIndex = new Map<string, string[]>();
for (const [key, synonyms] of MEDICAL_SYNONYMS) {
  const group = [key, ...synonyms];
  for (const term of group) {
    const lower = term.toLowerCase();
    if (!synonymIndex.has(lower)) {
      synonymIndex.set(lower, []);
    }
    // Add all OTHER terms in the group
    for (const other of group) {
      const otherLower = other.toLowerCase();
      if (otherLower !== lower && !synonymIndex.get(lower)!.includes(otherLower)) {
        synonymIndex.get(lower)!.push(otherLower);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Query type classification — determines adaptive semantic/keyword weighting.
// Medical code lookups (HCPCS, ICD-10) need strong keyword matching, while
// symptom/condition queries need strong semantic understanding.
// ---------------------------------------------------------------------------
export type QueryType = 'code_lookup' | 'coverage_question' | 'general';

export function classifyQuery(query: string): QueryType {
  const upper = query.toUpperCase();
  // HCPCS codes (E1234, K0813, L0631, A4253) or ICD-10 codes (J44.1, G12.21, M54.5)
  if (/\b[AEHJKLM]\d{4}\b/.test(upper) || /\b[A-Z]\d{2}\.\d{1,4}\b/.test(upper)) {
    return 'code_lookup';
  }
  // Coverage/policy questions
  const coverageTerms = /\b(coverage|cover|covered|criteria|lcd|policy|medical necessity|prior auth|documentation required|qualify|eligible)\b/i;
  if (coverageTerms.test(query)) {
    return 'coverage_question';
  }
  return 'general';
}

/**
 * Get adaptive semantic/keyword weights based on query type.
 * - Code lookups: favor keyword matching (exact code matches matter most)
 * - Coverage questions: balanced (need both exact terms and semantic context)
 * - General: favor semantic (natural language understanding)
 */
export function getAdaptiveWeights(queryType: QueryType): { semantic: number; keyword: number } {
  switch (queryType) {
    case 'code_lookup':
      return { semantic: 0.4, keyword: 0.6 };
    case 'coverage_question':
      return { semantic: 0.55, keyword: 0.45 };
    case 'general':
    default:
      return { semantic: 0.7, keyword: 0.3 };
  }
}

/**
 * Expand a query with medical synonyms.
 * Returns the original query with synonym terms appended, boosting BM25 recall.
 * Only single-token synonyms are appended (multi-word synonyms help via the
 * original query's semantic embedding, not keyword matching).
 */
export function expandQueryWithSynonyms(query: string): string {
  const lower = query.toLowerCase();
  const expansions: string[] = [];

  for (const [term, synonyms] of synonymIndex) {
    // Check if the term appears as a whole word in the query
    const pattern = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (pattern.test(lower)) {
      for (const syn of synonyms) {
        // Only add single-token synonyms to avoid noise
        if (!syn.includes(' ') && !lower.includes(syn)) {
          expansions.push(syn);
        }
      }
    }
  }

  if (expansions.length === 0) return query;
  return `${query} ${expansions.join(' ')}`;
}

/**
 * Compute cosine similarity between two vectors.
 * Exported for testing — allows tests to use the real implementation
 * instead of re-implementing the algorithm (which risks divergence).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}

/**
 * Tokenize text into terms for BM25 scoring.
 * Preserves hyphenated terms (e.g. "IV-catheter", "bi-level", "CPAP-related")
 * as both the compound term and individual parts to improve medical term recall.
 * Short medical tokens (IV, O2, HR, etc.) are preserved even though they are <= 2 chars.
 *
 * Exported for testing.
 */

// Short tokens that are medically significant and must not be filtered out.
// These would normally be dropped by the length > 2 filter.
const MEDICAL_SHORT_TOKENS = new Set([
  'iv', 'o2', 'hr', 'bp', 'bm', 'gi', 'ue', 'le', 'rx', 'pt', 'ot',
  'ed', 'er', 'or', 'ic', 'im', 'sq', 'po', 'pr', 'mg', 'ml', 'kg',
  'lb', 'cm', 'mm', 'cc', 'dl', 'os', 'od', 'ou', 'ac', 'pc', 'hs',
  'bi', 'ct', 'mr', 'us',
]);

// Pattern for dosage tokens like "5mg", "10ml", "2l" — number + unit
const DOSAGE_PATTERN = /^\d+(?:mg|ml|kg|lb|cc|dl|mm|cm|mcg|iu|l)$/;

export function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    // Remove punctuation except hyphens between word characters
    .replace(/[^\w\s-]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = normalized.split(/\s+/).filter(Boolean);

  // For hyphenated terms, emit both the compound and the parts
  // e.g. "iv-catheter" => ["iv-catheter", "iv", "catheter"]
  const tokens: string[] = [];
  for (const token of rawTokens) {
    // Strip leading/trailing hyphens
    const clean = token.replace(/^-+|-+$/g, '');
    if (!clean) continue;

    // Keep short tokens if they are medically significant or dosages
    const isShortMedical = clean.length <= 2 && (
      MEDICAL_SHORT_TOKENS.has(clean) || DOSAGE_PATTERN.test(clean)
    );

    if (clean.length <= 2 && !isShortMedical) continue;

    tokens.push(clean);
    if (clean.includes('-')) {
      for (const part of clean.split('-')) {
        if (part.length > 2 || MEDICAL_SHORT_TOKENS.has(part) || DOSAGE_PATTERN.test(part)) {
          tokens.push(part);
        }
      }
    }
  }

  return tokens;
}

/**
 * Build IDF (Inverse Document Frequency) map from the corpus.
 * IDF(term) = ln((N - df + 0.5) / (df + 0.5) + 1)
 * Also computes the average document (chunk) length in tokens for BM25 normalization.
 * Populates the running docFreq counts for incremental updates.
 */
export function buildIdfMap(chunks: StoredChunk[]): { idf: Map<string, number>; avgDocLength: number } {
  const N = chunks.length;
  if (N === 0) {
    docFreqCounts = new Map();
    totalCorpusTokens = 0;
    corpusChunkCount = 0;
    return { idf: new Map(), avgDocLength: 0 };
  }

  const docFreq = new Map<string, number>();
  let totalTokens = 0;

  for (const chunk of chunks) {
    const terms = tokenize(chunk.text);
    totalTokens += terms.length;
    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  // Store running counts for incremental updates
  docFreqCounts = docFreq;
  totalCorpusTokens = totalTokens;
  corpusChunkCount = N;

  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }

  return { idf, avgDocLength: totalTokens / N };
}

/**
 * Compute IDF values from the running docFreq counts.
 * O(vocabulary) instead of O(chunks) — much faster after initial build.
 */
function recomputeIdfFromCounts(): Map<string, number> {
  const idf = new Map<string, number>();
  if (!docFreqCounts || corpusChunkCount === 0) return idf;
  const N = corpusChunkCount;
  for (const [term, df] of docFreqCounts) {
    if (df > 0) {
      idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }
  }
  return idf;
}

/**
 * Incrementally update IDF stats when chunks are added.
 * Avoids scanning the entire corpus — only processes the new chunks.
 */
function incrementalIdfAdd(newChunks: StoredChunk[]): void {
  if (!docFreqCounts) return; // No initial build yet — will do full build on first search

  for (const chunk of newChunks) {
    const terms = tokenize(chunk.text);
    totalCorpusTokens += terms.length;
    corpusChunkCount++;
    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      docFreqCounts.set(term, (docFreqCounts.get(term) || 0) + 1);
    }
  }

  // Recompute IDF from updated counts (O(vocabulary), not O(corpus))
  idfCache = recomputeIdfFromCounts();
  cachedAvgDocLength = corpusChunkCount > 0 ? totalCorpusTokens / corpusChunkCount : 0;
  idfVersion++;
  currentIdfVersion = idfVersion;
}

/**
 * Incrementally update IDF stats when chunks are removed.
 * Decrements doc-frequency counts for terms in removed chunks.
 */
function incrementalIdfRemove(removedChunks: StoredChunk[]): void {
  if (!docFreqCounts) return;

  for (const chunk of removedChunks) {
    const terms = tokenize(chunk.text);
    totalCorpusTokens -= terms.length;
    corpusChunkCount--;
    const uniqueTerms = new Set(terms);
    for (const term of uniqueTerms) {
      const current = docFreqCounts.get(term) || 0;
      if (current <= 1) {
        docFreqCounts.delete(term);
      } else {
        docFreqCounts.set(term, current - 1);
      }
    }
  }

  idfCache = recomputeIdfFromCounts();
  cachedAvgDocLength = corpusChunkCount > 0 ? totalCorpusTokens / corpusChunkCount : 0;
  idfVersion++;
  currentIdfVersion = idfVersion;
}

function getIdfMap(chunks: StoredChunk[]): Map<string, number> {
  if (!idfCache || currentIdfVersion !== idfVersion) {
    const result = buildIdfMap(chunks);
    idfCache = result.idf;
    cachedAvgDocLength = result.avgDocLength;
    currentIdfVersion = idfVersion;
  }
  return idfCache;
}

/**
 * Get the corpus average document length (in tokens) for BM25 normalization.
 * Computed alongside IDF to avoid a second pass over the corpus.
 */
function getAvgDocLength(): number {
  // Fallback if IDF hasn't been built yet (shouldn't happen in normal flow)
  return cachedAvgDocLength || 500;
}

/**
 * BM25 scoring with proper IDF weighting.
 * avgDocLength is computed dynamically from the corpus (via getAvgDocLength())
 * rather than using a hardcoded constant, so BM25 adapts as the corpus grows.
 */
export function bm25Score(query: string, text: string, idf: Map<string, number>): number {
  const queryTerms = tokenize(query);
  const docTerms = tokenize(text);
  const docLength = docTerms.length;
  const avgDocLength = getAvgDocLength();
  const k1 = 1.2;
  const b = 0.75;

  const tf = new Map<string, number>();
  for (const term of docTerms) {
    tf.set(term, (tf.get(term) || 0) + 1);
  }

  let score = 0;
  for (const term of queryTerms) {
    const termFreq = tf.get(term) || 0;
    if (termFreq === 0) continue;

    const idfScore = idf.get(term) || 0;
    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));
    score += idfScore * (numerator / denominator);
  }

  return score;
}

/**
 * Re-rank search results using cross-features:
 * - Boost chunks with section headers matching query terms
 * - Boost chunks from documents with more matching chunks
 * - Penalize very short chunks
 */
export function reRankResults(
  results: Array<{ chunk: StoredChunk; document: Document; score: number }>,
  queryText: string
): Array<{ chunk: StoredChunk; document: Document; score: number }> {
  const queryTerms = new Set(tokenize(queryText));

  const docChunkCounts = new Map<string, number>();
  for (const r of results) {
    docChunkCounts.set(r.chunk.documentId, (docChunkCounts.get(r.chunk.documentId) || 0) + 1);
  }

  const boosted = results.map(r => {
    let boost = 0;

    // Section header match: boost chunks whose header contains query terms
    if (r.chunk.sectionHeader) {
      const headerTerms = tokenize(r.chunk.sectionHeader);
      const matchCount = headerTerms.filter(t => queryTerms.has(t)).length;
      if (matchCount > 0) {
        boost += 0.05 * Math.min(matchCount / queryTerms.size, 1);
      }
    }

    // Document frequency: boost chunks from documents with multiple matching chunks
    const docCount = docChunkCounts.get(r.chunk.documentId) || 1;
    if (docCount > 1) {
      boost += 0.02 * Math.min(docCount - 1, 3);
    }

    // Short chunk penalty: very short chunks are often noise (headers, footers)
    if (r.chunk.text.length < 50) {
      boost -= 0.1;
    }

    return { ...r, score: r.score + boost };
  });

  // Diversity pass: penalize near-duplicate chunks using token overlap.
  // When two chunks share >70% of their tokens, the lower-scored one gets
  // a penalty to promote diverse results. This avoids returning 3 variations
  // of the same paragraph from overlapping chunks.
  boosted.sort((a, b) => b.score - a.score);
  for (let i = 1; i < boosted.length; i++) {
    const iTokens = new Set(tokenize(boosted[i].chunk.text));
    for (let j = 0; j < i; j++) {
      const jTokens = tokenize(boosted[j].chunk.text);
      const overlap = jTokens.filter(t => iTokens.has(t)).length;
      const overlapRatio = overlap / Math.max(iTokens.size, 1);
      if (overlapRatio > 0.7) {
        // Scale penalty from 0 at 70% overlap to -0.06 at 100% overlap
        boosted[i].score -= 0.06 * (overlapRatio - 0.7) / 0.3;
        break; // Only penalize once (against highest-scored similar chunk)
      }
    }
  }

  return boosted;
}

/**
 * Deduplicate near-identical chunks in search results.
 * When overlapping documents are uploaded, the same text can appear in multiple
 * chunks across different documents. This wastes context window slots by sending
 * redundant information to the LLM.
 *
 * Uses Jaccard similarity on token sets: if two chunks share >80% of their tokens,
 * the lower-scored one is dropped. This is fast (O(n^2) on a small result set)
 * and doesn't require pre-computed hashes.
 */
const DEDUP_JACCARD_THRESHOLD = 0.80;

export function deduplicateResults(
  results: Array<{ chunk: StoredChunk; document: Document; score: number }>
): Array<{ chunk: StoredChunk; document: Document; score: number }> {
  if (results.length <= 1) return results;

  // Pre-tokenize all chunks
  const tokenSets = results.map(r => new Set(tokenize(r.chunk.text)));

  const kept: Array<{ chunk: StoredChunk; document: Document; score: number }> = [];
  const dropped = new Set<number>();

  for (let i = 0; i < results.length; i++) {
    if (dropped.has(i)) continue;

    kept.push(results[i]);

    // Mark near-duplicates of this chunk for removal
    for (let j = i + 1; j < results.length; j++) {
      if (dropped.has(j)) continue;

      const setA = tokenSets[i];
      const setB = tokenSets[j];

      // Fast length-ratio pre-check (adapted from Observatory QA):
      // If token set sizes differ by more than the threshold allows,
      // Jaccard similarity cannot exceed the threshold — skip the O(n)
      // intersection computation. For threshold 0.80, if minSize/maxSize < 0.80,
      // Jaccard = |A∩B|/|A∪B| ≤ min(|A|,|B|)/max(|A|,|B|) < 0.80.
      const minSize = Math.min(setA.size, setB.size);
      const maxSize = Math.max(setA.size, setB.size);
      if (maxSize > 0 && minSize / maxSize < DEDUP_JACCARD_THRESHOLD) {
        continue; // Can't possibly be a duplicate — skip expensive set intersection
      }

      // Jaccard similarity: |intersection| / |union|
      let intersection = 0;
      for (const token of setA) {
        if (setB.has(token)) intersection++;
      }
      const union = setA.size + setB.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;

      if (jaccard >= DEDUP_JACCARD_THRESHOLD) {
        dropped.add(j);
      }
    }
  }

  if (dropped.size > 0) {
    logger.info('Deduplicated near-identical chunks from results', {
      before: results.length,
      after: kept.length,
      dropped: dropped.size,
    });
  }

  return kept;
}

/**
 * Initialize the vector store by loading from S3.
 * Uses a lock to prevent concurrent initialization from racing.
 */
export async function initializeVectorStore(): Promise<void> {
  // If already initialized, skip
  if (cachedIndex) return;

  // If another call is already initializing, wait for it
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    cachedIndex = await loadVectorIndex();
    embeddingModelMismatch = null;

    if (cachedIndex) {
      const chunkCount = cachedIndex.chunks.length;
      logger.info('Vector store loaded from S3', { chunkCount });

      // Detect embedding model/dimension mismatch with the current provider.
      // This happens when the embedding model is changed (e.g. Titan V2 → V3)
      // and existing chunks were embedded with the old model.
      const ep = getEmbeddingProvider();
      if (chunkCount > 0 && cachedIndex.embeddingDimensions && cachedIndex.embeddingDimensions !== ep.dimensions) {
        embeddingModelMismatch = {
          stored: cachedIndex.embeddingModel || 'unknown',
          current: ep.modelId,
          storedDims: cachedIndex.embeddingDimensions,
          currentDims: ep.dimensions,
        };
        logger.error('EMBEDDING MODEL MISMATCH — stored embeddings are incompatible with current provider', {
          storedModel: embeddingModelMismatch.stored,
          currentModel: embeddingModelMismatch.current,
          storedDimensions: embeddingModelMismatch.storedDims,
          currentDimensions: embeddingModelMismatch.currentDims,
          chunkCount,
          action: 'Queries will fail. Re-index all documents via POST /api/documents/reindex-embeddings to fix.',
        });
      } else if (chunkCount > 0 && cachedIndex.embeddingModel && cachedIndex.embeddingModel !== ep.modelId) {
        // Same dimensions but different model — warn (may affect quality but won't crash)
        logger.warn('Embedding model changed but dimensions match — quality may vary', {
          storedModel: cachedIndex.embeddingModel,
          currentModel: ep.modelId,
          dimensions: ep.dimensions,
        });
      }

      // Warn if approaching memory limits. At 1024 dimensions (4 bytes each),
      // each chunk embedding is ~4KB. 50K chunks ≈ 200MB of embeddings in RAM.
      // The S3 JSON size guard is 500MB, but memory pressure starts earlier.
      const CHUNK_WARNING_THRESHOLD = 50_000;
      if (chunkCount > CHUNK_WARNING_THRESHOLD) {
        logger.warn('Vector store is large — consider migrating to pgvector', {
          chunkCount,
          warningThreshold: CHUNK_WARNING_THRESHOLD,
          estimatedMemoryMB: Math.round(chunkCount * 4 / 1024), // rough: 4KB per chunk embedding
        });
      }

      // Pre-build IDF cache on startup
      const idfResult = buildIdfMap(cachedIndex.chunks);
      idfCache = idfResult.idf;
      cachedAvgDocLength = idfResult.avgDocLength;
      idfVersion = 0;
      currentIdfVersion = 0;
    } else {
      const ep = getEmbeddingProvider();
      cachedIndex = {
        version: 1,
        lastUpdated: new Date().toISOString(),
        chunks: [],
        embeddingModel: ep.modelId,
        embeddingDimensions: ep.dimensions,
      };
      logger.info('Vector store initialized empty');
    }
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }
}

/**
 * Add chunks with embeddings to the vector store.
 */
export async function addChunksToStore(chunks: DocumentChunk[], embeddings: number[][]): Promise<void> {
  // Route to pgvector when database is configured
  if (await useRds()) {
    return dbAddChunks(chunks, embeddings);
  }

  if (!cachedIndex) await initializeVectorStore();

  // Validate embedding dimensions match the current provider to prevent
  // mixing incompatible vectors (e.g. if model changed mid-ingestion)
  const ep = getEmbeddingProvider();
  for (let i = 0; i < embeddings.length; i++) {
    if (embeddings[i].length !== ep.dimensions) {
      throw new Error(
        `Embedding dimension mismatch on chunk ${i}: got ${embeddings[i].length} but provider expects ${ep.dimensions}. ` +
        `This may indicate an embedding model change during ingestion.`
      );
    }
  }

  const storedChunks: StoredChunk[] = chunks.map((chunk, i) => ({
    id: chunk.id,
    documentId: chunk.documentId,
    chunkIndex: chunk.chunkIndex,
    text: chunk.text,
    tokenCount: chunk.tokenCount,
    startOffset: chunk.startOffset,
    endOffset: chunk.endOffset,
    pageNumber: chunk.pageNumber,
    sectionHeader: chunk.sectionHeader,
    embedding: embeddings[i],
  }));

  cachedIndex!.chunks.push(...storedChunks);
  cachedIndex!.lastUpdated = new Date().toISOString();

  // Stamp current embedding model metadata
  cachedIndex!.embeddingModel = ep.modelId;
  cachedIndex!.embeddingDimensions = ep.dimensions;

  // Clear model mismatch flag since we just added chunks with the current model
  embeddingModelMismatch = null;

  // Incrementally update IDF stats instead of full rebuild (O(new chunks) not O(corpus))
  incrementalIdfAdd(storedChunks);

  await saveVectorIndex(cachedIndex!);
  logger.info('Chunks added to vector store', { addedCount: storedChunks.length, totalCount: cachedIndex!.chunks.length });
}

/**
 * Remove all chunks for a document from the vector store.
 */
export async function removeDocumentChunks(documentId: string): Promise<void> {
  if (await useRds()) {
    return dbRemoveDocumentChunks(documentId);
  }

  if (!cachedIndex) await initializeVectorStore();

  // Collect removed chunks before filtering so we can update IDF incrementally
  const removedChunks = cachedIndex!.chunks.filter(c => c.documentId === documentId);
  cachedIndex!.chunks = cachedIndex!.chunks.filter(c => c.documentId !== documentId);
  const removed = removedChunks.length;

  // Incrementally update IDF stats (O(removed chunks) not O(corpus))
  if (removed > 0) {
    incrementalIdfRemove(removedChunks);
  }

  cachedIndex!.lastUpdated = new Date().toISOString();
  await saveVectorIndex(cachedIndex!);
  logger.info('Document chunks removed from vector store', { documentId, removed });
}

/**
 * Search the vector store using hybrid search (semantic + keyword).
 * Returns top-K results with combined scores.
 */
export async function searchVectorStore(
  queryEmbedding: number[],
  queryText: string,
  options: {
    topK?: number;
    collectionIds?: string[];
    tags?: string[];
    semanticWeight?: number;
    keywordWeight?: number;
  } = {}
): Promise<SearchResult[]> {
  // Route to pgvector when database is configured
  if (await useRds()) {
    return dbSearchVectorStore(queryEmbedding, queryText, options);
  }

  if (!cachedIndex) await initializeVectorStore();

  const topK = options.topK || 8;

  // Use caller-supplied weights if provided, otherwise auto-detect from query type.
  // This allows the API to override for specific use cases while defaulting to
  // adaptive weights that match the query's intent (code lookup vs. natural language).
  const queryType = classifyQuery(queryText);
  const adaptiveWeights = getAdaptiveWeights(queryType);
  const semanticWeight = options.semanticWeight ?? adaptiveWeights.semantic;
  const keywordWeight = options.keywordWeight ?? adaptiveWeights.keyword;

  // Get document index to filter by collection/tags and resolve document info
  const documents = await getDocumentsIndex();
  const docMap = new Map(documents.map(d => [d.id, d]));

  // Filter chunks by collection and/or tags if specified
  let candidates = cachedIndex!.chunks;
  const hasCollectionFilter = options.collectionIds && options.collectionIds.length > 0;
  const hasTagFilter = options.tags && options.tags.length > 0;

  if (hasCollectionFilter || hasTagFilter) {
    const allowedDocIds = new Set(
      documents
        .filter(d => {
          if (hasCollectionFilter && !options.collectionIds!.includes(d.collectionId)) return false;
          if (hasTagFilter && (!d.tags || !options.tags!.some(t => d.tags!.includes(t)))) return false;
          return true;
        })
        .map(d => d.id)
    );
    candidates = candidates.filter(c => allowedDocIds.has(c.documentId));
  }

  if (candidates.length === 0) return [];

  // Validate embedding dimensions match stored chunks
  if (candidates.length > 0 && candidates[0].embedding.length !== queryEmbedding.length) {
    const stored = candidates[0].embedding.length;
    const query = queryEmbedding.length;
    logger.error('Embedding dimension mismatch', { storedDimensions: stored, queryDimensions: query });
    throw new Error(
      `Embedding dimension mismatch: query has ${query} dimensions but stored chunks have ${stored}. ` +
      `This may indicate an embedding model change. Re-index documents to fix.`
    );
  }

  // Build IDF map from full corpus
  const idf = getIdfMap(cachedIndex!.chunks);

  // Expand query with medical synonyms for better BM25 recall.
  // The semantic search uses the original embedding (which captures meaning),
  // while BM25 benefits from explicit synonym terms (e.g. "CPAP" → also match "c-pap").
  const expandedQueryText = expandQueryWithSynonyms(queryText);

  // Score all candidates with IDF-enhanced BM25
  // First pass: compute raw scores
  const rawScored = candidates.map(chunk => {
    const semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    const keywordScore = bm25Score(expandedQueryText, chunk.text, idf);
    return { chunk, semanticScore, keywordScore };
  });

  // Dynamic BM25 normalization: divide by the max BM25 score in this result set
  // This adapts to the actual score distribution rather than using a hardcoded divisor
  const maxBm25 = rawScored.reduce((max, r) => Math.max(max, r.keywordScore), 0);

  const scored = rawScored.map(({ chunk, semanticScore, keywordScore }) => {
    const normalizedKeyword = maxBm25 > 0 ? keywordScore / maxBm25 : 0;
    const rawCombined = semanticWeight * semanticScore + keywordWeight * normalizedKeyword;
    // Guard against NaN from degenerate inputs (e.g. zero-length embeddings producing NaN cosine)
    const combinedScore = isNaN(rawCombined) ? 0 : rawCombined;

    return {
      chunk,
      document: docMap.get(chunk.documentId) || {
        id: chunk.documentId,
        filename: 'unknown',
        originalName: 'Unknown Document',
        mimeType: '',
        sizeBytes: 0,
        s3Key: '',
        collectionId: '',
        uploadedBy: '',
        uploadedAt: '',
        status: 'ready' as const,
        chunkCount: 0,
        version: 1,
      },
      score: combinedScore,
    };
  });

  // Sort by score, take 2x topK for re-ranking pool
  scored.sort((a, b) => b.score - a.score);
  const reRankPool = scored.slice(0, topK * 2);
  let reRanked = reRankResults(reRankPool, queryText);

  // Optional cross-encoder re-ranking: uses Claude to score query-chunk relevance.
  // Significantly improves precision on nuanced queries at the cost of ~200-500ms latency.
  // Enable with CROSS_ENCODER_RERANK=true
  if (isCrossEncoderEnabled()) {
    reRanked = await crossEncoderRerank(queryText, reRanked);
  }

  reRanked.sort((a, b) => b.score - a.score);

  // Apply minimum score threshold — discard results with negligible relevance.
  // 0.15 filters the ~30% of results that are marginal noise (0.10-0.15 range)
  // while retaining anything with meaningful semantic or keyword signal.
  const MIN_SCORE_THRESHOLD = 0.15;
  const thresholded = reRanked.filter(r => r.score >= MIN_SCORE_THRESHOLD);

  // Deduplicate near-identical chunks (from overlapping documents) before final selection
  const deduped = deduplicateResults(thresholded);

  // Build final results with clean chunk objects
  return deduped.slice(0, topK).map(r => ({
    chunk: {
      id: r.chunk.id,
      documentId: r.chunk.documentId,
      chunkIndex: r.chunk.chunkIndex,
      text: r.chunk.text,
      tokenCount: r.chunk.tokenCount,
      startOffset: r.chunk.startOffset,
      endOffset: r.chunk.endOffset,
      pageNumber: r.chunk.pageNumber,
      sectionHeader: r.chunk.sectionHeader,
    } as DocumentChunk,
    document: r.document,
    score: r.score,
  }));
}

/**
 * Keyword search across all chunk text, returning matching chunks grouped by document.
 * Used for the document browse/search feature (not RAG, just text search).
 */
export async function searchChunksByKeyword(
  query: string,
  collectionId?: string
): Promise<Array<{ documentId: string; documentName: string; matches: Array<{ text: string; pageNumber?: number; chunkIndex: number }> }>> {
  if (await useRds()) {
    return dbSearchChunksByKeyword(query, collectionId);
  }

  if (!cachedIndex) await initializeVectorStore();

  const documents = await getDocumentsIndex();
  const docMap = new Map(documents.map(d => [d.id, d]));

  let candidates = cachedIndex!.chunks;
  if (collectionId) {
    const allowedDocIds = new Set(
      documents.filter(d => d.collectionId === collectionId).map(d => d.id)
    );
    candidates = candidates.filter(c => allowedDocIds.has(c.documentId));
  }

  const queryLower = query.toLowerCase();
  const queryTerms = queryLower.split(/\s+/).filter(t => t.length > 1);
  const matchingChunks = candidates.filter(chunk => {
    const textLower = chunk.text.toLowerCase();
    return queryTerms.every(term => textLower.includes(term));
  });

  // Group by document
  const grouped = new Map<string, Array<{ text: string; pageNumber?: number; chunkIndex: number }>>();
  for (const chunk of matchingChunks) {
    if (!grouped.has(chunk.documentId)) {
      grouped.set(chunk.documentId, []);
    }
    grouped.get(chunk.documentId)!.push({
      text: chunk.text,
      pageNumber: chunk.pageNumber,
      chunkIndex: chunk.chunkIndex,
    });
  }

  const results = Array.from(grouped.entries()).map(([documentId, matches]) => ({
    documentId,
    documentName: docMap.get(documentId)?.originalName || 'Unknown',
    matches: matches.slice(0, 10), // Limit matches per document
  }));

  return results.slice(0, 20); // Limit total documents
}

/**
 * Get vector store stats.
 */
export interface VectorStoreStatus {
  totalChunks: number;
  lastUpdated: string | null;
  embeddingModel?: string;
  embeddingDimensions?: number;
  modelMismatch?: {
    stored: string;
    current: string;
    storedDims: number;
    currentDims: number;
    requiresReindex: boolean;
  };
}

export async function getVectorStoreStats(): Promise<VectorStoreStatus> {
  if (await useRds()) {
    const base = await dbGetVectorStoreStats();
    return { ...base, modelMismatch: embeddingModelMismatch ? { ...embeddingModelMismatch, requiresReindex: true } : undefined };
  }
  return {
    totalChunks: cachedIndex?.chunks.length || 0,
    lastUpdated: cachedIndex?.lastUpdated || null,
    embeddingModel: cachedIndex?.embeddingModel,
    embeddingDimensions: cachedIndex?.embeddingDimensions,
    modelMismatch: embeddingModelMismatch ? { ...embeddingModelMismatch, requiresReindex: true } : undefined,
  };
}

/**
 * Re-embed all documents in the vector store using the current embedding provider.
 * This is the migration path when the embedding model changes.
 *
 * For each document's chunks, regenerates embeddings with the current model,
 * then replaces the old chunks. Returns the number of chunks re-embedded.
 *
 * For pgvector (RDS) mode, this requires an ALTER TABLE if dimensions changed.
 */
export async function reindexAllEmbeddings(): Promise<{ reindexedChunks: number; errors: string[] }> {
  if (await useRds()) {
    // pgvector requires schema change for dimension change — cannot auto-migrate
    throw new Error(
      'Embedding reindex not supported in pgvector mode. ' +
      'Run migration to ALTER TABLE chunks ALTER COLUMN embedding TYPE vector(NEW_DIM), then re-ingest all documents.'
    );
  }

  if (!cachedIndex) await initializeVectorStore();
  if (!cachedIndex || cachedIndex.chunks.length === 0) {
    return { reindexedChunks: 0, errors: [] };
  }

  const ep = getEmbeddingProvider();
  const errors: string[] = [];
  let reindexedCount = 0;

  // Group chunks by document for batch embedding
  const docChunks = new Map<string, StoredChunk[]>();
  for (const chunk of cachedIndex.chunks) {
    const existing = docChunks.get(chunk.documentId) || [];
    existing.push(chunk);
    docChunks.set(chunk.documentId, existing);
  }

  logger.info('Starting embedding reindex', {
    totalChunks: cachedIndex.chunks.length,
    documentCount: docChunks.size,
    currentModel: ep.modelId,
    currentDimensions: ep.dimensions,
  });

  for (const [documentId, chunks] of docChunks) {
    try {
      const texts = chunks.map(c => c.text);
      const newEmbeddings = await ep.generateEmbeddingsBatch(texts);

      // Replace embeddings in place
      for (let i = 0; i < chunks.length; i++) {
        chunks[i].embedding = newEmbeddings[i];
      }
      reindexedCount += chunks.length;
    } catch (err) {
      const msg = `Failed to re-embed document ${documentId}: ${err instanceof Error ? err.message : String(err)}`;
      logger.error(msg);
      errors.push(msg);
    }
  }

  // Update metadata
  cachedIndex.embeddingModel = ep.modelId;
  cachedIndex.embeddingDimensions = ep.dimensions;
  cachedIndex.lastUpdated = new Date().toISOString();
  embeddingModelMismatch = null;

  // Invalidate IDF cache
  idfVersion++;
  idfCache = null;

  await saveVectorIndex(cachedIndex);

  logger.info('Embedding reindex completed', {
    reindexedChunks: reindexedCount,
    errors: errors.length,
    newModel: ep.modelId,
    newDimensions: ep.dimensions,
  });

  return { reindexedChunks: reindexedCount, errors };
}
