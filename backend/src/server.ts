import dotenv from 'dotenv';
dotenv.config();

// OpenTelemetry must be initialized before any other imports so auto-instrumentation
// hooks are registered before Express, HTTP, and AWS SDK modules load.
import './tracing';

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
import { initializeAuth, loginHandler, createUserHandler, changePasswordHandler, logoutHandler, authenticate, requireAdmin, AuthRequest } from './middleware/auth';
import { initializeVectorStore, getVectorStoreStats } from './services/vectorStore';
import { s3Client, S3_BUCKET } from './config/aws';
import { checkDatabaseConnection } from './config/database';
import { startReindexScheduler } from './services/reindexer';
import { startFeeScheduleFetcher } from './services/feeScheduleFetcher';
import { startSourceMonitor } from './services/sourceMonitor';
import { startJobCleanup, loadPersistedJobs, flushJobs } from './services/jobQueue';
import { startOrphanCleanup } from './services/orphanCleanup';
import { startRetentionScheduler } from './services/dataRetention';
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

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],  // React inline styles require unsafe-inline
      imgSrc: ["'self'", 'data:', 'blob:'],     // data: for base64, blob: for PDF preview
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],                    // API calls to same origin
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
}));

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
const CSRF_EXEMPT_PATHS = ['/api/auth/login', '/api/health'];

app.use((req, res, next) => {
  // Set/refresh the CSRF cookie on every response
  let csrfToken = req.cookies?.[CSRF_COOKIE];
  if (!csrfToken) {
    csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.cookie(CSRF_COOKIE, csrfToken, {
    httpOnly: false,  // Frontend JS needs to read this
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  });

  // Only enforce on state-changing methods
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    // Skip CSRF check for exempt paths (login, health)
    if (!CSRF_EXEMPT_PATHS.some(p => req.path === p || req.path.startsWith(p))) {
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

  const status = healthy ? 'ok' : 'degraded';
  res.status(healthy ? 200 : 503).json({
    status,
    service: 'ums-knowledge-base',
    uptime: Math.round(process.uptime()),
    checks,
    vectorStoreChunks: vsStats.totalChunks,
  });
});

// Metrics endpoint — request counts, latency percentiles, memory usage (admin only)
app.get('/api/metrics', authenticate, requireAdmin, (_req: express.Request, res: express.Response) => {
  res.json(getMetricsSnapshot());
});

// Auth routes
app.post('/api/auth/login', loginLimiter, loginHandler);
app.post('/api/auth/users', authenticate, requireAdmin, (req, res) => createUserHandler(req as AuthRequest, res));
app.post('/api/auth/change-password', authenticate, (req, res) => changePasswordHandler(req as AuthRequest, res));
app.post('/api/auth/logout', authenticate, (req, res) => logoutHandler(req as AuthRequest, res));

// Forgot password routes (unauthenticated, rate-limited)
import { forgotPasswordHandler, resetPasswordWithCodeHandler, mfaSetupHandler, mfaVerifyHandler, mfaDisableHandler } from './middleware/auth';
app.post('/api/auth/forgot-password', loginLimiter, forgotPasswordHandler);
app.post('/api/auth/reset-password', loginLimiter, resetPasswordWithCodeHandler);

// MFA routes
app.post('/api/auth/mfa/setup', authenticate, (req, res) => mfaSetupHandler(req as AuthRequest, res));
app.post('/api/auth/mfa/verify', authenticate, (req, res) => mfaVerifyHandler(req as AuthRequest, res));
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

// Product images (S3-backed)
app.use('/api/products', productImageRoutes);

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

      // Stop accepting new connections
      server.close(() => logger.info('HTTP server closed'));

      try {
        const { flushQueryLog } = await import('./services/queryLog');
        const { flushTraces } = await import('./services/ragTrace');
        const { flushUsage } = await import('./services/usage');
        await Promise.allSettled([flushQueryLog(), flushTraces(), flushUsage(), flushJobs()]);
        logger.info('All in-memory buffers flushed to S3');

        // Close database pool if connected
        try {
          const { closeDatabasePool } = await import('./config/database');
          await closeDatabasePool();
        } catch { /* ignore if not configured */ }
      } catch (err) {
        logger.error('Error during shutdown flush', { error: String(err) });
      }

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
