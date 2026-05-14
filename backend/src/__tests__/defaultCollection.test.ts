/**
 * Regression coverage for the 2026-05-14 cold-start upload failure.
 *
 * Two related bugs surfaced when the production RDS schema enforced the
 * FK constraint added by migration 004:
 *   1. Fresh DB with no rows in `collections` made every upload fail
 *      with `fk_documents_collection` because the frontend falls back
 *      to a literal `'default'` collectionId and nothing seeded it.
 *   2. `routes/documents.ts` collection-create handler stored
 *      `req.user!.username` in `created_by` instead of `req.user!.id`,
 *      so even manually creating a collection failed FK
 *      `fk_collections_created_by → users(id)`.
 *
 * `ensureDefaultCollection` is the startup-seeded fix for (1).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Stub the db facade so we can drive the get/save round-trip in memory.
const collectionsStore: { value: { id: string; name: string; description: string; createdBy: string; createdAt: string; documentCount: number }[] } = {
  value: [],
};
const usersStore: { value: { id: string; role: string; username: string }[] } = { value: [] };

vi.mock('../db', () => ({
  getCollectionsIndex: vi.fn(async () => collectionsStore.value),
  saveCollectionsIndex: vi.fn(async (cols: typeof collectionsStore.value) => {
    collectionsStore.value = cols;
  }),
}));

vi.mock('../middleware/auth', () => ({
  getUsers: vi.fn(async () => usersStore.value),
}));

describe('ensureDefaultCollection', () => {
  beforeEach(() => {
    collectionsStore.value = [];
    usersStore.value = [];
    vi.resetModules();
  });

  it('creates the default row when missing and attributes it to the first admin', async () => {
    usersStore.value = [
      { id: 'admin-001', role: 'admin', username: 'robin' },
      { id: 'user-002', role: 'user', username: 'someone' },
    ];

    const { ensureDefaultCollection, DEFAULT_COLLECTION_ID } = await import('../services/defaultCollection');

    const created = await ensureDefaultCollection();
    expect(created).toBe(true);
    expect(collectionsStore.value).toHaveLength(1);
    expect(collectionsStore.value[0].id).toBe(DEFAULT_COLLECTION_ID);
    expect(collectionsStore.value[0].createdBy).toBe('admin-001');
  });

  it('is idempotent — second call is a no-op', async () => {
    usersStore.value = [{ id: 'admin-001', role: 'admin', username: 'robin' }];

    const { ensureDefaultCollection } = await import('../services/defaultCollection');

    expect(await ensureDefaultCollection()).toBe(true);
    expect(await ensureDefaultCollection()).toBe(false);
    expect(collectionsStore.value).toHaveLength(1);
  });

  it('honours explicit creatorUserId when caller supplies one', async () => {
    usersStore.value = [
      { id: 'admin-001', role: 'admin', username: 'robin' },
      { id: 'user-002', role: 'user', username: 'someone' },
    ];

    const { ensureDefaultCollection } = await import('../services/defaultCollection');

    await ensureDefaultCollection('user-002');
    expect(collectionsStore.value[0].createdBy).toBe('user-002');
  });

  it('falls back to any user when no admin exists', async () => {
    usersStore.value = [{ id: 'user-001', role: 'user', username: 'someone' }];

    const { ensureDefaultCollection } = await import('../services/defaultCollection');

    expect(await ensureDefaultCollection()).toBe(true);
    expect(collectionsStore.value[0].createdBy).toBe('user-001');
  });

  it('skips and warns when no users exist (rare race / fresh-test env)', async () => {
    usersStore.value = [];

    const { ensureDefaultCollection } = await import('../services/defaultCollection');

    expect(await ensureDefaultCollection()).toBe(false);
    expect(collectionsStore.value).toHaveLength(0);
  });

  it('picks the lowest-id admin deterministically when multiple admins exist', async () => {
    usersStore.value = [
      { id: 'admin-003', role: 'admin', username: 'c' },
      { id: 'admin-001', role: 'admin', username: 'a' },
      { id: 'admin-002', role: 'admin', username: 'b' },
    ];

    const { ensureDefaultCollection } = await import('../services/defaultCollection');

    await ensureDefaultCollection();
    expect(collectionsStore.value[0].createdBy).toBe('admin-001');
  });
});
