/**
 * Redis-backed CacheProvider and SetProvider for horizontal scaling.
 *
 * When REDIS_URL is configured, replaces in-memory cache/sets with Redis,
 * enabling multi-instance deployments to share state (token revocation,
 * embedding cache, rate limiting, lockout cache).
 *
 * Configuration:
 *   REDIS_URL=redis://localhost:6379        — Redis connection string
 *   REDIS_URL=rediss://...                  — Redis with TLS (ElastiCache)
 *   REDIS_KEY_PREFIX=ums:                   — Key namespace (default: ums:)
 */

import Redis from 'ioredis';
import { CacheProvider, SetProvider } from './interfaces';
import { logger } from '../utils/logger';

let redisClient: Redis | null = null;

/**
 * Get the shared Redis client. Creates on first call.
 * Returns null if REDIS_URL is not configured.
 */
export function getRedisClient(): Redis | null {
  if (redisClient) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  redisClient = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => {
      if (times > 5) return null; // Stop retrying after 5 attempts
      return Math.min(times * 500, 3000); // 500ms, 1s, 1.5s, 2s, 2.5s
    },
    lazyConnect: true,
  });

  redisClient.on('connect', () => logger.info('[Redis] Connected'));
  redisClient.on('error', (err) => logger.error('[Redis] Connection error', { error: err.message }));
  redisClient.on('close', () => logger.warn('[Redis] Connection closed'));

  // Connect immediately (non-blocking)
  redisClient.connect().catch((err) => {
    logger.error('[Redis] Initial connection failed', { error: String(err) });
  });

  return redisClient;
}

const PREFIX = process.env.REDIS_KEY_PREFIX || 'ums:';

/**
 * Redis-backed CacheProvider.
 * Values are JSON-serialized. TTL is supported via Redis PSETEX.
 */
export class RedisCacheProvider implements CacheProvider {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(`${PREFIX}cache:${key}`);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch (err) {
      logger.warn('[Redis] Cache get failed', { key, error: String(err) });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttlMs && ttlMs > 0) {
        await this.client.psetex(`${PREFIX}cache:${key}`, ttlMs, serialized);
      } else {
        await this.client.set(`${PREFIX}cache:${key}`, serialized);
      }
    } catch (err) {
      logger.warn('[Redis] Cache set failed', { key, error: String(err) });
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await this.client.del(`${PREFIX}cache:${key}`);
    } catch (err) {
      logger.warn('[Redis] Cache delete failed', { key, error: String(err) });
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      return (await this.client.exists(`${PREFIX}cache:${key}`)) === 1;
    } catch {
      return false;
    }
  }
}

/**
 * Redis-backed SetProvider.
 * Uses Redis Sets (SADD/SISMEMBER/SREM). TTL is per-member via a companion
 * sorted set that tracks expiry times, cleaned on access.
 *
 * For simplicity, we use individual keys with PSETEX for per-member TTL.
 * Key format: ums:set:{key}:{member}
 */
export class RedisSetProvider implements SetProvider {
  private client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  async add(key: string, member: string, ttlMs?: number): Promise<void> {
    try {
      const redisKey = `${PREFIX}set:${key}:${member}`;
      if (ttlMs && ttlMs > 0) {
        await this.client.psetex(redisKey, ttlMs, '1');
      } else {
        await this.client.set(redisKey, '1');
      }
    } catch (err) {
      logger.warn('[Redis] Set add failed', { key, member, error: String(err) });
    }
  }

  async has(key: string, member: string): Promise<boolean> {
    try {
      return (await this.client.exists(`${PREFIX}set:${key}:${member}`)) === 1;
    } catch {
      return false;
    }
  }

  async remove(key: string, member: string): Promise<void> {
    try {
      await this.client.del(`${PREFIX}set:${key}:${member}`);
    } catch (err) {
      logger.warn('[Redis] Set remove failed', { key, member, error: String(err) });
    }
  }
}
