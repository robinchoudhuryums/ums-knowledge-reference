import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { logger } from './utils/logger';
import { initializeAuth, loginHandler, createUserHandler, authenticate, requireAdmin, AuthRequest } from './middleware/auth';
import { initializeVectorStore } from './services/vectorStore';
import { startReindexScheduler } from './services/reindexer';
import documentRoutes from './routes/documents';
import queryRoutes from './routes/query';
import feedbackRoutes from './routes/feedback';
import usageRoutes from './routes/usage';
import queryLogRoutes from './routes/queryLog';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

app.use(express.json({ limit: '1mb' }));

// Disable X-Powered-By (helmet does this too, belt + suspenders)
app.disable('x-powered-by');

// Request logging — logs every incoming request with method, path, status, and duration
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`);
  });
  next();
});

// Rate limiting — login: strict (brute force protection), API: general
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 10,                     // 10 attempts per window
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 60,               // 60 requests per minute
  message: { error: 'Too many requests. Please slow down.' },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use('/api/', apiLimiter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ums-knowledge-base' });
});

// Auth routes
app.post('/api/auth/login', loginLimiter, loginHandler);
app.post('/api/auth/users', authenticate, requireAdmin, createUserHandler as any);

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

// In production, serve the frontend static files from the same server.
// The built frontend is expected at ../frontend/dist relative to the backend root.
if (process.env.NODE_ENV === 'production') {
  const frontendPath = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendPath));

  // SPA fallback: any non-API route serves index.html
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

    // Initialize auth (create default admin if needed)
    await initializeAuth();

    // Load vector store index into memory
    await initializeVectorStore();

    // Start background re-indexing scheduler
    startReindexScheduler();

    app.listen(PORT, () => {
      logger.info(`UMS Knowledge Base server running on port ${PORT}`);
    });
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
