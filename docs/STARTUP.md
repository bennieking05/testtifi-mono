# Testifi AI — Local Startup Guide

How to run the project locally and create a database dump.

## Prerequisites

- **Node.js** 18 or higher, **npm**
- **MySQL** running locally (or in Docker) for the backend
- **Docker** (optional) — for running the full stack via containers

## One-time setup

1. **Clone and install** (from repo root):
   ```bash
   npm install
   ```
   This installs dependencies for the monorepo workspaces (`backend`, `loveable`).

2. **Environment files**
   - Backend: `cp docs/env.backend.example backend/.env`
   - Frontend: `cp docs/env.frontend.example loveable/.env.local`
   - Edit `backend/.env`: set `DATABASE_URL` (e.g. `mysql://USER:PASS@localhost:3306/deposition_ai`), `PORT=4000`, and any API keys (SendGrid, Stripe, etc.).
   - Edit `loveable/.env.local`: set `VITE_API_URL` (e.g. `http://localhost:4000`) and other frontend env vars.

3. **Database**
   ```bash
   cd backend && npx prisma generate && npx prisma migrate dev
   cd ..
   ```

4. **Playwright** (for E2E tests, from root):
   ```bash
   npx playwright install --with-deps
   ```

## Start local development

**Option A — From repo root (both backend and frontend):**
```bash
npm run dev
```
- Backend: http://localhost:4000 (health: http://localhost:4000/api/health)
- Frontend: http://localhost:3000

**Option B — Two terminals**
- Terminal 1: `npm run dev -w backend` or `cd backend && npm run dev`
- Terminal 2: `npm run dev -w loveable` or `cd loveable && npm run dev`

**Option C — Docker**
```bash
./scripts/docker-up.sh
```
Backend: http://localhost:4000, Frontend: http://localhost:3000.

## Run tests

From repo root:

- **Full regression (local):** `npm run test:regression`
- **Staging / prod:** `npm run test:regression:staging`, `npm run test:regression:prod`
- **Frontend only:** `npm run test:frontend`

## Database dump to Desktop

To create a MySQL dump of the app database and save it on your Desktop:

From repo root:
```bash
./scripts/dump-db-to-desktop.sh
```

**Requirements:** `mysqldump` on your PATH, and `backend/.env` with a valid `DATABASE_URL` (e.g. `mysql://user:password@host:port/database`).

**Output:** `~/Desktop/testifi-db-dump-YYYY-MM-DD.sql`

To only print the command without running it:
```bash
./scripts/dump-db-to-desktop.sh --dry-run
```

Make sure the script is executable: `chmod +x scripts/dump-db-to-desktop.sh` if needed.
