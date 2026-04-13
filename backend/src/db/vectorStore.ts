/**
 * PostgreSQL + pgvector Vector Store
 *
 * Replaces the in-memory vector store (S3 JSON-backed) with PostgreSQL
 * using the pgvector extension for native vector similarity search.
 *
 * Benefits over the S3 JSON approach:
 *   - No memory ceiling (was limited to ~83K chunks / 500MB)
 *   - Concurrent writes are ACID (was mutex-protected single process)
 *   - IVFFlat index for fast approximate nearest neighbor search
 *   - Works across multiple app instances
 */

import { getPool } from '../config/database';
import { DocumentChunk, SearchResult, Document } from '../types';
import { logger } from '../utils/logger';

/**
 * Add chunks with embeddings to the pgvector store.
 */
export async function dbAddChunks(chunks: DocumentChunk[], embeddings: number[][]): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const embedding = embeddings[i];
      // pgvector expects embeddings as a string like '[0.1, 0.2, ...]'
      const embeddingStr = `[${embedding.join(',')}]`;

      await client.query(`
        INSERT INTO chunks (id, document_id, chunk_index, text, token_count,
                           start_offset, end_offset, page_number, section_header, embedding)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)
        ON CONFLICT (id) DO NOTHING
      `, [
        chunk.id, chunk.documentId, chunk.chunkIndex, chunk.text,
        chunk.tokenCount, chunk.startOffset, chunk.endOffset,
        chunk.pageNumber || null, chunk.sectionHeader || null,
        embeddingStr,
      ]);
    }

    // Update metadata
    await client.query(`
      UPDATE vector_store_meta SET value = now()::text WHERE key = 'last_updated'
    `);

    await client.query('COMMIT');

    logger.info('Chunks added to pgvector store', {
      addedCount: chunks.length,
      documentId: chunks[0]?.documentId,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to add chunks to pgvector', { error: String(err) });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Remove all chunks for a document.
 */
export async function dbRemoveDocumentChunks(documentId: string): Promise<void> {
  const pool = getPool();
  const result = await pool.query('DELETE FROM chunks WHERE document_id = $1', [documentId]);
  logger.info('Document chunks removed from pgvector', {
    documentId,
    removed: result.rowCount,
  });
}

/**
 * Search the vector store using pgvector cosine similarity.
 * Returns top-K results with combined semantic + keyword scoring.
 *
 * pgvector's <=> operator computes cosine distance (1 - cosine_similarity),
 * so we convert: similarity = 1 - distance.
 */
export async function dbSearchVectorStore(
  queryEmbedding: number[],
  queryText: string,
  options: {
    topK?: number;
    collectionIds?: string[];
    semanticWeight?: number;
    keywordWeight?: number;
  } = {}
): Promise<SearchResult[]> {
  const pool = getPool();
  const topK = options.topK || 5;
  const semanticWeight = options.semanticWeight ?? 0.7;
  const keywordWeight = options.keywordWeight ?? 0.3;
  const embeddingStr = `[${queryEmbedding.join(',')}]`;

  // Build the query with optional collection filtering
  let collectionFilter = '';
  const params: unknown[] = [embeddingStr, topK * 3]; // Fetch 3x for re-ranking room

  if (options.collectionIds && options.collectionIds.length > 0) {
    collectionFilter = 'AND d.collection_id = ANY($3)';
    params.push(options.collectionIds);
  }

  // Use pgvector's cosine distance operator (<=>), convert to similarity
  const result = await pool.query(`
    SELECT c.id, c.document_id, c.chunk_index, c.text, c.token_count,
           c.start_offset, c.end_offset, c.page_number, c.section_header,
           1 - (c.embedding <=> $1::vector) AS semantic_score,
           d.id AS doc_id, d.filename, d.original_name, d.mime_type,
           d.size_bytes, d.s3_key, d.collection_id, d.uploaded_by,
           d.uploaded_at, d.status, d.chunk_count, d.version
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE d.status = 'ready' ${collectionFilter}
    ORDER BY c.embedding <=> $1::vector
    LIMIT $2
  `, params);

  if (result.rows.length === 0) return [];

  // Apply keyword scoring for hybrid search (BM25-like term matching)
  const queryTerms = queryText.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  const scored = result.rows.map((row: Record<string, unknown>) => {
    const semanticScore = Number(row.semantic_score);
    const text = (row.text as string).toLowerCase();

    // Simple keyword score: fraction of query terms found in chunk
    const matchedTerms = queryTerms.filter(t => text.includes(t)).length;
    const keywordScore = queryTerms.length > 0 ? matchedTerms / queryTerms.length : 0;

    const rawCombined = semanticWeight * semanticScore + keywordWeight * keywordScore;
    // Guard against NaN from degenerate inputs (INV-27)
    const combinedScore = isNaN(rawCombined) ? 0 : rawCombined;

    return {
      chunk: {
        id: row.id as string,
        documentId: row.document_id as string,
        chunkIndex: row.chunk_index as number,
        text: row.text as string,
        tokenCount: row.token_count as number,
        startOffset: row.start_offset as number,
        endOffset: row.end_offset as number,
        pageNumber: row.page_number as number | undefined,
        sectionHeader: row.section_header as string | undefined,
      } as DocumentChunk,
      document: {
        id: row.doc_id as string,
        filename: row.filename as string,
        originalName: row.original_name as string,
        mimeType: row.mime_type as string,
        sizeBytes: Number(row.size_bytes),
        s3Key: row.s3_key as string,
        collectionId: row.collection_id as string,
        uploadedBy: row.uploaded_by as string,
        uploadedAt: (row.uploaded_at as Date)?.toISOString() || '',
        status: row.status as Document['status'],
        chunkCount: row.chunk_count as number,
        version: row.version as number,
      },
      score: combinedScore,
    };
  });

  // Sort by combined score and take topK
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Get vector store stats.
 */
export async function dbGetVectorStoreStats(): Promise<{
  totalChunks: number;
  lastUpdated: string | null;
}> {
  const pool = getPool();
  const countResult = await pool.query('SELECT COUNT(*) FROM chunks');
  const metaResult = await pool.query(
    "SELECT value FROM vector_store_meta WHERE key = 'last_updated'"
  );

  return {
    totalChunks: parseInt(countResult.rows[0].count, 10),
    lastUpdated: metaResult.rows[0]?.value || null,
  };
}

/**
 * Search chunks by keyword text match (for document browse, not RAG).
 */
export async function dbSearchChunksByKeyword(
  query: string,
  collectionId?: string
): Promise<Array<{
  documentId: string;
  documentName: string;
  matches: Array<{ text: string; pageNumber?: number; chunkIndex: number }>;
}>> {
  const pool = getPool();
  const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  if (queryTerms.length === 0) return [];

  // Build a LIKE condition for each term
  const conditions = queryTerms.map((_, i) => `LOWER(c.text) LIKE $${i + 1}`);
  const params: unknown[] = queryTerms.map(t => `%${t}%`);

  let collectionFilter = '';
  if (collectionId) {
    collectionFilter = `AND d.collection_id = $${params.length + 1}`;
    params.push(collectionId);
  }

  const result = await pool.query(`
    SELECT c.document_id, c.text, c.page_number, c.chunk_index,
           d.original_name
    FROM chunks c
    JOIN documents d ON d.id = c.document_id
    WHERE ${conditions.join(' AND ')} ${collectionFilter}
    AND d.status = 'ready'
    ORDER BY c.document_id, c.chunk_index
    LIMIT 200
  `, params);

  // Group by document
  const grouped = new Map<string, {
    documentName: string;
    matches: Array<{ text: string; pageNumber?: number; chunkIndex: number }>;
  }>();

  for (const row of result.rows) {
    const docId = row.document_id as string;
    if (!grouped.has(docId)) {
      grouped.set(docId, { documentName: row.original_name as string, matches: [] });
    }
    const group = grouped.get(docId)!;
    if (group.matches.length < 10) { // Limit matches per document
      group.matches.push({
        text: row.text as string,
        pageNumber: row.page_number as number | undefined,
        chunkIndex: row.chunk_index as number,
      });
    }
  }

  return Array.from(grouped.entries())
    .map(([documentId, data]) => ({ documentId, ...data }))
    .slice(0, 20); // Limit total documents
}
