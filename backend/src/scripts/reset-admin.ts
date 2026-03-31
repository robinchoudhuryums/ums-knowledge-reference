#!/usr/bin/env node
/**
 * Admin Password Reset Script
 *
 * Resets the admin user's password when the initial random password is lost
 * or the account is locked out. Run inside the Docker container or on the
 * EC2 instance where the app is deployed.
 *
 * Usage:
 *   node backend/dist/scripts/reset-admin.js [new-password]
 *
 *   If no password is provided, a random one is generated and printed.
 *
 * Examples:
 *   # Inside Docker container:
 *   docker exec -it ums-knowledge node backend/dist/scripts/reset-admin.js
 *
 *   # On EC2 directly:
 *   cd ~/ums-knowledge-reference
 *   npx tsx backend/src/scripts/reset-admin.ts
 *
 *   # With a specific password:
 *   npx tsx backend/src/scripts/reset-admin.ts "MyNewP@ssw0rd!"
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';

// Minimal bootstrap — don't start the full server
async function main() {
  const newPassword = process.argv[2] || crypto.randomBytes(16).toString('base64url').slice(0, 20);

  // Validate password strength
  if (newPassword.length < 8) {
    console.error('Error: Password must be at least 8 characters.');
    process.exit(1);
  }

  // Try database first, fall back to S3
  if (process.env.DATABASE_URL) {
    try {
      const { Pool } = await import('pg');
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' },
      });
      const passwordHash = await bcrypt.hash(newPassword, 12);

      const result = await pool.query(
        `UPDATE users SET
          password_hash = $1,
          must_change_password = true,
          failed_login_attempts = 0,
          locked_until = NULL
        WHERE username = 'admin'
        RETURNING id, username`,
        [passwordHash]
      );

      if (result.rowCount === 0) {
        // No admin user exists — create one
        const id = crypto.randomUUID();
        await pool.query(
          `INSERT INTO users (id, username, password_hash, role, created_at, must_change_password, failed_login_attempts)
           VALUES ($1, 'admin', $2, 'admin', NOW(), true, 0)`,
          [id, passwordHash]
        );
        console.log('Created new admin user.');
      } else {
        console.log(`Reset password for user: ${result.rows[0].username} (${result.rows[0].id})`);
      }

      await pool.end();
    } catch (err) {
      console.error('Database error:', err);
      process.exit(1);
    }
  } else {
    // S3 mode — need AWS SDK
    try {
      const { S3Client, GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3');
      const bucket = process.env.S3_BUCKET;
      const region = process.env.AWS_REGION || 'us-east-1';

      if (!bucket) {
        console.error('Error: S3_BUCKET environment variable is required.');
        process.exit(1);
      }

      const s3 = new S3Client({ region });
      const key = 'metadata/users.json';

      // Load existing users
      let users: any[] = [];
      try {
        const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const body = await resp.Body?.transformToString();
        if (body) users = JSON.parse(body);
      } catch {
        // No users file yet
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      const admin = users.find((u: any) => u.username === 'admin');

      if (admin) {
        admin.passwordHash = passwordHash;
        admin.mustChangePassword = true;
        admin.failedLoginAttempts = 0;
        admin.lockedUntil = undefined;
        console.log(`Reset password for user: ${admin.username} (${admin.id})`);
      } else {
        users.push({
          id: crypto.randomUUID(),
          username: 'admin',
          passwordHash,
          role: 'admin',
          createdAt: new Date().toISOString(),
          mustChangePassword: true,
        });
        console.log('Created new admin user.');
      }

      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(users, null, 2),
        ContentType: 'application/json',
        ServerSideEncryption: 'AES256',
      }));
    } catch (err) {
      console.error('S3 error:', err);
      process.exit(1);
    }
  }

  console.log('\n========================================');
  console.log(`  Username: admin`);
  console.log(`  Password: ${newPassword}`);
  console.log(`  Must change on first login: YES`);
  console.log('========================================');
  console.log('\nAccount lockout has been cleared.');
  console.log('Change this password immediately after login.\n');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
