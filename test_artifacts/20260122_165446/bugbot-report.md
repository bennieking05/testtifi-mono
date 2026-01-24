# BugBot Pre-Push Report — 20260122_165446

**Status:** ⚠️ OVERRIDDEN (ALLOW_PUSH_WITH_FAILURES=true)

## Impact Detection
- Frontend impacted: `false`
- Backend impacted: `false`
- E2E impacted: `true`

## Changed Files
```
README.md
backend
loveable
playwright.config.ts
test-login.json
tests/regression/auth.spec.ts
tests/regression/forms.spec.ts
tests/regression/pages.spec.ts
```

## Suite Results

| Suite | Status | Seconds | Log |
|---|---:|---:|---|
| regression | fail | 28 | /Users/bennieking/Sites/testifiAi/test_artifacts/20260122_165446/raw/regression.log |

## Failure Hints (if any)

- Check logs under `/Users/bennieking/Sites/testifiAi/test_artifacts/20260122_165446/raw` for first failing suite.
- Common Vite/React E2E issues: unstable selectors, race conditions, missing waits.
- Common Express issues: test env vars, port collisions, db mocks not isolated.

### First failure excerpt
```
            },
            {
              "title": "Dashboard mobile viewport",
              "ok": false,
              "tags": [],
              "tests": [
                {
                  "timeout": 30000,
                  "annotations": [],
                  "expectedStatus": "passed",
                  "projectId": "chromium",
                  "projectName": "chromium",
                  "results": [
                    {
                      "workerIndex": 72,
                      "parallelIndex": 0,
                      "status": "failed",
                      "duration": 168,
                      "error": {
                        "message": "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/login\nCall log:\n\u001b[2m  - navigating to \"http://localhost:5173/login\", waiting until \"load\"\u001b[22m\n",
                        "stack": "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/login\nCall log:\n\u001b[2m  - navigating to \"http://localhost:5173/login\", waiting until \"load\"\u001b[22m\n\n    at login (/Users/bennieking/Sites/testifiAi/tests/regression/pages.spec.ts:58:14)\n    at /Users/bennieking/Sites/testifiAi/tests/regression/pages.spec.ts:467:28",
                        "location": {
                          "file": "/Users/bennieking/Sites/testifiAi/tests/regression/pages.spec.ts",
                          "column": 14,
                          "line": 58
                        },
                        "snippet": "  56 |   }\n  57 |\n> 58 |   await page.goto('/login');\n     |              ^\n  59 |   await page.waitForLoadState('networkidle');\n  60 |\n  61 |   const emailInput = page.locator('input[type=\"email\"], input[name=\"email\"], input[placeholder*=\"email\" i]').first();"
                      },
                      "errors": [
                        {
                          "location": {
                            "file": "/Users/bennieking/Sites/testifiAi/tests/regression/pages.spec.ts",
                            "column": 14,
                            "line": 58
                          },
                          "message": "Error: page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:5173/login\nCall log:\n\u001b[2m  - navigating to \"http://localhost:5173/login\", waiting until \"load\"\u001b[22m\n\n\n  56 |   }\n  57 |\n> 58 |   await page.goto('/login');\n     |              ^\n  59 |   await page.waitForLoadState('networkidle');\n  60 |\n  61 |   const emailInput = page.locator('input[type=\"email\"], input[name=\"email\"], input[placeholder*=\"email\" i]').first();\n    at login (/Users/bennieking/Sites/testifiAi/tests/regression/pages.spec.ts:58:14)\n    at /Users/bennieking/Sites/testifiAi/tests/regression/pages.spec.ts:467:28"
                        }
                      ],
                      "stdout": [],
                      "stderr": [
                        {
                          "text": "(node:75802) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.\n(Use `node --trace-warnings ...` to show where the warning was created)\n"
                        }
                      ],
                      "retry": 0,
                      "startTime": "2026-01-22T22:55:14.547Z",
                      "annotations": [],
                      "attachments": [
                        {
                          "name": "screenshot",
                          "contentType": "image/png",
                          "path": "/Users/bennieking/Sites/testifiAi/test-results/playwright-results/regression-pages-Responsive-Design-Dashboard-mobile-viewport-chromium/test-failed-1.png"
                        }
                      ],
                      "errorLocation": {
                        "file": "/Users/bennieking/Sites/testifiAi/tests/regression/pages.spec.ts",
                        "column": 14,
                        "line": 58
                      }
                    }
                  ],
                  "status": "unexpected"
                }
              ],
              "id": "ca3f2643b7d3fa100cc7-80c546decd390def4341",
              "file": "regression/pages.spec.ts",
              "line": 466,
              "column": 7
            }
          ]
        }
      ]
    }
  ],
  "errors": [],
  "stats": {
    "startTime": "2026-01-22T22:54:48.192Z",
    "duration": 26661.821,
    "expected": 0,
    "skipped": 0,
    "unexpected": 73,
    "flaky": 0
  }
}

📊 Frontend Results: 0 passed, 1 failed

════════════════════════════════════════════════════════════════════
  PHASE 3: Summary Report
════════════════════════════════════════════════════════════════════

╔════════════════════════════════════════════════════════════════╗
║                    REGRESSION TEST SUMMARY                     ║
╚════════════════════════════════════════════════════════════════╝

  📊 Overall Results
  ──────────────────────────────────────────────────
  Total Tests:     13
  ✅ Passed:       0
  ❌ Failed:       13
  Pass Rate:       0.0%
  
  📡 API Tests
  ──────────────────────────────────────────────────
  Passed:          0
  Failed:          12
  
  🖥️  Frontend Tests
  ──────────────────────────────────────────────────
  Passed:          0
  Failed:          1
  
  📁 Output Files
  ──────────────────────────────────────────────────
  Summary:         /Users/bennieking/Sites/testifiAi/test-results/regression-summary-2026-01-22T22-54-47-230Z.csv
  Screenshots:     /Users/bennieking/Sites/testifiAi/test-results/screenshots/

❌ Some regression tests failed. See details above.

 ELIFECYCLE  Command failed with exit code 1.
```
