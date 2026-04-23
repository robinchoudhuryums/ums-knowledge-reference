import dotenv from 'dotenv';
dotenv.config();

// OpenTelemetry must be initialized before any other imports so auto-instrumentation
// hooks are registered before Express, HTTP, and AWS SDK modules load.
import './tracing';

// Sentry must be initialized early so it can capture errors from all modules.
import { initSentry, captureException as sentryCaptureException } from './utils/sentry';
initSentry();

import path from 'path';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';

// Redis-backed rate limit store (shared across instances) when REDIS_URL is set
let rateLimitStore: undefined | import('express-rate-limit').Store;
if (process.env.REDIS_URL) {
  try {
    const { RedisStore } = require('rate-limit-redis');
    const { getRedisClient } = require('./cache/redisCache');
    const client = getRedisClient();
    if (client) {
      rateLimitStore = new RedisStore({ sendCommand: (...args: string[]) => client.call(...args) });
      logger.info('[RateLimit] Using Redis store');
    }
  } catch {
    logger.warn('[RateLimit] Redis store init failed, using in-memory');
  }
}
import { runWithCorrelationId } from './utils/correlationId';
import { recordRequest, getMetricsSnapshot } from './utils/metrics';
import { validateEnv } from './utils/envValidation';
import { initializeAuth, loginHandler, createUserHandler, changePasswordHandler, logoutHandler, refreshTokenHandler, authenticate, requireAdmin, AuthRequest } from './middleware/auth';
import { initializeVectorStore, getVectorStoreStats } from './services/vectorStore';
import { s3Client, S3_BUCKET } from './config/aws';
import { checkDatabaseConnection } from './config/database';
import { startReindexScheduler } from './services/reindexer';
import { startFeeScheduleFetcher } from './services/feeScheduleFetcher';
import { startSourceMonitor } from './services/sourceMonitor';
import { startJobCleanup, loadPersistedJobs, flushJobs } from './services/jobQueue';
import { startOrphanCleanup } from './services/orphanCleanup';
import { startRetentionScheduler } from './services/dataRetention';
import { setMalwareScanAlertHandler } from './utils/malwareScan';
import { sendOperationalAlert } from './services/alertService';
import documentRoutes from './routes/documents';
import queryRoutes from './routes/query';
import feedbackRoutes from './routes/feedback';
import usageRoutes from './routes/usage';
import queryLogRoutes from './routes/queryLog';
import extractionRoutes from './routes/extraction';
import sourceMonitorRoutes from './routes/sourceMonitor';
import errorRoutes from './routes/errors';
import userRoutes from './routes/users';
import hcpcsRoutes from './routes/hcpcs';
import icd10Routes from './routes/icd10';
import coverageRoutes from './routes/coverage';
import ppdRoutes from './routes/ppd';
import accountCreationRoutes from './routes/accountCreation';
import papAccountCreationRoutes from './routes/papAccountCreation';
import productImageRoutes from './routes/productImages';
import formDraftsRoutes from './routes/formDrafts';
import evalRoutes from './routes/eval';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Security middleware
// When set (e.g. "https://umscallanalyzer.com"), allows that origin to
// iframe this service. Extends CSP frame-ancestors and disables
// X-Frame-Options (since CSP supersedes it in modern browsers). Unset =
// default-deny framing (current behavior). Used by CallAnalyzer to embed
// RAG's chat interface inline at /?embed=1.
import {
  buildCspDirectives,
  shouldDisableFrameguard,
  devFrameAncestorsHeader,
} from './middleware/cspDirectives';
const embedAllowedOrigin = process.env.EMBED_ALLOWED_ORIGIN || '';

app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production'
    ? { directives: buildCspDirectives(embedAllowedOrigin) }
    : false,
  frameguard: shouldDisableFrameguard(embedAllowedOrigin)
    ? false
    : { action: 'sameorigin' },
  crossOriginEmbedderPolicy: false,
}));

// Dev-mode defense-in-depth: helmet's full CSP is off in dev because
// Vite HMR needs 'unsafe-eval' etc, but that also drops frame-ancestors.
// Emit ONLY the frame-ancestors directive in dev when the embed is
// allowed, so a dev instance can't be iframed by arbitrary origins.
if (process.env.NODE_ENV !== 'production' && embedAllowedOrigin) {
  const devFrameAncestors = devFrameAncestorsHeader(embedAllowedOrigin);
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', devFrameAncestors);
    next();
  });
}

