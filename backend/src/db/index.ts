/**
 * Database Access Layer — Hybrid S3/RDS
 *
 * Provides database functions that automatically use PostgreSQL when configured,
 * falling back to S3 JSON storage when DATABASE_URL is not set.
 *
 * This enables a gradual migration: once DATABASE_URL is set, all reads/writes
 * go to PostgreSQL. Without it, the app continues working with S3 as before.
 *
 * Usage in services:
 *   import { getUsers, saveUsers } from '../db';
 *   // Automatically routes to RDS or S3 depending on config
 */

import { checkDatabaseConnection } from '../config/database';
import { logger } from '../utils/logger';

// Lazy-initialized flag — checked once on first use
let _useRds: boolean | null = null;

async function useRds(): Promise<boolean> {
  if (_useRds !== null) return _useRds;
  try {
    _useRds = await checkDatabaseConnection();
    if (_useRds) {
      logger.info('Database layer: using PostgreSQL (RDS)');
    } else {
      logger.info('Database layer: using S3 JSON fallback');
    }
  } catch {
    _useRds = false;
    logger.info('Database layer: using S3 JSON fallback (connection check failed)');
  }
  return _useRds;
}

// ─── Users ──────────────────────────────────────────────────────────────────

import { dbGetUsers, dbSaveUsers } from './users';
import { loadMetadata, saveMetadata } from '../services/s3Storage';
import { User, Document, Collection } from '../types';

const USERS_KEY = 'users.json';
const DOCUMENTS_INDEX_KEY = 'documents-index.json';
const COLLECTIONS_INDEX_KEY = 'collections-index.json';

export async function getUsers(): Promise<User[]> {
  if (await useRds()) return dbGetUsers();
  return (await loadMetadata<User[]>(USERS_KEY)) || [];
}

export async function saveUsers(users: User[]): Promise<void> {
  if (await useRds()) return dbSaveUsers(users);
  return saveMetadata(USERS_KEY, users);
}

// ─── Documents ──────────────────────────────────────────────────────────────

import { dbGetDocuments, dbSaveDocuments, dbGetCollections, dbSaveCollections } from './documents';

export async function getDocumentsIndex(): Promise<Document[]> {
  if (await useRds()) return dbGetDocuments();
  return (await loadMetadata<Document[]>(DOCUMENTS_INDEX_KEY)) || [];
}

export async function saveDocumentsIndex(docs: Document[]): Promise<void> {
  if (await useRds()) return dbSaveDocuments(docs);
  return saveMetadata(DOCUMENTS_INDEX_KEY, docs);
}

export async function getCollectionsIndex(): Promise<Collection[]> {
  if (await useRds()) return dbGetCollections();
  return (await loadMetadata<Collection[]>(COLLECTIONS_INDEX_KEY)) || [];
}

export async function saveCollectionsIndex(collections: Collection[]): Promise<void> {
  if (await useRds()) return dbSaveCollections(collections);
  return saveMetadata(COLLECTIONS_INDEX_KEY, collections);
}

// ─── Vector Store ───────────────────────────────────────────────────────────
// Re-export pgvector functions for use when callers want direct DB access.
// The main vectorStore.ts service handles the hybrid routing internally.

export {
  dbAddChunks,
  dbRemoveDocumentChunks,
  dbSearchVectorStore,
  dbSearchChunksByKeyword,
  dbGetVectorStoreStats,
} from './vectorStore';

// Export the useRds check so vectorStore.ts can decide which backend to use
export { useRds };
