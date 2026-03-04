# QA Regression & Evidence Enforcement (Hard Stop Policy)

## NON-NEGOTIABLE — HARD STOP

You (the AI agent) MUST NOT:
- Mark any task, issue, or PR as "Done"
- Claim implementation is complete
- Recommend merge or push as final
- State "ready", "finished", or "complete"

**UNTIL ALL of the following are satisfied:**

1. **Playwright regression suite passed** — 0 failures, 0 unexpected skips
2. **Screenshot evidence captured** — for every impacted flow (desktop + mobile)
3. **Evidence Summary produced** — using the template below, including artifact paths

If you cannot run tests in the current environment, you MUST:
- State clearly that tests have not been run
- Provide the exact commands the user must run locally
- Refuse to mark anything as complete

---

## When This Rule Applies

This rule applies to ANY work that modifies:
- `backend/src/**` (API / backend logic)
- `loveable/src/**` (frontend components / pages)
- `prisma/schema.prisma` (data model)
- `scripts/**` (build / test tooling)
- `tests/**` (test files themselves)
- `playwright.config.ts`

If in doubt, run the suite anyway.

---

## Required Commands

```bash
# Full regression (API + Playwright E2E)
npm run test:regression

# Playwright E2E only
npm run test:frontend

# Evidence screenshots only (desktop + mobile, deterministic names)
npm run test:evidence

# Against staging
npm run test:regression:staging
```

---

## Evidence Summary Template

After a successful run, output this block (fill in real values):

```
✅ Regression Suite: PASSED
🧪 Total Tests: <#>
❌ Failures: 0
⏭️  Skips: 0 (or explain)
⚠️  Console Errors: 0
📸 Screenshots Captured: <#>
📁 Evidence Location: <path>
🕒 Timestamp: <ISO 8601>
```

If any field is non-zero where zero is expected, **do not mark the work complete**.

---

## Screenshot Evidence Requirements

- Evidence screenshots live in:
  `tests/regression-screenshots/<feature-or-branch>/<timestamp>/`
- Each flow must have **desktop** and **mobile** variants
- Screenshots use deterministic names:
  `01-login-desktop.png`, `01-login-mobile.png`, etc.
- Use `FEATURE_NAME` and `EVIDENCE_TS` env vars to control folder naming
- Run via: `npm run test:evidence`

---

## Pre-Push Gate

The git pre-push hook (`scripts/bugbot/prepush-bugbot.sh`) blocks pushes when:
- Any Playwright test fails
- Any API regression test fails

Override (not recommended):
```bash
ALLOW_PUSH_WITH_FAILURES=true git push
```

---

## PR Checklist (also enforced in PR template)

Before requesting review, confirm:
- [ ] `npm run test:regression` passed with 0 failures
- [ ] Evidence screenshots captured for impacted flows
- [ ] Evidence Summary block included in PR description
- [ ] No console errors observed during test run

---

## Enforcement Summary

| Gate | Mechanism | Blocks |
|------|-----------|--------|
| Agent policy | This rule | Agent cannot say "done" |
| Pre-push hook | `.git/hooks/pre-push` | `git push` blocked |
| PR template | `.github/pull_request_template.md` | Reviewer checklist |
| CI pipeline | `.github/workflows/playwright-regression.yml` | PR merge blocked |