const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:5173';
if (corsOrigin === '*') {
  logger.warn('CORS_ORIGIN is set to "*" which is incompatible with credentials. Falling back to localhost.');
}
app.use(cors({
  origin: corsOrigin === '*' ? 'http://localhost:5173' : corsOrigin,
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// SSO introspection — runs after cookieParser so req.cookies is populated,
// before WAF + routes so it can bootstrap a RAG session cookie the normal
// authenticate middleware will then verify. No-op unless ENABLE_SSO=true
// and the request has a CA `connect.sid` without a RAG `ums_auth_token`.
import { trySsoIntrospection } from './middleware/sso';
app.use(trySsoIntrospection);

// Application-level WAF — must be after body parsing (needs parsed JSON)
// but before CSRF and routes (blocks malicious requests early)
import { wafMiddleware } from './middleware/waf';
app.use(wafMiddleware());

// Disable X-Powered-By (helmet does this too, belt + suspenders)
app.disable('x-powered-by');

// Trust first proxy (Render, ALB, etc.) — MUST be set before rate limiters
// so express-rate-limit can read the correct client IP from X-Forwarded-For.
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// ─── CSRF Protection (double-submit cookie pattern) ──────────────────
// On every response, set a random CSRF token cookie. State-changing requests
// (POST/PUT/DELETE) must echo that token back in the X-CSRF-Token header.
// Since cookies are set with SameSite=Strict, a cross-origin attacker cannot
// read the cookie value to include it in the header.
const CSRF_COOKIE = 'csrf_token';
const CSRF_HEADER = 'x-csrf-token';
// Unauthenticated endpoints are exempt from CSRF (no session to protect).
// Health check is exempt since ALB probes don't send cookies.
const CSRF_EXEMPT_PATHS = ['/api/auth/login', '/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/refresh', '/api/health'];

app.use((req, res, next) => {
  // Set/refresh the CSRF cookie on every response
  let csrfToken = req.cookies?.[CSRF_COOKIE];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
  }
  // SHARED_COOKIE_DOMAIN (e.g. ".umscallanalyzer.com") scopes the CSRF cookie
  // to the parent domain so it rides along with the shared session cookie
  // across subdomains. Imported via process.env to avoid a circular import
  // with authConfig; the same flag is consumed there for the auth + refresh
  // cookies. sameSite:strict is unchanged — strict is about cross-SITE
  // (registrable domain), not cross-subdomain on the same eTLD+1.
  const sharedCookieDomain = process.env.SHARED_COOKIE_DOMAIN;
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,  // Frontend JS needs to read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    ...(sharedCookieDomain ? { domain: sharedCookieDomain } : {}),
  });

  // Only enforce on state-changing methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // H1: Exact-match exemption list. The old `startsWith` prefix match would
    // have silently exempted any future route starting with an exempt path
    // (e.g. `/api/auth/login-sso` inheriting `/api/auth/login`'s exemption).
    if (!CSRF_EXEMPT_PATHS.includes(req.path)) {
      const headerToken = req.headers[CSRF_HEADER] as string | undefined;
      if (!headerToken || headerToken !== csrfToken) {
        res.status(403).json({ error: 'CSRF token missing or invalid' });
        return;
      }
    }
  }

  next();
});

// HTTPS enforcement in production — redirects HTTP requests and sets HSTS header.
// Behind Render/ALB the X-Forwarded-Proto header indicates the original protocol.
// Health check is exempt since ALB health checks don't send X-Forwarded-Proto.
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    // Skip HTTPS redirect for health check (ALB probes hit HTTP directly)
    if (req.path === '/api/health') {
      next();
      return;
    }
    if (req.headers['x-forwarded-proto'] !== 'https') {
      res.redirect(301, `https://${req.headers.host}${req.url}`);
      return;
    }
    // HSTS: tell browsers to always use HTTPS for 1 year
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}

