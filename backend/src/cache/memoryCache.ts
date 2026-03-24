import { CacheProvider, SetProvider } from './interfaces';

const MAX_ENTRIES = 10_000;

interface CacheEntry<T = unknown> {
  value: T;
  createdAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * In-memory CacheProvider backed by a Map.
 * Supports optional TTL (auto-delete after ttlMs).
 * Evicts oldest entries when MAX_ENTRIES is exceeded.
 */
export class MemoryCacheProvider implements CacheProvider {
  private store = new Map<string, CacheEntry>();

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    // Clear any existing timer for this key
    const existing = this.store.get(key);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    // Evict oldest entries if at capacity
    if (!this.store.has(key) && this.store.size >= MAX_ENTRIES) {
      this.evictOldest();
    }

    const entry: CacheEntry = { value, createdAt: Date.now() };

    if (ttlMs && ttlMs > 0) {
      entry.timer = setTimeout(() => {
        this.store.delete(key);
      }, ttlMs);
      // Prevent timer from keeping the process alive
      if (entry.timer && typeof entry.timer === 'object' && 'unref' in entry.timer) {
        entry.timer.unref();
      }
    }

    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    const entry = this.store.get(key);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }
    this.store.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  private evictOldest(): void {
    // Map iterates in insertion order; first key is oldest
    const firstKey = this.store.keys().next().value;
    if (firstKey !== undefined) {
      const entry = this.store.get(firstKey);
      if (entry?.timer) {
        clearTimeout(entry.timer);
      }
      this.store.delete(firstKey);
    }
  }
}

interface SetMember {
  timer?: ReturnType<typeof setTimeout>;
}

/**
 * In-memory SetProvider backed by Map<string, Map<string, SetMember>>.
 * Supports optional TTL per member.
 * Evicts oldest sets when MAX_ENTRIES total members is exceeded.
 */
export class MemorySetProvider implements SetProvider {
  private store = new Map<string, Map<string, SetMember>>();
  private totalMembers = 0;

  async add(key: string, member: string, ttlMs?: number): Promise<void> {
    let set = this.store.get(key);
    if (!set) {
      set = new Map();
      this.store.set(key, set);
    }

    // Clear existing timer if re-adding
    const existing = set.get(member);
    if (existing?.timer) {
      clearTimeout(existing.timer);
    }

    const isNew = !set.has(member);

    // Evict if at capacity
    if (isNew && this.totalMembers >= MAX_ENTRIES) {
      this.evictOldest();
    }

    const entry: SetMember = {};

    if (ttlMs && ttlMs > 0) {
      entry.timer = setTimeout(() => {
        this.removeMember(key, member);
      }, ttlMs);
      if (entry.timer && typeof entry.timer === 'object' && 'unref' in entry.timer) {
        entry.timer.unref();
      }
    }

    set.set(member, entry);
    if (isNew) this.totalMembers++;
  }

  async has(key: string, member: string): Promise<boolean> {
    const set = this.store.get(key);
    return set ? set.has(member) : false;
  }

  async remove(key: string, member: string): Promise<void> {
    this.removeMember(key, member);
  }

  private removeMember(key: string, member: string): void {
    const set = this.store.get(key);
    if (!set) return;

    const entry = set.get(member);
    if (entry?.timer) {
      clearTimeout(entry.timer);
    }

    if (set.delete(member)) {
      this.totalMembers--;
    }

    // Clean up empty sets
    if (set.size === 0) {
      this.store.delete(key);
    }
  }

  private evictOldest(): void {
    // Evict the first member from the first set (insertion order)
    const firstKey = this.store.keys().next().value;
    if (firstKey === undefined) return;

    const set = this.store.get(firstKey)!;
    const firstMember = set.keys().next().value;
    if (firstMember !== undefined) {
      this.removeMember(firstKey, firstMember);
    }
  }
}
