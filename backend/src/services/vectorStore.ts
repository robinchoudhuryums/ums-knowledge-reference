import { StoredChunk, VectorStoreIndex, SearchResult, Document, DocumentChunk } from '../types';
import { saveVectorIndex, loadVectorIndex, getDocumentsIndex } from './s3Storage';
import { logger } from '../utils/logger';

// In-memory cache of the vector index for fast search
let cachedIndex: VectorStoreIndex | null = null;

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
 * Simple BM25-like keyword scoring for hybrid search.
 */
function bm25Score(query: string, text: string): number {
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
  const docTerms = text.toLowerCase().split(/\s+/);
  const docLength = docTerms.length;
  const avgDocLength = 500; // approximate average
  const k1 = 1.2;
  const b = 0.75;

  let score = 0;
  for (const term of queryTerms) {
    const termFreq = docTerms.filter(t => t.includes(term)).length;
    if (termFreq === 0) continue;

    // Simplified BM25 (without IDF since we don't have corpus stats readily)
    const numerator = termFreq * (k1 + 1);
    const denominator = termFreq + k1 * (1 - b + b * (docLength / avgDocLength));
    score += numerator / denominator;
  }

  return score;
}

/**
 * Initialize the vector store by loading from S3.
 */
export async function initializeVectorStore(): Promise<void> {
  cachedIndex = await loadVectorIndex();
  if (cachedIndex) {
    logger.info('Vector store loaded from S3', { chunkCount: cachedIndex.chunks.length });
  } else {
    cachedIndex = { version: 1, lastUpdated: new Date().toISOString(), chunks: [] };
    logger.info('Vector store initialized empty');
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
    semanticWeight?: number;
    keywordWeight?: number;
  } = {}
): Promise<SearchResult[]> {
  if (!cachedIndex) await initializeVectorStore();

  const topK = options.topK || 5;
  const semanticWeight = options.semanticWeight ?? 0.7;
  const keywordWeight = options.keywordWeight ?? 0.3;

  // Get document index to filter by collection and resolve document info
  const documents = await getDocumentsIndex();
  const docMap = new Map(documents.map(d => [d.id, d]));

  // Filter chunks by collection if specified
  let candidates = cachedIndex!.chunks;
  if (options.collectionIds && options.collectionIds.length > 0) {
    const allowedDocIds = new Set(
      documents
        .filter(d => options.collectionIds!.includes(d.collectionId))
        .map(d => d.id)
    );
    candidates = candidates.filter(c => allowedDocIds.has(c.documentId));
  }

  if (candidates.length === 0) return [];

  // Score all candidates
  const scored = candidates.map(chunk => {
    const semanticScore = cosineSimilarity(queryEmbedding, chunk.embedding);
    const keywordScore = bm25Score(queryText, chunk.text);
    const combinedScore = semanticWeight * semanticScore + keywordWeight * keywordScore;

    return {
      chunk: {
        id: chunk.id,
        documentId: chunk.documentId,
        chunkIndex: chunk.chunkIndex,
        text: chunk.text,
        tokenCount: chunk.tokenCount,
        startOffset: chunk.startOffset,
        endOffset: chunk.endOffset,
        pageNumber: chunk.pageNumber,
        sectionHeader: chunk.sectionHeader,
      } as DocumentChunk,
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

  // Sort by score descending and take top-K
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
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
