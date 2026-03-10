#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Please start Docker Desktop and re-run." >&2
  exit 1
fi

# Check for --with-worker flag
WITH_WORKER=false
for arg in "$@"; do
  if [ "$arg" = "--with-worker" ]; then
    WITH_WORKER=true
  fi
done

echo "Building images…"
if [ "$WITH_WORKER" = true ]; then
  echo "(Including summarize-worker)"
  docker compose -f docker-compose.yml -f docker-compose.local.yml build
else
  docker compose build
fi

echo "Starting containers…"
if [ "$WITH_WORKER" = true ]; then
  docker compose -f docker-compose.yml -f docker-compose.local.yml up -d
else
  docker compose up -d
fi

echo "Waiting for services…"
until curl -sSf http://localhost:4000/api/health >/dev/null; do sleep 1; done
until curl -sSf http://localhost:3000 >/dev/null; do sleep 1; done

echo "OK: Backend http://localhost:4000/api/health | Frontend http://localhost:3000"
if [ "$WITH_WORKER" = true ]; then
  echo "    Worker: testifiai-worker (use 'npm run watch:summary' to monitor)"
fi


