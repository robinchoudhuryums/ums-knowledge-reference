/**
 * PostgreSQL Database Configuration
 *
 * Manages the connection pool for the UMS Knowledge Base PostgreSQL database.
 * Uses the `pg` library with SSL enabled for RDS connections.
 *
 * Environment variables:
 *   DATABASE_URL — Full connection string (preferred for Render/Heroku)
 *     e.g. postgresql://user:pass@host:5432/ums_knowledge?sslmode=require
 *
 *   Or individual variables:
 *     DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DB_SSL
 */

import { Pool, PoolConfig } from 'pg';
import { logger } from '../utils/logger';

let pool: Pool | null = null;

function buildPoolConfig(): PoolConfig {
  // Prefer DATABASE_URL (standard for PaaS deployments)
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('sslmode=require') || process.env.DB_SSL !== 'false'
        ? { rejectUnauthorized: false } // RDS uses self-signed certs
        : undefined,
      max: parseInt(process.env.DB_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      statement_timeout: 30_000, // 30s query timeout
    };
  }

  // Fall back to individual variables
  const host = process.env.DB_HOST;
  const port = parseInt(process.env.DB_PORT || '5432', 10);
  const database = process.env.DB_NAME || 'ums_knowledge';
  const user = process.env.DB_USER;
  const password = process.env.DB_PASSWORD;

  if (!host || !user || !password) {
    // Database not configured — return config that will fail on first use
    // This allows the app to start in S3-only mode during migration
    logger.warn('Database not configured — RDS features disabled. Set DATABASE_URL or DB_HOST/DB_USER/DB_PASSWORD.');
    return { host: 'not-configured', database: 'not-configured' };
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : undefined,
    max: parseInt(process.env.DB_POOL_MAX || '10', 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  };
}

/**
 * Get the shared connection pool. Creates it on first call (lazy init).
 */
export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildPoolConfig());

    pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err.message });
    });
  }
  return pool;
}

/**
 * Check if the database is configured and reachable.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const p = getPool();
    const result = await p.query('SELECT 1');
    return result.rowCount === 1;
  } catch {
    return false;
  }
}

/**
 * Gracefully close the connection pool (call on shutdown).
 */
export async function closeDatabasePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}
