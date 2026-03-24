import { CacheProvider, SetProvider } from './interfaces';
import { MemoryCacheProvider, MemorySetProvider } from './memoryCache';

/**
 * Singleton cache instances.
 * Swap these implementations to Redis/ElastiCache for horizontal scaling.
 */
export const cache: CacheProvider = new MemoryCacheProvider();
export const sets: SetProvider = new MemorySetProvider();

export type { CacheProvider, SetProvider } from './interfaces';
