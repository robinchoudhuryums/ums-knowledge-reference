/**
 * Cache provider interface for horizontal scaling.
 * In single-instance mode, uses in-memory maps.
 * For multi-instance, swap to Redis/ElastiCache.
 */
export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  has(key: string): Promise<boolean>;
}

export interface SetProvider {
  add(key: string, member: string, ttlMs?: number): Promise<void>;
  has(key: string, member: string): Promise<boolean>;
  remove(key: string, member: string): Promise<void>;
}
