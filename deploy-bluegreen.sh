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
HEALTH_TIMEOUT=60                # Was 30 — raised to cover cold-start (migrations, vector store load, DB retry backoff)
MAX_IMAGE_SIZE=734003200         # 700MB — reflects actual deps (AWS SDK + pg + pgvector + OTel + sharp + pdf-parse)

echo "=== UMS Knowledge Base — Blue-Green Deploy ==="
echo "Branch: $BRANCH"
echo "Time: $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo ""

cd "$APP_DIR"

# [1/6] Pull latest code
echo "[1/6] Pulling latest code..."
PREV_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull origin "$BRANCH"
NEW_COMMIT=$(git rev-parse HEAD)
echo "Commit: ${PREV_COMMIT:0:12} → ${NEW_COMMIT:0:12}"

# [2/6] Pre-build cleanup — free disk from previous failed deploys
# (docker image prune does NOT touch BuildKit cache, which is usually the
# biggest consumer after many failed builds. docker builder prune does.)
echo ""
echo "[2/6] Pre-build disk cleanup..."
df -h / | tail -1
# Remove non-:latest ums-knowledge tags (keeps current prod image)
docker images --format '{{.Repository}}:{{.Tag}}' | grep "^${CONTAINER_NAME}:" | grep -v ':latest$' | xargs -r docker rmi -f 2>&1 | tail -3 || true
docker image prune -a -f 2>&1 | tail -3 || true
docker builder prune -a -f 2>&1 | tail -3 || true
docker container prune -f 2>&1 | tail -3 || true
docker volume prune -f 2>&1 | tail -3 || true
# Truncate running container logs >100MB (no default rotation on json-file driver)
for cid in $(docker ps -q 2>/dev/null); do
  LOG_PATH=$(docker inspect --format='{{.LogPath}}' "$cid" 2>/dev/null)
  if [ -n "$LOG_PATH" ] && [ -f "$LOG_PATH" ]; then
    LOG_SIZE=$(stat -c%s "$LOG_PATH" 2>/dev/null || echo 0)
    if [ "$LOG_SIZE" -gt 104857600 ]; then
      echo "Truncating large container log ($((LOG_SIZE / 1048576))MB): $LOG_PATH"
      sudo truncate -s 0 "$LOG_PATH" 2>/dev/null || truncate -s 0 "$LOG_PATH" 2>/dev/null || true
    fi
  fi
done
df -h / | tail -1
AVAIL_KB=$(df -k / | tail -1 | awk '{print $4}')
if [ "$AVAIL_KB" -lt 2097152 ]; then
  echo "!!! Less than 2GB free disk space after cleanup — aborting"
  exit 1
fi

# [3/6] Build new Docker image (verbose output for debugability)
echo ""
echo "[3/6] Building Docker image: $NEW_TAG"
NEW_TAG="${CONTAINER_NAME}:${NEW_COMMIT:0:12}"
docker build --progress=plain -t "$NEW_TAG" -t "${CONTAINER_NAME}:latest" .
BUILD_EXIT=$?
if [ "$BUILD_EXIT" -ne 0 ]; then
  echo "!!! Docker build failed with exit code $BUILD_EXIT — old container still serving traffic"
  exit 1
fi

# Image size guard
SIZE=$(docker image inspect "$NEW_TAG" --format='{{.Size}}' 2>/dev/null || echo 0)
SIZE_MB=$((SIZE / 1048576))
echo "Image size: ${SIZE_MB}MB"
if [ "$SIZE" = "0" ]; then
  echo "!!! Build completed but image '$NEW_TAG' not found"
  exit 1
fi
if [ "$SIZE" -gt "$MAX_IMAGE_SIZE" ]; then
  echo "!!! Image is ${SIZE_MB}MB (>$((MAX_IMAGE_SIZE / 1048576))MB) — aborting deploy"
  docker rmi "$NEW_TAG" 2>/dev/null || true
  exit 1
fi

# [4/6] Start new container on staging port (old container keeps serving)
echo ""
echo "[4/6] Starting staging container on port ${STAGING_PORT}..."

# Clean up any leftover staging container
docker rm -f "$STAGING_NAME" 2>/dev/null || true

# Pre-flight: warn if staging port is already in use
if ss -tlnH "sport = :${STAGING_PORT}" 2>/dev/null | grep -q LISTEN; then
  echo "!!! Port ${STAGING_PORT} already in use — staging container may fail to start"
  ss -tlnp "sport = :${STAGING_PORT}" 2>/dev/null || true
fi

# Capture docker run output so failures surface instead of going to the void
if ! RUN_OUTPUT=$(docker run -d \
    --name "$STAGING_NAME" \
    --restart no \
    --env-file "$ENV_FILE" \
    -e PORT="$PROD_PORT" \
    -p "${STAGING_PORT}:${PROD_PORT}" \
    "$NEW_TAG" 2>&1) ; then
  echo "!!! docker run failed to start staging container"
  echo "Output: $RUN_OUTPUT"
  echo "Image check: $(docker image inspect "$NEW_TAG" --format 'Size: {{.Size}}' 2>&1 || true)"
  echo "Env file: $(ls -l "$ENV_FILE" 2>&1 || echo 'missing')"
  exit 1
fi
echo "Started container: $RUN_OUTPUT"

# [5/6] Health check the staging container (60s — covers cold-start)
echo "[5/6] Health-checking staging container..."
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
  # Partial log dump at 15s to diagnose slow-start issues
  if [ "$TRIES" = "15" ]; then
    echo "=== Staging still not healthy at 15s — partial logs: ==="
    docker logs --tail 40 "$STAGING_NAME" 2>&1 || true
    echo "==="
  fi
  sleep 1
done

if [ "$HEALTHY" != "true" ]; then
  echo ""
  echo "!!! Staging container failed health check after ${HEALTH_TIMEOUT}s — rolling back"
  echo "=== Full staging logs (last 200 lines) ==="
  docker logs --tail 200 "$STAGING_NAME" 2>&1 || true
  echo "=== Container inspect ==="
  docker inspect "$STAGING_NAME" --format 'Status: {{.State.Status}} | ExitCode: {{.State.ExitCode}} | OOM: {{.State.OOMKilled}} | Error: {{.State.Error}}' 2>&1 || true
  docker rm -f "$STAGING_NAME" 2>/dev/null || true
  echo "Old container still serving traffic on port ${PROD_PORT}."
  exit 1
fi

# [6/6] Swap: stop old, start new on production port
echo ""
echo "[6/6] Swapping to new container on port ${PROD_PORT}..."

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
