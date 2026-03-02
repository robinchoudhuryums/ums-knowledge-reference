import { UsageRecord, UsageLimits } from '../types';
import { loadMetadata, saveMetadata } from './s3Storage';
import { logger } from '../utils/logger';

const USAGE_PREFIX = 'usage/';
const LIMITS_KEY = 'usage-limits.json';

// Default limits — admin can adjust via API
const DEFAULT_LIMITS: UsageLimits = {
  dailyPerUser: 100,
  dailyTotal: 500,
  monthlyTotal: 10000,
};

// In-memory cache for fast checks (persisted to S3 periodically)
let todayRecord: UsageRecord | null = null;
let cachedLimits: UsageLimits | null = null;
let lastPersist = 0;
const PERSIST_INTERVAL_MS = 30_000; // persist every 30s at most

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function getMonthKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function ensureTodayRecord(): Promise<UsageRecord> {
  const today = getTodayKey();
  if (todayRecord && todayRecord.date === today) return todayRecord;

  const loaded = await loadMetadata<UsageRecord>(`${USAGE_PREFIX}${today}.json`);
  todayRecord = loaded || { date: today, users: {}, totalQueries: 0 };
  return todayRecord;
}

async function persistRecord(): Promise<void> {
  if (!todayRecord) return;
  const now = Date.now();
  if (now - lastPersist < PERSIST_INTERVAL_MS) return;

  await saveMetadata(`${USAGE_PREFIX}${todayRecord.date}.json`, todayRecord);
  lastPersist = now;
}

export async function getLimits(): Promise<UsageLimits> {
  if (cachedLimits) return cachedLimits;
  const loaded = await loadMetadata<UsageLimits>(LIMITS_KEY);
  cachedLimits = loaded || DEFAULT_LIMITS;
  return cachedLimits;
}

export async function setLimits(limits: UsageLimits): Promise<void> {
  cachedLimits = limits;
  await saveMetadata(LIMITS_KEY, limits);
}

/**
 * Check if a user can make another query. Returns { allowed, reason }.
 */
export async function checkUsageLimit(userId: string): Promise<{ allowed: boolean; reason?: string; usage?: { userToday: number; totalToday: number } }> {
  const record = await ensureTodayRecord();
  const limits = await getLimits();

  const userUsage = record.users[userId]?.queryCount || 0;
  const usage = { userToday: userUsage, totalToday: record.totalQueries };

  if (userUsage >= limits.dailyPerUser) {
    return { allowed: false, reason: `Daily limit reached (${limits.dailyPerUser} queries/day). Try again tomorrow.`, usage };
  }

  if (record.totalQueries >= limits.dailyTotal) {
    return { allowed: false, reason: `Team daily limit reached (${limits.dailyTotal} queries/day). Contact your admin.`, usage };
  }

  return { allowed: true, usage };
}

/**
 * Record a query for a user.
 */
export async function recordQuery(userId: string): Promise<void> {
  const record = await ensureTodayRecord();

  if (!record.users[userId]) {
    record.users[userId] = { queryCount: 0, lastQuery: '' };
  }
  record.users[userId].queryCount++;
  record.users[userId].lastQuery = new Date().toISOString();
  record.totalQueries++;

  // Persist periodically (not every single query — S3 writes are not free)
  await persistRecord();
}

/**
 * Force persist the current usage record (call on shutdown or at end of request).
 */
export async function flushUsage(): Promise<void> {
  if (!todayRecord) return;
  lastPersist = 0; // Reset so it actually writes
  await persistRecord();
}

/**
 * Get usage stats for admin dashboard.
 */
export async function getUsageStats(): Promise<{
  today: UsageRecord;
  limits: UsageLimits;
}> {
  const record = await ensureTodayRecord();
  const limits = await getLimits();
  return { today: record, limits };
}
