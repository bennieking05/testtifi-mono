# UAT Round 3 — Comments and Notes

- /branch: Could not create `uat-round-3` — repo is not a git repository (`fatal: not a git repository`). If desired, initialize and create branch:
  - `git init && git add -A && git commit -m "init" && git checkout -b uat-round-3`

- UAT Round 3.xlsx: Not found in the workspace. Please provide the path or add the file to the repo.

- Frontend dev server warning seen once during local run:
  - `(node) UnhandledPromiseRejectionWarning: SyntaxError: Unexpected token '??='`
  - Likely Node/runtime mismatch when launching Vite in some environments. On the current system, the app is running and Playwright passed; monitor. If reproduced, ensure Node ≥ 18 and no legacy Node is used to start Vite.

- Playwright UI tests: Passed (1/1). Artifacts (screens/trace/HAR) are generated under `artifacts/` when tests run.
