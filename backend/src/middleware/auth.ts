import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../types';
import { loadMetadata, saveMetadata } from '../services/s3Storage';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'ums-kb-dev-secret-change-in-production';
const USERS_KEY = 'users.json';

// JWT expiry: 30 minutes for HIPAA compliance (down from 8 hours)
const JWT_EXPIRY = (process.env.JWT_EXPIRY || '30m') as jwt.SignOptions['expiresIn'];

// Warn at startup if using the default JWT secret
if (!process.env.JWT_SECRET) {
  console.warn('[SECURITY WARNING] JWT_SECRET not set — using insecure default. Set JWT_SECRET in production!');
}

const MIN_PASSWORD_LENGTH = 8;

function validatePassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least one uppercase letter';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must contain at least one lowercase letter';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least one number';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Server-side token revocation
// In-memory set of revoked JWT IDs. Cleared on server restart (acceptable since
// JWTs are short-lived at 30min). For multi-instance deployments, move to Redis.
// ---------------------------------------------------------------------------
const revokedTokens = new Set<string>();

export function revokeToken(jti: string): void {
  revokedTokens.add(jti);
  // Auto-clean after 35 minutes (JWT expiry + buffer)
  setTimeout(() => revokedTokens.delete(jti), 35 * 60 * 1000);
}

function isTokenRevoked(jti: string): boolean {
  return revokedTokens.has(jti);
}

// ---------------------------------------------------------------------------

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: 'admin' | 'user'; jti?: string };
}

async function getUsers(): Promise<User[]> {
  const users = await loadMetadata<User[]>(USERS_KEY);
  return users || [];
}

async function saveUsers(users: User[]): Promise<void> {
  await saveMetadata(USERS_KEY, users);
}

/**
 * Initialize default admin user if no users exist.
 * Default admin is flagged with mustChangePassword = true.
 */
export async function initializeAuth(): Promise<void> {
  const users = await getUsers();
  if (users.length === 0) {
    const passwordHash = await bcrypt.hash('admin', 12);
    const adminUser: User = {
      id: 'admin-001',
      username: 'admin',
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString(),
      mustChangePassword: true,
    };
    await saveUsers([adminUser]);
    logger.info('Default admin user created (username: admin) — password change required on first login');
  }
}

/**
 * Login endpoint handler.
 * Returns mustChangePassword flag so frontend can force password change.
 */
export async function loginHandler(req: Request, res: Response): Promise<void> {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.username === username);

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Generate a unique token ID for revocation support
  const jti = `${user.id}-${Date.now()}`;

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, role: user.role },
    mustChangePassword: !!user.mustChangePassword,
  });
}

/**
 * Change password endpoint handler.
 */
export async function changePasswordHandler(req: AuthRequest, res: Response): Promise<void> {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'Current password and new password are required' });
    return;
  }

  const passwordError = validatePassword(newPassword);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const users = await getUsers();
  const user = users.find(u => u.id === req.user!.id);

  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  await saveUsers(users);

  // Revoke current token so user must re-login with new password
  if (req.user?.jti) {
    revokeToken(req.user.jti);
  }

  // Issue new token
  const jti = `${user.id}-${Date.now()}`;
  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, jti },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );

  logger.info('Password changed', { userId: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
}

/**
 * Logout endpoint handler — revokes the current token server-side.
 */
export async function logoutHandler(req: AuthRequest, res: Response): Promise<void> {
  if (req.user?.jti) {
    revokeToken(req.user.jti);
  }
  res.json({ message: 'Logged out' });
}

/**
 * Create a new user (admin only).
 */
export async function createUserHandler(req: AuthRequest, res: Response): Promise<void> {
  const { username, password, role } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password are required' });
    return;
  }

  const passwordError = validatePassword(password);
  if (passwordError) {
    res.status(400).json({ error: passwordError });
    return;
  }

  const users = await getUsers();
  if (users.find(u => u.username === username)) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const newUser: User = {
    id: `user-${Date.now()}`,
    username,
    passwordHash,
    role: role === 'admin' ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);
  await saveUsers(users);

  res.status(201).json({ user: { id: newUser.id, username: newUser.username, role: newUser.role } });
}

/**
 * JWT authentication middleware.
 * Checks token validity AND server-side revocation.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: 'admin' | 'user'; jti?: string };

    // Check server-side revocation
    if (decoded.jti && isTokenRevoked(decoded.jti)) {
      res.status(401).json({ error: 'Token has been revoked' });
      return;
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Admin-only authorization middleware.
 */
export function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}
