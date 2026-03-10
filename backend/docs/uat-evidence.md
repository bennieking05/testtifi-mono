# UAT Evidence — Round 3

- Updated spreadsheet: `UAT Round 3.xlsx` (Status/Comment/Evidence/Last Updated filled). Backup created alongside it.
- UI tests: Playwright suite passed (1/1). Artifacts in `artifacts/`.
- Key fixes implemented:
  - Email notifications: FE uses central API client; BE supports opt-in and sends on completion.
  - Summaries visibility: forced refetch after job creation; polling enabled.
  - Downloads: DOCX/PDF/TXT export paths implemented server-side; FE download flow stable.
  - Preview back: closes to previous or `/summaries` consistently.
  - Case metadata: stripped from exporters; metadata/date parsing improved; page parsing deduplicates.

## Commands & Outputs

- Run UI tests:
```bash
npx playwright test -c playwright.config.ts
```
Expected: `1 passed`.

- Run mock UAT tests (CLI printouts):
```bash
npm run test:uat:mock
```
Expected: PASS/FAIL lines for each scenario with printed sample requests.

## File references
- Frontend: `loveable/src/lib/axios.ts`, `loveable/src/components/dialogs/EmailNotificationDialog.tsx`, `loveable/src/pages/Summaries.tsx`, `loveable/src/pages/SummaryPreview.tsx`, `loveable/src/pages/DownloadSummary.tsx`
- Backend: `backend/src/routes/emailNotificationRoutes.ts`, `backend/src/worker/summarizeWorker.ts`, `backend/src/routes/downloadRoutes.ts`, `backend/src/routes/previewRoutes.ts`, `backend/src/routes/summariesRoutes.ts`
