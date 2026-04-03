#!/bin/bash
# UMS Knowledge Base — Blue-Green Docker Deploy Script
# Usage: ./deploy-bluegreen.sh [branch]
# Default branch: main
#
# How it works:
#   1. Pull latest code and build a new Docker image
#   2. Start the new container on an alternate port (3002) alongside the live one
#   3. Health-check the new container on the alternate port
#   4. If healthy: stop old → start new on the production port (3001)
#   5. If unhealthy: kill new → old container untouched → zero user impact
#
# The key difference from the standard deploy: the old container keeps serving
# traffic while the new one is being built and health-checked. Downtime is
# reduced from ~30s (build + start + health) to ~2s (port swap only).
#
# Prerequisites:
#   - Docker installed
#   - ~/ums-knowledge.env file with environment variables
#
# Rollback: docker stop ums-knowledge && docker rename ums-knowledge-old ums-knowledge && docker start ums-knowledge
#
# Ported from assemblyai_tool/deploy-bluegreen.sh and adapted for Docker.

set -e

BRANCH="${1:-main}"
APP_DIR="${APP_DIR:-$HOME/ums-knowledge-reference}"
ENV_FILE="${ENV_FILE:-$HOME/ums-knowledge.env}"
DEPLOY_LOG="$APP_DIR/.deploy-last.log"

PROD_PORT=3001
STAGING_PORT=3002
CONTAINER_NAME="ums-knowledge"
STAGING_NAME="ums-knowledge-staging"
HEALTH_TIMEOUT=30
MAX_IMAGE_SIZE=524288000  # 500MB

echo "=== UMS Knowledge Base — Blue-Green Deploy ==="
echo "Branch: $BRANCH"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

cd "$APP_DIR"

# [1/5] Pull latest code
echo "[1/5] Pulling latest code..."
PREV_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"
NEW_COMMIT=$(git rev-parse HEAD)
echo "Commit: ${PREV_COMMIT:0:12} → ${NEW_COMMIT:0:12}"

# [2/5] Build new Docker image
echo ""
echo "[2/5] Building Docker image..."
NEW_TAG="${CONTAINER_NAME}:${NEW_COMMIT:0:12}"
if ! docker build -t "$NEW_TAG" -t "${CONTAINER_NAME}:latest" .; then
  echo "!!! Docker build failed — old container still serving traffic"
  exit 1
fi

# Image size guard
SIZE=$(docker image inspect "$NEW_TAG" --format='{{.Size}}')
SIZE_MB=$((SIZE / 1048576))
echo "Image size: ${SIZE_MB}MB"
if [ "$SIZE" -gt "$MAX_IMAGE_SIZE" ]; then
  echo "!!! Image is ${SIZE_MB}MB (>500MB) — aborting deploy"
  docker rmi "$NEW_TAG" 2>/dev/null || true
  exit 1
fi

# [3/5] Start new container on staging port (old container keeps serving)
echo ""
echo "[3/5] Starting staging container on port ${STAGING_PORT}..."

# Clean up any leftover staging container
docker rm -f "$STAGING_NAME" 2>/dev/null || true

docker run -d \
  --name "$STAGING_NAME" \
  --restart no \
  --env-file "$ENV_FILE" \
  -e PORT="$PROD_PORT" \
  -p "${STAGING_PORT}:${PROD_PORT}" \
  "$NEW_TAG"

# [4/5] Health check the staging container
echo "[4/5] Health-checking staging container..."
HEALTHY=false
TRIES=0
while [ "$TRIES" -lt "$HEALTH_TIMEOUT" ]; do
  TRIES=$((TRIES + 1))
  HEALTH_RESPONSE=$(curl -sf "http://localhost:${STAGING_PORT}/api/health" 2>/dev/null || echo "")
  if [ -n "$HEALTH_RESPONSE" ]; then
    echo "Staging healthy after ${TRIES}s"
    HEALTHY=true
    break
  fi
  sleep 1
done

if [ "$HEALTHY" != "true" ]; then
  echo ""
  echo "!!! Staging container failed health check after ${HEALTH_TIMEOUT}s — rolling back"
  echo "Recent logs:"
  docker logs --tail 30 "$STAGING_NAME" 2>/dev/null || true
  docker rm -f "$STAGING_NAME" 2>/dev/null || true
  echo "Old container still serving traffic on port ${PROD_PORT}."
  exit 1
fi

# [5/5] Swap: stop old, start new on production port
echo ""
echo "[5/5] Swapping to new container on port ${PROD_PORT}..."

# Stop staging container (it was just for health-checking)
docker stop "$STAGING_NAME" 2>/dev/null || true
docker rm "$STAGING_NAME" 2>/dev/null || true

# Rename old container for rollback
docker rename "$CONTAINER_NAME" "${CONTAINER_NAME}-old" 2>/dev/null || true
docker stop "${CONTAINER_NAME}-old" 2>/dev/null || true

# Start the new image on the production port
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  --env-file "$ENV_FILE" \
  -p "${PROD_PORT}:${PROD_PORT}" \
  "$NEW_TAG"

# Quick health check on production port
sleep 3
if curl -sf "http://localhost:${PROD_PORT}/api/health" > /dev/null 2>&1; then
  echo "Production health check passed — removing old container"
  docker rm "${CONTAINER_NAME}-old" 2>/dev/null || true
else
  echo "!!! Production health check failed — rolling back to old container"
  docker stop "$CONTAINER_NAME" 2>/dev/null || true
  docker rm "$CONTAINER_NAME" 2>/dev/null || true
  docker rename "${CONTAINER_NAME}-old" "$CONTAINER_NAME" 2>/dev/null || true
  docker start "$CONTAINER_NAME"
  echo "Rollback complete — old container restored"
  exit 1
fi

# Clean up old Docker images
docker image prune -f 2>/dev/null || true

echo ""
echo "=== Blue-Green Deploy Complete ==="
echo "Container: ${CONTAINER_NAME}"
echo "Image: ${NEW_TAG}"
echo "Previous: ${PREV_COMMIT:0:12}"
echo "Current:  ${NEW_COMMIT:0:12}"
echo "Rollback: docker stop ${CONTAINER_NAME} && docker rename ${CONTAINER_NAME}-old ${CONTAINER_NAME} && docker start ${CONTAINER_NAME}"
echo ""

echo "$(date -u '+%Y-%m-%d %H:%M:%S UTC') | $BRANCH | ${PREV_COMMIT:0:12} -> ${NEW_COMMIT:0:12} | blue-green" >> "$DEPLOY_LOG"
