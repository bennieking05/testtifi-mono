# Runbook: Dev & Deploy Quickstart

This quickstart gets you running locally and outlines how to build, test, and deploy. See `docs/repo_onboarding.md` for details.

## 1) Prerequisites
- Node 18+
- npm
- Optional: Docker & kubectl for deployment

## 2) Environment Setup
Create local `.env` files using examples (do not commit secrets):

```bash
# Frontend
cp docs/env.frontend.example loveable/.env

# Backend
cp docs/env.backend.example backend/.env
```

Adjust values as needed (e.g., `VITE_API_BASE_URL`, `ALLOWED_ORIGINS`).

## 3) Start Backend (Terminal A)
```bash
cd backend
npm ci
npm run dev   # http://localhost:8000
```

If using a database, ensure it is reachable and run Prisma as needed:
```bash
npx prisma generate
npx prisma migrate dev
```

## 4) Start Frontend (Terminal B)
```bash
cd loveable
npm ci
npm run dev   # http://localhost:3000
```

## 5) E2E Tests (Playwright)
```bash
# from repo root
npx playwright install --with-deps
npx playwright test -c playwright.config.ts
```

Artifacts appear under `artifacts/` (screens, HAR, trace). The config points to `http://localhost:3000`.

## 6) Build
```bash
# Frontend
cd loveable && npm run build

# Backend
cd backend && npm run build && npm start
```

## 7) Deploy (Kubernetes)
- Review and update ingress hosts and TLS certs: `backend/*-ingress.yaml`, `certificate.yaml`
- Ensure image tags and registries align with your pipeline in `*-cloudbuild.yaml`
- Apply manifests in order: namespace/issuer → service → deployment → ingress

## 8) Troubleshooting
- 405/CORS between FE:3000 and BE:8000 → check FE `VITE_API_BASE_URL` and BE `ALLOWED_ORIGINS`
- Okta `invalid_request` → add `http://localhost:3000/login/callback` and/or `http://localhost:8000/login/callback`
- TLS hostname mismatch → ensure cert matches the ingress host; min TLS 1.2
- Stripe webhook 400 signature errors → register `app.post("/api/purchase/stripe-webhook", bodyParser.raw(...))` **before** `express.json()` and avoid any other body parsers on that route.
- Unexpected HTML 400 responses → keep the JSON parse error handler (`err.type === "entity.parse.failed"`) after `express.json()` to return `{ "error": "INVALID_JSON" }`.

