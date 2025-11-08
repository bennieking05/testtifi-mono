#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running. Please start Docker Desktop and re-run." >&2
  exit 1
fi

echo "Building images…"
docker compose build

echo "Starting containers…"
docker compose up -d

echo "Waiting for services…"
until curl -sSf http://localhost:4000/api/health >/dev/null; do sleep 1; done
until curl -sSf http://localhost:3000 >/dev/null; do sleep 1; done

echo "OK: Backend http://localhost:4000/api/health | Frontend http://localhost:3000"


