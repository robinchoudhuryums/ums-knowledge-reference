/**
 * Database Users Repository
 *
 * PostgreSQL implementation for user CRUD operations.
 * Replaces S3 JSON file storage (users.json) with the `users` table.
 */

import { getPool } from '../config/database';
import { User } from '../types';
import { logger } from '../utils/logger';

/**
 * Get all users from the database.
 */
export async function dbGetUsers(): Promise<User[]> {
  const pool = getPool();
  const result = await pool.query(`
    SELECT id, username, password_hash, role, created_at, last_login,
           must_change_password, failed_login_attempts, locked_until,
           password_history, allowed_collections, mfa_secret, mfa_enabled, email, mfa_recovery_codes,
           sso_sub, sso_source
    FROM users ORDER BY created_at
  `);

  return result.rows.map(mapRowToUser);
}

/**
 * Save the full user list (upsert all users).
 * This matches the existing S3 pattern where the entire users array is written at once.
 */
export async function dbSaveUsers(users: User[]): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    for (const user of users) {
      await client.query(`
        INSERT INTO users (id, username, password_hash, role, created_at, last_login,
                          must_change_password, failed_login_attempts, locked_until,
                          password_history, allowed_collections, mfa_secret, mfa_enabled, email, mfa_recovery_codes,
                          sso_sub, sso_source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT (id) DO UPDATE SET
          username = EXCLUDED.username,
          password_hash = EXCLUDED.password_hash,
          role = EXCLUDED.role,
          last_login = EXCLUDED.last_login,
          must_change_password = EXCLUDED.must_change_password,
          failed_login_attempts = EXCLUDED.failed_login_attempts,
          locked_until = EXCLUDED.locked_until,
          password_history = EXCLUDED.password_history,
          allowed_collections = EXCLUDED.allowed_collections,
          mfa_secret = EXCLUDED.mfa_secret,
          mfa_enabled = EXCLUDED.mfa_enabled,
          email = EXCLUDED.email,
          mfa_recovery_codes = EXCLUDED.mfa_recovery_codes,
          sso_sub = EXCLUDED.sso_sub,
          sso_source = EXCLUDED.sso_source
      `, [
        user.id,
        user.username,
        user.passwordHash,
        user.role,
        user.createdAt,
        user.lastLogin || null,
        user.mustChangePassword || false,
        user.failedLoginAttempts || 0,
        user.lockedUntil || null,
        user.passwordHistory || [],
        user.allowedCollections || [],
        user.mfaSecret || null,
        user.mfaEnabled || false,
        user.email || null,
        user.mfaRecoveryCodes || [],
        user.ssoSub || null,
        user.ssoSource || null,
      ]);
    }

    // Delete users not in the list (handles user deletion).
    // Safety: never delete ALL users — if the list is empty, something went wrong upstream.
    // A system must always have at least one admin user.
    const ids = users.map(u => u.id);
    if (ids.length > 0) {
      await client.query('DELETE FROM users WHERE id != ALL($1)', [ids]);
    } else {
      logger.warn('dbSaveUsers called with empty user list — skipping delete to prevent data loss');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Failed to save users to database', { error: String(err) });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Map a database row to a User object (camelCase).
 */
function mapRowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    username: row.username as string,
    passwordHash: row.password_hash as string,
    role: row.role as 'admin' | 'user',
    createdAt: (row.created_at as Date)?.toISOString() || '',
    lastLogin: (row.last_login as Date)?.toISOString(),
    mustChangePassword: row.must_change_password as boolean,
    failedLoginAttempts: row.failed_login_attempts as number,
    lockedUntil: (row.locked_until as Date)?.toISOString(),
    passwordHistory: row.password_history as string[],
    allowedCollections: (row.allowed_collections as string[])?.length > 0
      ? row.allowed_collections as string[]
      : undefined,
    mfaSecret: row.mfa_secret as string | undefined,
    mfaEnabled: row.mfa_enabled as boolean | undefined,
    email: row.email as string | undefined,
    mfaRecoveryCodes: (row.mfa_recovery_codes as string[])?.length > 0
      ? row.mfa_recovery_codes as string[]
      : undefined,
    ssoSub: row.sso_sub as string | undefined,
    ssoSource: row.sso_source as string | undefined,
  };
}
