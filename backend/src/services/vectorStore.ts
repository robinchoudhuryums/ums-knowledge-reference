import { StoredChunk, VectorStoreIndex, SearchResult, Document, DocumentChunk } from '../types';
import { saveVectorIndex, loadVectorIndex, getDocumentsIndex } from './s3Storage';
import { getEmbeddingProvider } from './embeddings';
import { logger } from '../utils/logger';

// In-memory cache of the vector index for fast search
let cachedIndex: VectorStoreIndex | null = null;

// Initialization lock to prevent concurrent initializeVectorStore() calls
let initPromise: Promise<void> | null = null;

// IDF cache — rebuilt when index changes
let idfCache: Map<string, number> | null = null;
let idfChunkCount = 0;

/**
 * Compute cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
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
 */
function tokenize(text: string): string[] {
  const normalized = text
    .toLowerCase()
    // Remove punctuation except hyphens between word characters
    .replace(/[^\w\s-]/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ')
    .trim();

  const rawTokens = normalized.split(/\s+/).filter(t => t.length > 2);

  // For hyphenated terms, emit both the compound and the parts
  // e.g. "iv-catheter" => ["iv-catheter", "catheter"] (skip parts <= 2 chars)
  const tokens: string[] = [];
  for (const token of rawTokens) {
    // Strip leading/trailing hyphens
    const clean = token.replace(/^-+|-+$/g, '');
    if (clean.length <= 2) continue;

    tokens.push(clean);
    if (clean.includes('-')) {
      for (const part of clean.split('-')) {
        if (part.length > 2) {
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
 */
function buildIdfMap(chunks: StoredChunk[]): Map<string, number> {
  const N = chunks.length;
  const docFreq = new Map<string, number>();

  for (const chunk of chunks) {
    const terms = new Set(tokenize(chunk.text));
    for (const term of terms) {
      docFreq.set(term, (docFreq.get(term) || 0) + 1);
    }
  }

  const idf = new Map<string, number>();
  for (const [term, df] of docFreq) {
    idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }

  return idf;
}

function getIdfMap(chunks: StoredChunk[]): Map<string, number> {
  if (!idfCache || idfChunkCount !== chunks.length) {
    idfCache = buildIdfMap(chunks);
    idfChunkCount = chunks.length;
  }
  return idfCache;
}

/**
 * BM25 scoring with proper IDF weighting.
 */
function bm25Score(query: string, text: string, idf: Map<string, number>): number {
  const queryTerms = tokenize(query);
  const docTerms = tokenize(text);
  const docLength = docTerms.length;
  const avgDocLength = 500;
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
function reRankResults(
  results: Array<{ chunk: StoredChunk; document: Document; score: number }>,
  queryText: string
): Array<{ chunk: StoredChunk; document: Document; score: number }> {
  const queryTerms = new Set(tokenize(queryText));

  const docChunkCounts = new Map<string, number>();
  for (const r of results) {
    docChunkCounts.set(r.chunk.documentId, (docChunkCounts.get(r.chunk.documentId) || 0) + 1);
  }

  return results.map(r => {
    let boost = 0;

    if (r.chunk.sectionHeader) {
      const headerTerms = tokenize(r.chunk.sectionHeader);
      const matchCount = headerTerms.filter(t => queryTerms.has(t)).length;
      if (matchCount > 0) {
        boost += 0.05 * Math.min(matchCount / queryTerms.size, 1);
      }
    }

    const docCount = docChunkCounts.get(r.chunk.documentId) || 1;
    if (docCount > 1) {
      boost += 0.02 * Math.min(docCount - 1, 3);
    }

    if (r.chunk.text.length < 50) {
      boost -= 0.1;
    }

    return { ...r, score: r.score + boost };
  });
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
    if (cachedIndex) {
      logger.info('Vector store loaded from S3', { chunkCount: cachedIndex.chunks.length });
      // Pre-build IDF cache on startup
      idfCache = buildIdfMap(cachedIndex.chunks);
      idfChunkCount = cachedIndex.chunks.length;
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
  if (!cachedIndex) await initializeVectorStore();

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
  const ep = getEmbeddingProvider();
  cachedIndex!.embeddingModel = ep.modelId;
  cachedIndex!.embeddingDimensions = ep.dimensions;

  // Invalidate IDF cache since corpus changed
  idfCache = null;

  await saveVectorIndex(cachedIndex!);
  logger.info('Chunks added to vector store', { addedCount: storedChunks.length, totalCount: cachedIndex!.chunks.length });
}

/**
 * Remove all chunks for a document from the vector store.
 */
export async function removeDocumentChunks(documentId: string): Promise<void> {
  if (!cachedIndex) await initializeVectorStore();

  const before = cachedIndex!.chunks.length;
  cachedIndex!.chunks = cachedIndex!.chunks.filter(c => c.documentId !== documentId);
  const removed = before - cachedIndex!.chunks.length;

  // Invalidate IDF cache
  idfCache = null;

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
  if (!cachedIndex) await initializeVectorStore();

  const topK = options.topK || 5;
  const semanticWeight = options.semanticWeight ?? 0.7;
  const keywordWeight = options.keywordWeight ?? 0.3;

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

  // Score all candidates with IDF-enhanced BM25
  // First pass: compute raw scores
  const rawScored = candidates.map(chunk => {
    const semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    const keywordScore = bm25Score(queryText, chunk.text, idf);
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
  const reRanked = reRankResults(reRankPool, queryText);
  reRanked.sort((a, b) => b.score - a.score);

  // Build final results with clean chunk objects
  return reRanked.slice(0, topK).map(r => ({
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
export function getVectorStoreStats(): { totalChunks: number; lastUpdated: string | null } {
  return {
    totalChunks: cachedIndex?.chunks.length || 0,
    lastUpdated: cachedIndex?.lastUpdated || null,
  };
}
