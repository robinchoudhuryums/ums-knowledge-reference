/**
 * Database Documents Repository
 *
 * PostgreSQL implementation for document metadata CRUD.
 * Replaces S3 JSON file storage (documents-index.json) with the `documents` table.
 * Raw document files (PDFs, etc.) remain in S3.
 */

import { getPool } from '../config/database';
import { Document, Collection } from '../types';
import { logger } from '../utils/logger';

// ─── Documents ──────────────────────────────────────────────────────────────

/**
 * Get all documents, optionally filtered by collection.
 */
export async function dbGetDocuments(collectionId?: string): Promise<Document[]> {
  const pool = getPool();
  let query = `
    SELECT id, filename, original_name, mime_type, size_bytes, s3_key,
           collection_id, uploaded_by, uploaded_at, status, chunk_count,
           version, previous_version_id, content_hash, error_message, tags,
           extraction_warnings
    FROM documents ORDER BY uploaded_at DESC
  `;
  const params: unknown[] = [];

  if (collectionId) {
    query = `
      SELECT id, filename, original_name, mime_type, size_bytes, s3_key,
             collection_id, uploaded_by, uploaded_at, status, chunk_count,
             version, previous_version_id, content_hash, error_message, tags
      FROM documents WHERE collection_id = $1 ORDER BY uploaded_at DESC
    `;
    params.push(collectionId);
  }

  const result = await pool.query(query, params);
  return result.rows.map(mapRowToDocument);
}

/**
 * Save the full documents index (upsert all documents).
 */
export async function dbSaveDocuments(docs: Document[]): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const doc of docs) {
      await client.query(`
        INSERT INTO documents (id, filename, original_name, mime_type, size_bytes, s3_key,
                              collection_id, uploaded_by, uploaded_at, status, chunk_count,
                              version, previous_version_id, content_hash, error_message, tags,
                              extraction_warnings)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO UPDATE SET
          status = EXCLUDED.status,
          chunk_count = EXCLUDED.chunk_count,
          version = EXCLUDED.version,
          previous_version_id = EXCLUDED.previous_version_id,
          content_hash = EXCLUDED.content_hash,
          error_message = EXCLUDED.error_message,
          tags = EXCLUDED.tags,
          extraction_warnings = EXCLUDED.extraction_warnings
      `, [
        doc.id, doc.filename, doc.originalName, doc.mimeType, doc.sizeBytes,
        doc.s3Key, doc.collectionId, doc.uploadedBy, doc.uploadedAt,
        doc.status, doc.chunkCount, doc.version,
        doc.previousVersionId || null, doc.contentHash || null,
        doc.errorMessage || null, doc.tags || [],
        doc.extractionWarnings || [],
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to save documents to database', { error: String(err) });
    throw err;
  } finally {
    client.release();
  }
}

// ─── Collections ────────────────────────────────────────────────────────────

/**
 * Get all collections.
 */
export async function dbGetCollections(): Promise<Collection[]> {
  const pool = getPool();
  const result = await pool.query(`
    SELECT c.id, c.name, c.description, c.created_at, c.created_by,
           COALESCE(d.doc_count, 0) AS document_count
    FROM collections c
    LEFT JOIN (
      SELECT collection_id, COUNT(*) AS doc_count
      FROM documents WHERE status = 'ready'
      GROUP BY collection_id
    ) d ON d.collection_id = c.id
    ORDER BY c.created_at
  `);
  return result.rows.map(mapRowToCollection);
}

/**
 * Save the full collections list (upsert all).
 */
export async function dbSaveCollections(collections: Collection[]): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const col of collections) {
      await client.query(`
        INSERT INTO collections (id, name, description, created_at, created_by)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          description = EXCLUDED.description
      `, [col.id, col.name, col.description || '', col.createdAt, col.createdBy]);
    }

    // Delete removed collections
    const ids = collections.map(c => c.id);
    if (ids.length > 0) {
      await client.query('DELETE FROM collections WHERE id != ALL($1)', [ids]);
    } else {
      await client.query('DELETE FROM collections');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to save collections to database', { error: String(err) });
    throw err;
  } finally {
    client.release();
  }
}

// ─── Mappers ────────────────────────────────────────────────────────────────

function mapRowToDocument(row: Record<string, unknown>): Document {
  return {
    id: row.id as string,
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
    previousVersionId: row.previous_version_id as string | undefined,
    contentHash: row.content_hash as string | undefined,
    errorMessage: row.error_message as string | undefined,
    tags: (row.tags as string[])?.length > 0 ? row.tags as string[] : undefined,
    extractionWarnings: (row.extraction_warnings as string[])?.length > 0
      ? row.extraction_warnings as string[]
      : undefined,
  };
}

function mapRowToCollection(row: Record<string, unknown>): Collection {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    createdAt: (row.created_at as Date)?.toISOString() || '',
    createdBy: row.created_by as string,
    documentCount: Number(row.document_count || 0),
  };
}
