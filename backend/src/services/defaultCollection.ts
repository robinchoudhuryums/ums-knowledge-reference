/**
 * Default Collection Seeder
 *
 * The Documents UI and the upload route both fall back to a `'default'`
 * collection ID when the user hasn't explicitly picked one (see
 * `frontend/src/components/DocumentManager.tsx` and
 * `backend/src/routes/documents.ts`). The S3-only deployment let that
 * fallback silently create a synthetic collection in the JSON index.
 * Migration 004 added an FK constraint on `documents.collection_id`,
 * so the fallback now requires a real row in the `collections` table.
 *
 * This module ensures that row exists. Called once at server startup
 * after `initializeAuth()` so the seeded `created_by` references a real
 * admin user (FK fk_collections_created_by). Idempotent — safe to call
 * on every boot.
 *
 * Also exported as `ensureDefaultCollectionForUser(userId)` for the
 * upload route, which calls it lazily when the caller's collectionId
 * is `'default'` and we can't trust that the startup seed survived
 * (e.g. an admin manually deleted it). Same idempotent semantics.
 */

import { Collection } from '../types';
import { getCollectionsIndex, saveCollectionsIndex } from '../db';
import { getUsers } from '../middleware/auth';
import { logger } from '../utils/logger';

export const DEFAULT_COLLECTION_ID = 'default';
const DEFAULT_COLLECTION_NAME = 'Default';
const DEFAULT_COLLECTION_DESCRIPTION = 'Uploads that arrive without an explicit collection land here.';

/**
 * Find a user ID to attribute the seeded collection to. Prefers the
 * lowest-numbered admin (deterministic across reboots); falls back to
 * any user if no admin exists yet — but `initializeAuth()` always
 * creates an initial admin, so this fallback should only fire in
 * unusual race conditions or test environments.
 */
async function pickSeedCreator(): Promise<string | null> {
  const users = await getUsers();
  if (users.length === 0) return null;
  const admins = users.filter(u => u.role === 'admin');
  const pool = admins.length > 0 ? admins : users;
  // Sort by id so the choice is deterministic across restarts.
  pool.sort((a, b) => a.id.localeCompare(b.id));
  return pool[0].id;
}

/**
 * Ensure the `'default'` collection row exists. Idempotent.
 * Returns true if a new row was created, false if it already existed.
 */
export async function ensureDefaultCollection(creatorUserId?: string): Promise<boolean> {
  const collections = await getCollectionsIndex();
  if (collections.some(c => c.id === DEFAULT_COLLECTION_ID)) {
    return false;
  }

  const createdBy = creatorUserId ?? (await pickSeedCreator());
  if (!createdBy) {
    logger.warn('Default collection seed skipped: no users available to attribute as creator');
    return false;
  }

  const collection: Collection = {
    id: DEFAULT_COLLECTION_ID,
    name: DEFAULT_COLLECTION_NAME,
    description: DEFAULT_COLLECTION_DESCRIPTION,
    createdBy,
    createdAt: new Date().toISOString(),
    documentCount: 0,
  };

  collections.push(collection);
  await saveCollectionsIndex(collections);
  logger.info('Default collection seeded', {
    collectionId: DEFAULT_COLLECTION_ID,
    createdBy,
  });
  return true;
}
