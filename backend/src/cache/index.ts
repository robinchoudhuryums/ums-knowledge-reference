/**
 * Cache singleton — automatically selects Redis when REDIS_URL is configured,
 * falls back to in-memory for single-instance deployments.
 */

import { CacheProvider, SetProvider } from './interfaces';
import { MemoryCacheProvider, MemorySetProvider } from './memoryCache';
import { logger } from '../utils/logger';

let _cache: CacheProvider | null = null;
let _sets: SetProvider | null = null;

function initCache(): { cache: CacheProvider; sets: SetProvider } {
  if (process.env.REDIS_URL) {
    try {
      // Dynamic import to avoid loading ioredis when not needed
      const { getRedisClient, RedisCacheProvider, RedisSetProvider } = require('./redisCache');
      const client = getRedisClient();
      if (client) {
        logger.info('[Cache] Using Redis backend');
        return {
          cache: new RedisCacheProvider(client),
          sets: new RedisSetProvider(client),
        };
      }
    } catch (err) {
      logger.warn('[Cache] Redis initialization failed, falling back to in-memory', { error: String(err) });
    }
  }

  logger.info('[Cache] Using in-memory backend (set REDIS_URL for multi-instance support)');
  return {
    cache: new MemoryCacheProvider(),
    sets: new MemorySetProvider(),
  };
}

export function getCache(): CacheProvider {
  if (!_cache) {
    const result = initCache();
    _cache = result.cache;
    _sets = result.sets;
  }
  return _cache;
}

export function getSets(): SetProvider {
  if (!_sets) {
    const result = initCache();
    _cache = result.cache;
    _sets = result.sets;
  }
  return _sets;
}

// Convenience: direct exports for simple access via lazy proxy
export const cache: CacheProvider = new Proxy({} as CacheProvider, {
  get: (_target, prop) => {
    const real = getCache() as unknown as Record<string, unknown>;
    return real[prop as string];
  },
});

export const sets: SetProvider = new Proxy({} as SetProvider, {
  get: (_target, prop) => {
    const real = getSets() as unknown as Record<string, unknown>;
    return real[prop as string];
  },
});

export type { CacheProvider, SetProvider } from './interfaces';
