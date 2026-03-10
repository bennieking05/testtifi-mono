# Testifi AI

## Quick start — Start the project

This repo is a **monorepo** (npm workspaces: `backend`, `loveable`). From the repo root:

1. **Install:** `npm install`
2. **Env:** Copy `docs/env.backend.example` to `backend/.env` and `docs/env.frontend.example` to `loveable/.env.local`; set `DATABASE_URL` and `VITE_API_URL` (e.g. `http://localhost:4000`).
3. **Database:** `cd backend && npx prisma generate && npx prisma migrate dev && cd ..`
4. **Run:** `npm run dev` — backend at http://localhost:4000, frontend at http://localhost:3000.

**Full instructions (prerequisites, options, tests, DB dump):** [docs/STARTUP.md](docs/STARTUP.md).

**DB dump to Desktop:** From root run `./scripts/dump-db-to-desktop.sh` (requires `mysqldump` and `backend/.env` with `DATABASE_URL`). Output: `~/Desktop/testifi-db-dump-YYYY-MM-DD.sql`.

---

## Local containers (Docker)

Prereqs: Docker Desktop running

```bash
./scripts/docker-up.sh
# Frontend: http://localhost:3000
# Backend:  http://localhost:4000/api/health

# Stop
./scripts/docker-down.sh
```

## Notes
- Frontend image passes `VITE_API_URL=http://localhost:4000` at build time.
- Backend exposes 4000. Add env in docker-compose.yml as needed (DB, SendGrid, etc.).
# CI/CD Test - Staging Branch Sat Oct 25 14:13:47 CDT 2025
# Force sync Sat Oct 25 15:12:08 CDT 2025

## Email Theme

Transactional emails support light, dark, and auto themes.

- Configure in `backend/.env`:
  ```
  EMAIL_THEME=auto   # or: light | dark
  ```
- `auto` respects the recipient’s system theme when the client supports `prefers-color-scheme`, otherwise falls back to light.
- Our templates meet WCAG AA contrast targets, underline links by default, and keep brand color `#5674BC`.

### Test emails
Send both light and dark sample emails using inline CID logos:
```bash
DOTENV_CONFIG_PATH=backend/.env \
npx --prefix backend ts-node -P backend/tsconfig.json \
  ../scripts/test-send-inline-logo.ts
```

---

## BugBot Pre-Push Testing Gate

This repo blocks `git push` unless impacted tests pass.

### Install hook
```bash
chmod +x scripts/bugbot/prepush-bugbot.sh
cat > .git/hooks/pre-push <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
bash scripts/bugbot/prepush-bugbot.sh
EOF
chmod +x .git/hooks/pre-push
```

### Artifacts
Each run produces:
- `./test_artifacts/<timestamp>/bugbot-report.md`
- `./test_artifacts/<timestamp>/test-results.json`
- `./test_artifacts/<timestamp>/test-results.csv`
- `./test_artifacts/<timestamp>/raw/*.log`

### Override (not recommended)
```bash
ALLOW_PUSH_WITH_FAILURES=true git push
```
