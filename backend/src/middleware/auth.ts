import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { User } from '../types';
import { loadMetadata, saveMetadata } from '../services/s3Storage';
import { logger } from '../utils/logger';

const JWT_SECRET = process.env.JWT_SECRET || 'ums-kb-dev-secret-change-in-production';
const USERS_KEY = 'users.json';

export interface AuthRequest extends Request {
  user?: { id: string; username: string; role: 'admin' | 'user' };
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
 */
export async function initializeAuth(): Promise<void> {
  const users = await getUsers();
  if (users.length === 0) {
    const passwordHash = await bcrypt.hash('admin', 10);
    const adminUser: User = {
      id: 'admin-001',
      username: 'admin',
      passwordHash,
      role: 'admin',
      createdAt: new Date().toISOString(),
    };
    await saveUsers([adminUser]);
    logger.info('Default admin user created (username: admin, password: admin)');
  }
}

/**
 * Login endpoint handler.
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

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
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

  const users = await getUsers();
  if (users.find(u => u.username === username)) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);
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
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'No token provided' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: 'admin' | 'user' };
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
