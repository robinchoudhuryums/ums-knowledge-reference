/**
 * Database Migration Runner
 *
 * Reads SQL migration files from backend/migrations/ and applies any
 * that haven't been run yet (tracked in schema_migrations table).
 *
 * Usage:
 *   npx tsx src/config/migrate.ts
 *
 * Or from the app on startup:
 *   import { runMigrations } from './config/migrate';
 *   await runMigrations();
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getPool, closeDatabasePool } from './database';
import { logger } from '../utils/logger';

const MIGRATIONS_DIR = join(__dirname, '../../migrations');

export async function runMigrations(): Promise<void> {
  const pool = getPool();

  // Ensure schema_migrations table exists
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  // Get already-applied versions
  const applied = await pool.query('SELECT version FROM schema_migrations ORDER BY version');
  const appliedVersions = new Set(applied.rows.map((r: { version: number }) => r.version));

  // Find migration files (format: NNN_name.sql)
  const files = readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let migrationsRun = 0;
  for (const file of files) {
    const match = file.match(/^(\d+)_/);
    if (!match) continue;
    const version = parseInt(match[1], 10);

    if (appliedVersions.has(version)) continue;

    logger.info(`Running migration: ${file}`);
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf-8');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [version, file]
      );
      await client.query('COMMIT');
      migrationsRun++;
      logger.info(`Migration applied: ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      logger.error(`Migration failed: ${file}`, { error: String(err) });
      throw err;
    } finally {
      client.release();
    }
  }

  if (migrationsRun === 0) {
    logger.info('Database schema is up to date');
  } else {
    logger.info(`Applied ${migrationsRun} migration(s)`);
  }
}

// Allow running directly: npx tsx src/config/migrate.ts
if (require.main === module) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config();
  runMigrations()
    .then(() => { logger.info('Migrations complete'); process.exit(0); })
    .catch((err) => { logger.error('Migration failed', { error: String(err) }); process.exit(1); })
    .finally(() => closeDatabasePool());
}
