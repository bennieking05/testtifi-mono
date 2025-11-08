#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if ! docker info >/dev/null 2>&1; then
  echo "Docker is not running."
  exit 0
fi

docker compose down -v
echo "Containers stopped and volumes removed."


