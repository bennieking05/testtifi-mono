# Testifi‑AI Repository Onboarding

This document orients new contributors and AI agents to the Testifi‑AI repo. It summarizes stack, layout, required environment, common commands, CI/CD, and known pitfalls. Treat `appinstructions.md` at the repo root as the source of truth.

## Stack Overview
- Frontend: Vite + React + TypeScript in `loveable/`
- Backend API: Node.js + Express + TypeScript in `backend/`
- Data: Prisma migrations in `backend/prisma/`
- Tests: Playwright E2E in `tests/` with `playwright.config.ts`
- Deploy: Kubernetes manifests in repo root and `backend/`

## Repository Layout
- `appinstructions.md` — master guidance for agents and contributors
- `backend/` — Express API, worker, Prisma, Dockerfile
  - `src/` (TypeScript), `dist/` (built JS)
  - `prisma/schema.prisma`, `prisma/migrations/`
  - `routes/`, `controllers/`, `worker/`
- `loveable/` — Vite React app, Tailwind, shadcn/ui
- `tests/` — Playwright spec(s) and artifacts
- `scripts/` — deploy helpers
- `*.yaml` — Kubernetes manifests

## Node & Tooling
- Node: >= 18 (see `backend/package.json` engines)
- Package managers: npm (lockfiles present)
- Playwright: browsers must be installed before running tests

## Frontend Commands (run inside `loveable/`)
```bash
npm ci                 # install deps
npm run dev            # start Vite dev server (default http://localhost:3000)
npm run build          # production build
npm run preview        # preview build
npx playwright install --with-deps  # install browsers (once per machine)
```

## Backend Commands (run inside `backend/`)
```bash
npm ci                 # install deps
npm run dev            # start TS server via ts-node (http://localhost:8000 by default)
npm run build          # tsc compile to dist/
npm start              # run compiled server
npm run worker         # run summarize worker (compiled)

# Prisma (if DB configured)
npx prisma generate
npx prisma migrate dev
```

## Environment Variables

Frontend (`docs/.env.frontend.example`):
- `VITE_API_BASE_URL` — e.g., `http://localhost:8000`
- `VITE_OKTA_ISSUER` — e.g., `https://example.okta.com/oauth2/default`
- `VITE_OKTA_CLIENT_ID` — `<OKTA_CLIENT_ID>`

Backend (`docs/.env.backend.example`):
- `PORT=8000`
- `ALLOWED_ORIGINS=http://localhost:3000`
- `DB_URL` or `MONGO_URL` — database connection string
- `STORAGE_BUCKET` — GCS or S3 bucket name
- `SENDGRID_API_KEY` — if email sending is enabled
- Model provider keys (choose one stack):
  - `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_KEY`
  - or `VERTEX_PROJECT_ID`, `VERTEX_LOCATION`, `VERTEX_MODEL_ID`
  - or `OPENAI_API_KEY`

OAuth Redirect URIs (adjust to actual flow):
- `http://localhost:3000/login/callback`
- `http://localhost:8000/login/callback`

## CORS & Base URLs
- Align FE `VITE_API_BASE_URL` with BE `PORT`
- Set BE `ALLOWED_ORIGINS` to include the FE origin(s)
- Common issue: 405/CORS between FE:3000 and BE:8000 → verify both values

## Tests (Playwright)
Location: `tests/` with config `playwright.config.ts` (baseURL `http://localhost:3000`).

Run locally:
```bash
# Terminal A
cd loveable && npm ci && npm run dev

# Terminal B (repo root)
npx playwright install --with-deps
npx playwright test -c playwright.config.ts
```

Artifacts: `artifacts/` (network HAR, screenshots, trace) created by the test.

## CI/CD
- Manifests: `backend/*-deployment.yaml`, `*-ingress.yaml`, `service.yaml`, `certificate.yaml`
- Cloud Build files present for FE/BE: `*-cloudbuild.yaml`
- Post-deploy smoke tests should hit `/health` and `/ready`

## AI/ML Requirements (from `appinstructions.md`)
- Summaries must include page:line citations and legal-ready headings
- Chunk transcripts by page/line; include anchors in RAG prompts
- Orchestrate: ingest → OCR → chunk → embed → RAG → summarize → QA → export
- Track provider, model ID, prompt hash, doc IDs, artifact IDs

## Known Pitfalls
- Missing OAuth redirect URIs in the IdP causes `invalid_request`
- TLS/Ingress hostname certificate mismatches for `www` hosts
- Secrets must be env-based; never commit

## Onboarding Checklist
- [ ] Install deps (FE/BE) and run local dev
- [ ] Create `.env` from examples (no secrets in repo)
- [ ] Validate OAuth redirect URIs
- [ ] Align FE base URL and BE CORS allowlist
- [ ] Run Playwright tests and review artifacts
- [ ] Review k8s manifests and CI/CD requirements


