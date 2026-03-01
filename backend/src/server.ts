import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import { logger } from './utils/logger';
import { initializeAuth, loginHandler, createUserHandler, authenticate, requireAdmin, AuthRequest } from './middleware/auth';
import { initializeVectorStore } from './services/vectorStore';
import documentRoutes from './routes/documents';
import queryRoutes from './routes/query';

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
app.use(express.json({ limit: '1mb' }));

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'ums-knowledge-base' });
});

// Auth routes
app.post('/api/auth/login', loginHandler);
app.post('/api/auth/users', authenticate, requireAdmin, createUserHandler as any);

// Document routes
app.use('/api/documents', documentRoutes);

// Query routes
app.use('/api/query', queryRoutes);

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

    app.listen(PORT, () => {
      logger.info(`UMS Knowledge Base server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: String(error) });
    process.exit(1);
  }
}

start();
