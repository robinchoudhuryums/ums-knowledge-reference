# Multi-stage build: build frontend + backend, then run as a single service
# Pin to specific Node.js LTS patch for deterministic builds.
# Update this version periodically (check: https://nodejs.org/en/download/)
FROM node:20.19.0-slim AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
# --legacy-peer-deps: use npm 6's lenient peer-dependency resolver.
# The bundled npm 10.8.2 in node:20.19.0-slim is stricter about ERESOLVE
# than the npm shipped with actions/setup-node@v6 in CI, which caused
# `npm ci` to succeed in CI but fail during Docker build with ERESOLVE.
RUN npm ci --legacy-peer-deps
COPY frontend/ ./
RUN npm run build

FROM node:20.19.0-slim AS backend-build
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# Production image
FROM node:20.19.0-slim
WORKDIR /app

# Install tini for proper PID 1 signal handling and curl for health checks
RUN apt-get update && apt-get install -y --no-install-recommends tini curl \
    && rm -rf /var/lib/apt/lists/*

# Copy backend build + production dependencies
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev --legacy-peer-deps

COPY --from=backend-build /app/backend/dist ./backend/dist

# Copy database migration files (SQL scripts applied on startup)
COPY backend/migrations ./backend/migrations

# Copy frontend build
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

ENV NODE_ENV=production
ENV PORT=3001

# Run as the built-in non-root 'node' user (UID 1000, already exists in node images)
USER node

EXPOSE 3001

# Health check for container orchestration (ALB, ECS, Docker Compose)
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -sf http://localhost:3001/api/health || exit 1

# Use tini as init process for proper signal forwarding (SIGTERM → graceful shutdown)
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/dist/server.js"]
