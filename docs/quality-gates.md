# Quality Gates — TestifiAI

This document describes the mandatory quality gates that protect the TestifiAI
codebase from regressions and undocumented changes.

---

## Overview

Every change goes through **four gates** before it can reach production:

| # | Gate | Mechanism | What it blocks |
|---|------|-----------|----------------|
| 1 | **Cursor agent rule** | `.cursor/rules/qa-regression-enforcement.md` | Agent cannot claim "done" without evidence |
| 2 | **Pre-push hook** | `.git/hooks/pre-push` → `scripts/bugbot/prepush-bugbot.sh` | `git push` blocked on failures |
| 3 | **PR template** | `.github/pull_request_template.md` | Reviewer checklist enforced |
| 4 | **CI workflow** | `.github/workflows/playwright-regression.yml` | PR merge blocked on failures |

---

## Running Regression Tests

### Full regression (API + Playwright E2E)

```bash
npm run test:regression          # against localhost
npm run test:regression:staging  # against staging
npm run test:regression:prod     # against production
```

### Playwright E2E only

```bash
npm run test:frontend            # regression specs only
npm run test:e2e                 # all Playwright specs
```

### Evidence screenshots only

```bash
npm run test:evidence            # captures desktop + mobile screenshots
```

Optionally control output folder:

```bash
FEATURE_NAME=my-feature EVIDENCE_TS=2026-02-16 npm run test:evidence
```

### API tests only

```bash
npm run test:api                 # localhost
npm run test:api:staging         # staging
```

---

## Evidence Screenshots

### Where they live

```
tests/regression-screenshots/<FEATURE_NAME>/<EVIDENCE_TS>/
  01-login-desktop.png
  01-login-mobile.png
  02-register-desktop.png
  02-register-mobile.png
  ...
```

### How they're generated

The spec at `tests/evidence/evidence-screenshots.spec.ts` navigates to every
core route at both desktop (1280x720) and mobile (375x667) viewports.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FEATURE_NAME` | `default` | Subfolder name (use branch name or ticket ID) |
| `EVIDENCE_TS` | auto ISO timestamp | Subfolder timestamp |
| `BASE_URL` | `http://localhost:3000` | Target app URL (from playwright.config.ts) |
| `TEST_EMAIL` | from `test-login.json` | Test user email |
| `TEST_PASSWORD` | from `test-login.json` | Test user password |

---

## Pre-Push Hook

### How it works

1. Detects changed files
2. Determines impact areas (frontend / backend / E2E)
3. Runs `npm run test:regression`
4. Runs `npm run test:evidence` (if frontend/E2E impacted)
5. Writes artifacts to `test_artifacts/<timestamp>/`
6. Exits non-zero on any failure → push blocked

### Installing the hook (new clones)

```bash
chmod +x scripts/bugbot/prepush-bugbot.sh
cat > .git/hooks/pre-push <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
bash scripts/bugbot/prepush-bugbot.sh
EOF
chmod +x .git/hooks/pre-push
```

### Override (not recommended)

```bash
ALLOW_PUSH_WITH_FAILURES=true git push
```

---

## PR Template

The PR template at `.github/pull_request_template.md` requires:

- [x] Regression passed locally
- [x] All tests passed (0 failures)
- [x] Evidence screenshots captured
- [x] Evidence Summary block pasted
- [x] No console errors

Reviewers should verify the Evidence Summary block is present and matches the
claimed test results.

---

## CI Pipeline

The workflow at `.github/workflows/playwright-regression.yml`:

1. Triggers on PRs to `main` or `staging`
2. Installs dependencies + Playwright Chromium
3. Runs regression tests against staging
4. Runs evidence screenshot capture
5. Uploads both as GitHub Actions artifacts (14-day retention)
6. **Fails the check** if any test fails

### Required secrets (GitHub repo settings)

| Secret | Description |
|--------|-------------|
| `TEST_EMAIL` | E2E test user email |
| `TEST_PASSWORD` | E2E test user password |

### Optional variables

| Variable | Description |
|----------|-------------|
| `STAGING_FRONTEND_URL` | Override staging URL (default: `https://staging.app.testifi.ai`) |

---

## Troubleshooting

### "Push blocked: Playwright regression failed"

1. Check the output above the error for which tests failed
2. Check `test_artifacts/<timestamp>/raw/*.log` for detailed logs
3. Fix the failing test or the code that caused it
4. Re-run: `npm run test:regression`

### "No test credentials available — protected page tests will be skipped"

Create `test-login.json` at the repo root:

```json
{
  "email": "your-test-user@example.com",
  "password": "your-test-password"
}
```

Or set `TEST_EMAIL` and `TEST_PASSWORD` environment variables.

### Evidence screenshots folder is empty

- Ensure the app is running at the configured `BASE_URL`
- Check that Playwright browsers are installed: `npx playwright install chromium`
- Run with verbose output: `npx playwright test tests/evidence/ --reporter=list`

### CI artifacts not uploading

- Artifacts upload even on failure (`if: always()`)
- Check the Actions tab for the "playwright-report" and "evidence-screenshots" artifacts
- Retention is 14 days

---

## File Reference

| File | Purpose |
|------|---------|
| `.cursor/rules/qa-regression-enforcement.md` | Agent enforcement rule |
| `tests/evidence/evidence-screenshots.spec.ts` | Evidence screenshot spec |
| `tests/utils/screenshot.ts` | Screenshot helper utilities |
| `tests/regression/auth.spec.ts` | Auth flow regression tests |
| `tests/regression/pages.spec.ts` | Page navigation regression tests |
| `tests/regression/forms.spec.ts` | Form interaction regression tests |
| `scripts/bugbot/prepush-bugbot.sh` | Pre-push gate script |
| `.github/pull_request_template.md` | PR checklist template |
| `.github/workflows/playwright-regression.yml` | CI regression workflow |
