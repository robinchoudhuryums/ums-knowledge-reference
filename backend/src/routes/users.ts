import { Router, Response } from 'express';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { authenticate, requireAdmin, AuthRequest, getUsers, saveUsers, revokeAllUserTokens } from '../middleware/auth';
import { logAuditEvent } from '../services/audit';
import { logger } from '../utils/logger';

const router = Router();

// All user management routes require admin access
router.use(authenticate, requireAdmin);

/**
 * GET /api/users — List all users (admin only).
 * Never returns passwordHash or passwordHistory.
 */
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const users = await getUsers();
    const sanitized = users.map(u => ({
      id: u.id,
      username: u.username,
      role: u.role,
      createdAt: u.createdAt,
      lastLogin: u.lastLogin || null,
      mustChangePassword: !!u.mustChangePassword,
    }));
    res.json({ users: sanitized });
  } catch (error) {
    logger.error('Failed to list users', { error: String(error) });
    res.status(500).json({ error: 'Failed to list users' });
  }
});

/**
 * PUT /api/users/:id/role — Update a user's role (admin only).
 * Body: { role: 'admin' | 'user' }
 */
router.put('/:id/role', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!role || !['admin', 'user'].includes(role)) {
      res.status(400).json({ error: 'role must be "admin" or "user"' });
      return;
    }

    const users = await getUsers();
    const user = users.find(u => u.id === id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Prevent demoting the last admin
    if (user.role === 'admin' && role === 'user') {
      const adminCount = users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot demote the last admin user' });
        return;
      }
    }

    const previousRole = user.role;
    user.role = role;
    await saveUsers(users);

    await logAuditEvent(req.user!.id, req.user!.username, 'user_update', {
      targetUserId: id,
      targetUsername: user.username,
      previousRole,
      newRole: role,
    });

    logger.info('User role updated', { targetUserId: id, targetUsername: user.username, previousRole, newRole: role, updatedBy: req.user!.username });

    res.json({ user: { id: user.id, username: user.username, role: user.role } });
  } catch (error) {
    logger.error('Failed to update user role', { error: String(error) });
    res.status(500).json({ error: 'Failed to update user role' });
  }
});

/**
 * DELETE /api/users/:id — Delete a user (admin only).
 * Prevents deleting yourself or the last admin.
 */
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (id === req.user!.id) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    const users = await getUsers();
    const userIndex = users.findIndex(u => u.id === id);

    if (userIndex === -1) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = users[userIndex];

    // Prevent deleting the last admin
    if (user.role === 'admin') {
      const adminCount = users.filter(u => u.role === 'admin').length;
      if (adminCount <= 1) {
        res.status(400).json({ error: 'Cannot delete the last admin user' });
        return;
      }
    }

    users.splice(userIndex, 1);
    await saveUsers(users);

    await logAuditEvent(req.user!.id, req.user!.username, 'user_delete', {
      targetUserId: id,
      targetUsername: user.username,
      targetRole: user.role,
    });

    logger.info('User deleted', { targetUserId: id, targetUsername: user.username, deletedBy: req.user!.username });

    res.json({ message: `User "${user.username}" deleted` });
  } catch (error) {
    logger.error('Failed to delete user', { error: String(error) });
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /api/users/:id/reset-password — Admin force-reset password.
 * Generates a temporary password, sets mustChangePassword=true, returns the temp password.
 */
router.post('/:id/reset-password', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const users = await getUsers();
    const user = users.find(u => u.id === id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    // Generate a random temporary password (16 chars, URL-safe)
    const tempPassword = crypto.randomBytes(12).toString('base64url').slice(0, 16);

    // Push current hash into password history before overwriting
    const history = user.passwordHistory || [];
    history.unshift(user.passwordHash);
    user.passwordHistory = history.slice(0, 5);

    user.passwordHash = await bcrypt.hash(tempPassword, 12);
    user.mustChangePassword = true;
    // Reset lockout state so the user can log in with the temp password
    user.failedLoginAttempts = 0;
    user.lockedUntil = undefined;

    await saveUsers(users);

    // Revoke all existing sessions for this user — their old tokens should
    // no longer be valid after an admin password reset.
    revokeAllUserTokens(id);

    await logAuditEvent(req.user!.id, req.user!.username, 'user_reset_password', {
      targetUserId: id,
      targetUsername: user.username,
    });

    logger.info('Password reset by admin', { targetUserId: id, targetUsername: user.username, resetBy: req.user!.username });

    res.json({ temporaryPassword: tempPassword, message: `Password reset for "${user.username}". User must change password on next login.` });
  } catch (error) {
    logger.error('Failed to reset user password', { error: String(error) });
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

/**
 * PUT /api/users/:id/collections — Update a user's allowed collections (admin only).
 * Body: { allowedCollections: string[] }
 * Pass an empty array to grant access to all collections.
 */
router.put('/:id/collections', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { allowedCollections } = req.body;

    if (!Array.isArray(allowedCollections) || allowedCollections.some((c: unknown) => typeof c !== 'string')) {
      res.status(400).json({ error: 'allowedCollections must be an array of collection ID strings' });
      return;
    }

    const users = await getUsers();
    const user = users.find(u => u.id === id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    user.allowedCollections = allowedCollections.length > 0 ? allowedCollections : undefined;
    await saveUsers(users);

    await logAuditEvent(req.user!.id, req.user!.username, 'user_update', {
      targetUserId: id,
      targetUsername: user.username,
      action: 'collections_updated',
      allowedCollections: user.allowedCollections || 'all',
    });

    logger.info('User collections updated', { targetUserId: id, targetUsername: user.username, allowedCollections: user.allowedCollections || 'all', updatedBy: req.user!.username });

    res.json({ user: { id: user.id, username: user.username, allowedCollections: user.allowedCollections || [] } });
  } catch (error) {
    logger.error('Failed to update user collections', { error: String(error) });
    res.status(500).json({ error: 'Failed to update user collections' });
  }
});

/**
 * DELETE /api/users/:id/mfa — Admin-disable MFA for a user.
 * Used when a user loses their authenticator device.
 */
router.delete('/:id/mfa', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Prevent admins from disabling their own MFA through this endpoint
    // (they should use the self-service /api/auth/mfa/disable instead)
    if (id === req.user!.id) {
      res.status(400).json({ error: 'Use /api/auth/mfa/disable to disable your own MFA' });
      return;
    }

    const users = await getUsers();
    const user = users.find(u => u.id === id);

    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }

    if (!user.mfaEnabled) {
      res.status(400).json({ error: 'MFA is not enabled for this user' });
      return;
    }

    user.mfaSecret = undefined;
    user.mfaEnabled = false;
    await saveUsers(users);

    await logAuditEvent(req.user!.id, req.user!.username, 'user_update', {
      targetUserId: id,
      targetUsername: user.username,
      action: 'mfa_disabled_by_admin',
    });

    logger.info('MFA disabled by admin', { targetUserId: id, targetUsername: user.username, disabledBy: req.user!.username });
    res.json({ message: `MFA disabled for ${user.username}` });
  } catch (error) {
    logger.error('Failed to disable user MFA', { error: String(error) });
    res.status(500).json({ error: 'Failed to disable MFA' });
  }
});

export default router;