// Request correlation ID + logging — assigns a unique ID per request for traceability
app.use((req, res, next) => {
  const correlationId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  res.setHeader('X-Request-Id', correlationId);

  runWithCorrelationId(correlationId, () => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`, {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: duration,
      });
      // Record metrics for observability endpoint
      recordRequest(req.method, req.originalUrl, res.statusCode, duration);
    });
    next();
  });
});

// Rate limiting — login: strict (brute force protection), API: general
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                     // 10 attempts per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(rateLimitStore && { store: rateLimitStore }),
});

// H2: Dedicated rate limit on MFA verify. An authenticated user or stolen
// access token can otherwise brute-force TOTP (~1M combinations) or recovery
// codes (~10) through the MFA verify endpoint, which previously only sat
// behind the global 120/min apiLimiter. 10 verify attempts per 15 min per
// user is enough for legitimate setup/re-setup traffic and forces an
// attacker into ~15min-per-10-codes territory.
const mfaVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many MFA verification attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(rateLimitStore && { store: rateLimitStore }),
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 120,              // 120 requests per minute globally (safety net)
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(rateLimitStore && { store: rateLimitStore }),
});

// Per-user rate limiting — keyed by JWT user ID to prevent one user from exhausting
// capacity for others. Falls back to IP for unauthenticated requests (login, health).
const perUserLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,               // 60 requests per user per minute
  message: { error: 'Too many requests from your account. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
  ...(rateLimitStore && { store: rateLimitStore }),
  keyGenerator: (req) => {
    // Extract user ID from JWT cookie or Authorization header without full verification
    // (rate limiting runs before auth middleware, so we best-effort extract the key)
    try {
      const cookieToken = req.cookies?.['ums_auth_token'];
      const authHeader = req.headers.authorization;
      const token = cookieToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null);
      if (token) {
        // Decode without verification (just for keying — auth middleware does real verification)
        const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
        if (payload.id) return `user:${payload.id}`;
      }
    } catch {
      // Fall through to IP-based key
    }
    return `ip:${req.ip}`;
  },
});

app.use('/api/', apiLimiter);
app.use('/api/', perUserLimiter);

// Health check — reports service status + dependency connectivity for ALB probes
app.get('/api/health', async (_req, res) => {
  const checks: Record<string, string> = {};
  let healthy = true;

  // S3 connectivity check (lightweight HeadBucket)
  try {
    const { HeadBucketCommand } = await import('@aws-sdk/client-s3');
    await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
    checks.s3 = 'ok';
  } catch {
    checks.s3 = 'error';
    healthy = false;
  }

  // Database connectivity check
  // Database is optional: when DATABASE_URL is not set, the app uses S3 JSON fallback.
  // Only mark unhealthy if database IS configured but unreachable (connection error).
  try {
    const dbOk = await checkDatabaseConnection();
    if (dbOk) {
      checks.database = 'ok';
    } else if (process.env.DATABASE_URL) {
      // Database is configured but connection failed — mark degraded
      checks.database = 'error';
      healthy = false;
    } else {
      checks.database = 'not_configured';
    }
  } catch {
    checks.database = 'error';
    if (process.env.DATABASE_URL) healthy = false;
  }

  // Vector store loaded check
  const vsStats = await getVectorStoreStats();
  checks.vectorStore = vsStats.lastUpdated ? 'ok' : 'error';
  if (checks.vectorStore === 'error') healthy = false;

  // Embedding model mismatch degrades search but doesn't take down the service
  if (vsStats.modelMismatch) {
    checks.embeddingModel = 'mismatch';
  }

  const status = healthy ? 'ok' : 'degraded';
  res.status(healthy ? 200 : 503).json({
    status,
    service: 'ums-knowledge-base',
    uptime: Math.round(process.uptime()),
    checks,
    vectorStoreChunks: vsStats.totalChunks,
    ...(vsStats.modelMismatch ? {
      embeddingModelMismatch: {
        ...vsStats.modelMismatch,
        fix: 'POST /api/documents/reindex-embeddings to re-embed all chunks with the current model',
      },
    } : {}),
  });
});

// Metrics endpoint — request counts, latency percentiles, memory usage (admin only)
app.get('/api/metrics', authenticate, requireAdmin, (_req: express.Request, res: express.Response) => {
  res.json(getMetricsSnapshot());
});

// Model tiers — admin introspection + runtime override
// GET returns the current effective model per tier with its source (override/env/legacy-env/default).
// PATCH sets or clears a tier override; persists to S3 so it survives restart.
app.get('/api/admin/model-tiers', authenticate, requireAdmin, async (_req, res) => {
  const { getAllTierSnapshots } = await import('./services/modelTiers');
  res.json({ tiers: getAllTierSnapshots() });
});

app.patch('/api/admin/model-tiers', authenticate, requireAdmin, async (req: express.Request, res: express.Response) => {
  const { setTierOverride, clearTierOverride, MODEL_TIERS } = await import('./services/modelTiers');
  const body = req.body as { tier?: string; model?: string | null; reason?: string };
  const tier = body.tier;
  if (!tier || !(MODEL_TIERS as string[]).includes(tier)) {
    res.status(400).json({ error: `tier must be one of: ${MODEL_TIERS.join(', ')}` });
    return;
  }
  const authReq = req as AuthRequest;
  const updatedBy = authReq.user?.username || 'unknown';
  try {
    // model: null → clear; string → set
    if (body.model === null) {
      await clearTierOverride(tier as 'strong' | 'fast' | 'reasoning', updatedBy);
      res.json({ tier, cleared: true });
      return;
    }
    if (typeof body.model !== 'string' || body.model.trim().length === 0) {
      res.status(400).json({ error: 'model must be a non-empty string, or null to clear' });
      return;
    }
    const override = await setTierOverride(
      tier as 'strong' | 'fast' | 'reasoning',
      body.model,
      updatedBy,
      body.reason,
    );
    res.json({ tier, override });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// Public auth configuration — no auth required. The frontend reads this
// on page load to decide whether to show the local username/password form
// or a single "Sign in with CallAnalyzer" button. The SSO URL is derived
// from CA_BASE_URL (the same env the introspection middleware uses).
app.get('/api/auth/config', (_req, res) => {
  const ssoEnabled = process.env.ENABLE_SSO === 'true';
  const caBase = (process.env.CA_BASE_URL || '').replace(/\/$/, '');
  res.json({
    sso: {
      enabled: ssoEnabled && caBase.length > 0,
      // Where the frontend should send the user when they click "Sign in".
      // CA's existing login page — after success the browser lands back on
      // RAG with the shared session cookie set, and the SSO middleware
      // bootstraps the RAG session on the next request.
      loginUrl: ssoEnabled && caBase ? `${caBase}/auth` : null,
      provider: 'callanalyzer',
    },
  });
});

// Service-to-service: which CA user IDs has RAG actually seen via SSO?
// Returns { seen: string[] } — an array of every non-null sso_sub in
// RAG's users table. CA admin calls this to list CA users whose email
// exists there but who've never logged into RAG (helpful for diagnosing
// "user reports KB access broken" before RAG admin credentials are
// reached for). Requires X-Service-Secret so outside callers can't
// enumerate the user base.
app.get('/api/auth/sso-seen', async (req, res) => {
  const configured = process.env.SSO_SHARED_SECRET;
  if (!configured || configured.length < 32) {
    res.status(503).json({ error: 'SSO not configured' });
    return;
  }
  const presented = (req.headers['x-service-secret'] as string) || '';
  const a = Buffer.from(configured);
  const b = Buffer.from(presented);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid service credential' });
    return;
  }
  try {
    const { getUsers } = await import('./middleware/auth');
    const users = await getUsers();
    const seen = users
      .map((u) => u.ssoSub)
      .filter((s): s is string => typeof s === 'string' && s.length > 0);
    res.json({ seen });
  } catch (err) {
    logger.warn('sso-seen: failed to list users', {
      error: err instanceof Error ? err.message : String(err),
    });
    res.status(500).json({ error: 'Failed to list users' });
  }
});

// Auth routes
app.post('/api/auth/login', loginLimiter, loginHandler);
app.post('/api/auth/users', authenticate, requireAdmin, (req, res) => createUserHandler(req as AuthRequest, res));
app.post('/api/auth/change-password', authenticate, (req, res) => changePasswordHandler(req as AuthRequest, res));
app.post('/api/auth/logout', authenticate, (req, res) => logoutHandler(req as AuthRequest, res));
app.post('/api/auth/refresh', refreshTokenHandler);

// Forgot password routes (unauthenticated, rate-limited)
import { forgotPasswordHandler, resetPasswordWithCodeHandler, mfaSetupHandler, mfaVerifyHandler, mfaDisableHandler } from './middleware/auth';
app.post('/api/auth/forgot-password', loginLimiter, forgotPasswordHandler);
app.post('/api/auth/reset-password', loginLimiter, resetPasswordWithCodeHandler);

// MFA routes
app.post('/api/auth/mfa/setup', authenticate, (req, res) => mfaSetupHandler(req as AuthRequest, res));
app.post('/api/auth/mfa/verify', authenticate, mfaVerifyLimiter, (req, res) => mfaVerifyHandler(req as AuthRequest, res));
app.post('/api/auth/mfa/disable', authenticate, (req, res) => mfaDisableHandler(req as AuthRequest, res));

// Document routes
app.use('/api/documents', documentRoutes);

// Query routes
app.use('/api/query', queryRoutes);

// Feedback routes
app.use('/api/feedback', feedbackRoutes);

// Usage routes
app.use('/api/usage', usageRoutes);

// Query log routes (admin CSV export)
app.use('/api/query-log', queryLogRoutes);

// Document extraction routes (structured form-filling)
app.use('/api/extraction', extractionRoutes);

// Source monitor routes (admin: manage auto-fetched external documents)
app.use('/api/sources', sourceMonitorRoutes);

// User management routes (admin CRUD)
app.use('/api/users', userRoutes);

// Client error reporting routes
app.use('/api/errors', errorRoutes);

// DME reference data routes (structured lookups)
app.use('/api/hcpcs', hcpcsRoutes);
app.use('/api/icd10', icd10Routes);
app.use('/api/coverage', coverageRoutes);

// PPD questionnaire routes (Power Mobility Device orders)
app.use('/api/ppd', ppdRoutes);

// PMD Account Creation routes
app.use('/api/account-creation', accountCreationRoutes);

// PAP Account Creation routes
app.use('/api/pap-account', papAccountCreationRoutes);

// Form drafts — partial save/resume for PPD, PMD Account, PAP Account
app.use('/api/form-drafts', formDraftsRoutes);

// Gold-standard RAG eval dataset (read-only admin view)
app.use('/api/eval', evalRoutes);

// Product images (S3-backed)
app.use('/api/products', productImageRoutes);

// A/B model testing routes (admin: compare Bedrock models on RAG quality)
import abTestingRoutes from './routes/abTesting';
app.use('/api/ab-tests', abTestingRoutes);

// In production, serve the frontend static files from the same server.
// The built frontend is expected at ../frontend/dist relative to the backend root.
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));

  // SPA fallback: any non-API route serves index.html.
  // API routes that don't match any handler get a proper JSON 404 instead of index.html.
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.get('*', (_req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  sentryCaptureException(err);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    logger.info('Initializing UMS Knowledge Base...');

    // Validate required environment variables
    validateEnv();

    // Verify S3 bucket security configuration (encryption, public access, versioning)
    const { verifyS3BucketConfig } = await import('./config/aws');
    await verifyS3BucketConfig();

    // Run database migrations if PostgreSQL is configured.
    // Retry connection up to 3 times with exponential backoff to handle
    // cold-start delays when RDS is waking up or network is initializing.
    if (process.env.DATABASE_URL || process.env.DB_HOST) {
      let dbConnected = false;
      const DB_RETRY_ATTEMPTS = 3;
      const DB_RETRY_BASE_MS = 2000;

      for (let attempt = 1; attempt <= DB_RETRY_ATTEMPTS; attempt++) {
        try {
          if (await checkDatabaseConnection()) {
            const { runMigrations } = await import('./config/migrate');
            await runMigrations();
            dbConnected = true;
            break;
          }
        } catch (dbErr) {
          if (attempt < DB_RETRY_ATTEMPTS) {
            const delay = DB_RETRY_BASE_MS * Math.pow(2, attempt - 1);
            logger.warn(`Database connection attempt ${attempt}/${DB_RETRY_ATTEMPTS} failed, retrying in ${delay}ms`, { error: String(dbErr) });
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            logger.warn(`Database connection failed after ${DB_RETRY_ATTEMPTS} attempts — continuing in S3-only mode`, { error: String(dbErr) });
          }
        }
      }

      if (!dbConnected) {
        logger.info('Database not reachable — running in S3-only mode');
      }
    } else {
      logger.info('Database not configured — running in S3-only mode');
    }

    // Initialize auth (create default admin if needed)
    await initializeAuth();

    // Restore token revocation state from S3 (in-memory mode only; skipped when Redis is configured)
    const { restoreRevocations } = await import('./middleware/tokenService');
    await restoreRevocations();

    // Restore model-tier overrides from S3. Fire-and-forget — failure
    // is non-fatal (app boots with env vars + baked defaults); survivors
    // of a restart re-apply on first getModelForTier() call.
    const { loadTierOverrides } = await import('./services/modelTiers');
    loadTierOverrides().catch((err) =>
      logger.warn('modelTiers: startup hydration failed', { error: String(err) }),
    );

    // Load vector store index into memory
    await initializeVectorStore();

    // Restore persisted job queue (marks in-progress jobs as failed)
    await loadPersistedJobs();

    // Start background re-indexing scheduler
    startReindexScheduler();

    // Start CMS fee schedule auto-fetcher (if URL configured)
    startFeeScheduleFetcher();

    // Start document source monitor (checks external URLs for updates)
    startSourceMonitor();

    // Start job queue cleanup (removes old completed/failed jobs every 10 minutes)
    startJobCleanup();

    // Start orphaned document cleanup (marks stuck uploads as error after 24h)
    startOrphanCleanup();

    // Start data retention cleanup scheduler (HIPAA-compliant expiration at ~3 AM daily)
    startRetentionScheduler();

    // Route malware-scanner unavailability to operational alerting (throttled to 1/hr per category).
    setMalwareScanAlertHandler((subject, details) => {
      void sendOperationalAlert('malware_scan_unavailable', subject, details);
    });

    const server = app.listen(PORT, () => {
      logger.info(`UMS Knowledge Base server running on port ${PORT}`);
    });

    // ─── Graceful shutdown ──────────────────────────────────────────────
    // Flush all in-memory buffers to S3 before exiting so no data is lost.
    let shuttingDown = false;
    const shutdown = async (signal: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      logger.info(`${signal} received — starting graceful shutdown`);

      // Hard-exit safety net: if any await below hangs (e.g. a flush call
      // never resolves because S3 is wedged), the process would otherwise
      // sit stuck indefinitely. Unref'd so it doesn't itself keep the
      // event loop alive after normal shutdown completes.
      const hardExitMs = 30_000;
      const hardExit = setTimeout(() => {
        logger.error(`Graceful shutdown exceeded ${hardExitMs}ms — forcing exit`);
        process.exit(1);
      }, hardExitMs);
      hardExit.unref();

      // Stop accepting new connections
      server.close(() => logger.info('HTTP server closed'));

      // Each scheduler stop runs under its own try/catch so one failure
      // can't skip the rest. Ports CA's pattern (pm2 deploys uncovered
      // cases where a scheduler stop throws mid-shutdown and subsequent
      // stops + buffer flushes silently got skipped).
      const stopSafely = async <T>(label: string, fn: () => Promise<T> | T): Promise<void> => {
        try {
          await fn();
        } catch (err) {
          logger.warn(`Shutdown step failed: ${label}`, { error: String(err) });
        }
      };

      const { stopSourceMonitor } = await import('./services/sourceMonitor');
      const { stopReindexScheduler } = await import('./services/reindexer');
      const { stopFeeScheduleFetcher } = await import('./services/feeScheduleFetcher');
      const { stopOrphanCleanup } = await import('./services/orphanCleanup');
      const { stopRetentionScheduler } = await import('./services/dataRetention');
      const { stopJobCleanup } = await import('./services/jobQueue');
      await stopSafely('sourceMonitor', stopSourceMonitor);
      await stopSafely('reindexer', stopReindexScheduler);
      await stopSafely('feeScheduleFetcher', stopFeeScheduleFetcher);
      await stopSafely('orphanCleanup', stopOrphanCleanup);
      await stopSafely('dataRetention', stopRetentionScheduler);
      await stopSafely('jobQueue', stopJobCleanup);
      logger.info('All scheduled tasks stopped');

      // Flush in-memory buffers. allSettled preserves per-flush
      // independence from the imports above.
      try {
        const { flushQueryLog } = await import('./services/queryLog');
        const { flushTraces } = await import('./services/ragTrace');
        const { flushUsage } = await import('./services/usage');
        const { persistRevocations } = await import('./middleware/tokenService');
        await Promise.allSettled([flushQueryLog(), flushTraces(), flushUsage(), flushJobs(), persistRevocations()]);
        logger.info('All in-memory buffers flushed to S3');
      } catch (err) {
        logger.error('Buffer flush step failed', { error: String(err) });
      }

      // Close database pool if connected
      await stopSafely('closeDatabasePool', async () => {
        const { closeDatabasePool } = await import('./config/database');
        await closeDatabasePool();
      });

      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (error) {
    logger.error('Failed to start server', { error: String(error) });
    process.exit(1);
  }
}

// Catch-all process error handlers so crashes always leave a log trace
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
});

start();
