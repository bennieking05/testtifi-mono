#!/usr/bin/env bash
# Dumps the MySQL database defined by backend/.env DATABASE_URL to the user's Desktop.
# Output: ~/Desktop/testifi-db-dump-YYYY-MM-DD.sql
# Requires: mysqldump on PATH, backend/.env with valid DATABASE_URL
# Usage: ./scripts/dump-db-to-desktop.sh [--dry-run]

set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/dump-db-to-desktop.mjs "$@"
