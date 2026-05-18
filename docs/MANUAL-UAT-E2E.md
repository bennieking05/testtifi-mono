# Manual End-to-End UAT Script

This script is the staging-first manual UAT checklist for TestifiAI. It covers the full user journey, every routed frontend interaction, and every mounted backend endpoint discovered in the current app.

Use the CSV companion file, `docs/manual-uat-e2e-matrix.csv`, as the pass/fail tracker. Use this Markdown file for detailed steps, expected behavior, and special handling.

## 1. Environment

Default target: staging.

| Item | Value |
|---|---|
| Frontend | `https://staging.app.testifi.ai` |
| Backend API | `https://testifi-backend-staging-748916208557.us-central1.run.app` |
| Local frontend, if needed | `http://localhost:5173` |
| Local API, if needed | `http://localhost:4000` |
| Production frontend, reference only | `https://app.testifi.ai` |
| Production API, reference only | `https://testifi-backend-748916208557.us-central1.run.app` |

### Required Tester Roles

| Role | Purpose |
|---|---|
| Guest | Public pages, login, registration, forgot/reset password, protected route redirects |
| Authenticated user | Dashboard, summaries, upload, purchase, billing, support, downloads |
| Authenticated user with zero or low credits | Insufficient-credit upload and purchase redirect checks |
| Admin user | Admin dashboard, support management, purchase/signups/download metrics, fine-tune UI |
| Ops/API tester | Health checks, emergency endpoints, webhook/debug/snapshot/webcopy/cleanup checks |

### Required Test Data

- Test user email address that can receive password reset and summary-complete emails.
- Admin test user whose email is accepted by the backend admin allowlist.
- At least one fresh user with zero or insufficient credits.
- Small valid deposition files in `.pdf`, `.doc`, `.docx`, and `.txt` formats.
- One invalid file type, for example `.png` or `.exe`.
- A completed summary job ID owned by the authenticated user.
- A completed summary job ID owned by a different user, if security/ownership testing is allowed.
- One support ticket created during the run.
- Stripe test card for staging checkout, for example `4242 4242 4242 4242` with any future expiry/CVC, if staging is configured with Stripe test keys.
- Stripe declined card, for example `4000 0000 0000 0002`, if staging is configured with Stripe test keys.

### Evidence Rules

For every failed or blocked test, capture:

- Environment and URL.
- User role and anonymized test account.
- Browser, viewport, and device type.
- Timestamp and test ID from the CSV matrix.
- Screenshot or screen recording.
- Network request/response details for API failures.
- Console errors, if present.
- Summary job ID, payment intent ID, support ticket ID, or request ID when applicable.

Use these statuses in the CSV:

| Status | Meaning |
|---|---|
| Pass | Actual result matches expected result |
| Fail | Actual result does not match expected result |
| Blocked | Cannot execute because of environment, credentials, third-party setup, or missing test data |
| Not Run | Not executed in this UAT pass |
| N/A | Intentionally skipped for this environment |

## 2. Pre-UAT Smoke Checks

Run these checks before assigning testers to the full script.

| ID | Area | Steps | Expected Result |
|---|---|---|---|
| PRE-001 | Frontend availability | Open the staging frontend. | App loads without browser certificate, DNS, or blank-screen errors. |
| PRE-002 | Backend health | Request `GET /health` and `GET /api/health` on the staging API. | Both return `200 OK` with body `OK`. |
| PRE-003 | API CORS/session | Open the login page, submit a known valid account, and inspect the network call. | `POST /api/auth/login` reaches staging API and returns access/refresh tokens. |
| PRE-004 | Stripe mode | On `/payment` to `/checkout`, confirm staging uses non-production card expectations. | Test cards work in staging; live cards are not required for UAT. |
| PRE-005 | Email mode | Trigger forgot-password for a test mailbox. | Email delivery works or the environment owner confirms email is intentionally disabled. |
| PRE-006 | Processing dependencies | Upload a tiny valid transcript after buying credits. | Job can be created and enters queued/processing rather than failing immediately. |

## 3. Happy-Path E2E Script

Complete this sequence first. It validates the core customer path from account creation to summary delivery.

### E2E-001: Register a New User

1. Open `https://staging.app.testifi.ai/register`.
2. Register with a unique test email and valid password.
3. If registration redirects to login, sign in with the new account.
4. Inspect local state only if needed to confirm `token` and `refreshToken` were stored.

Expected result:

- Registration succeeds or displays a clear validation message for duplicate/invalid data.
- A successful user can reach `/dashboard`.
- Protected pages no longer redirect to `/login`.

### E2E-002: Login, Dashboard, Sidebar, and Logout

1. Open `/login`.
2. Sign in as the standard test user.
3. Verify `/dashboard` loads.
4. Verify sidebar links are visible: Dashboard, Summaries, Purchase Tokens, Billing History, Help, Support.
5. Resize to a mobile viewport and open/close the mobile navigation.
6. Logout from the sidebar.
7. Attempt to open `/dashboard` again.

Expected result:

- Login stores tokens and routes to `/dashboard`.
- Dashboard shows user-specific summary/credit widgets or empty states.
- Mobile navigation can open, navigate, and close.
- Logout clears the session and protected routes redirect to `/login`.

### E2E-003: Purchase Credits

1. Log in as a standard user.
2. Open `/payment`.
3. Select a token package.
4. Confirm navigation to `/checkout`.
5. Change quantity if the checkout UI allows it.
6. Enter billing contact and address details.
7. Use a Texas address/ZIP to verify tax handling, then a non-Texas address if the UI allows retesting.
8. Submit with a successful Stripe test card.
9. Confirm the UI returns to the expected `returnTo` route or `/`.
10. Reopen the sidebar, dashboard, and `/account/billing`.

Expected result:

- `POST /api/purchase/purchase-credits` creates a PaymentIntent.
- Quantity/tax changes call `POST /api/purchase/update-payment-intent`.
- Stripe confirms payment, then `POST /api/purchase/confirm` records credits.
- Credit balance increases consistently in sidebar/dashboard/billing.
- Purchase appears in user purchase history.

### E2E-004: Declined Payment and Checkout Errors

1. Open `/payment` and choose a package.
2. Proceed to `/checkout`.
3. Submit with a declined Stripe test card.
4. Submit with missing required billing fields.
5. Refresh the checkout page after a PaymentIntent has been created.

Expected result:

- Declined card shows a clear error and does not add credits.
- Required field errors are visible and actionable.
- Refresh does not double-credit the user.
- User can recover by submitting a valid payment.

### E2E-005: Create a Summary

1. Log in as a user with enough credits.
2. Open `/create-summary`.
3. Enter a summary name.
4. Enter a deponent name.
5. Drag/drop a valid deposition file.
6. Submit.
7. Watch network calls for `POST /api/upload/init`, signed storage `PUT`, and `POST /api/upload/complete`.
8. Confirm redirect to `/summaries`.
9. If prompted, choose an email notification preference.

Expected result:

- Valid file types are accepted.
- Credits are reserved/debited according to product rules.
- Upload completes without exposing signed URL details in the UI.
- A new summary appears in `/summaries` with processing/queued state.
- Email notification preference can be saved through `POST /api/email-notifications`.

### E2E-006: Upload Validation and Insufficient Credits

1. Open `/create-summary`.
2. Attempt to submit without required fields.
3. Upload an unsupported file extension.
4. Log in as a user with insufficient credits and attempt a valid upload.

Expected result:

- Required fields show validation errors.
- Unsupported file type is rejected before or during upload with a clear message.
- Insufficient credits returns a purchase prompt and routes to `/payment` with enough context to return to summary creation.

### E2E-007: Processing, Summary List, and Email Notification

1. Open `/summaries`.
2. Verify processing, active/processed, and failed/error tabs or filters.
3. Wait for the new job to move through queued/processing states.
4. Refresh the page and verify polling/refetch behavior.
5. Toggle email notification for the job.
6. If the job completes during the run, verify the email notification arrives when enabled.

Expected result:

- Summary list shows accurate status and does not duplicate entries.
- Polling updates the job state without requiring a full browser restart.
- Notification opt-in/out persists for the correct job.
- Completion email includes correct summary context or attachment/link per product behavior.

### E2E-008: Preview, Detail, and Download

1. On `/summaries`, open a completed summary preview modal.
2. Press Escape/back/close to dismiss the modal.
3. Open full-page preview at `/preview/:id`.
4. Use back navigation from preview.
5. Open `/summaries/:id`.
6. Open `/download/:id`.
7. Download `pdf`, `docx`, `txt`, and `csv` formats.
8. Open each downloaded file and verify it contains the expected summary content and metadata.

Expected result:

- `GET /api/preview?id=...` returns HTML for owned summaries.
- Preview close/back actions behave predictably.
- Download route returns files with useful names and correct MIME/content.
- Unsupported/missing formats show a clear error.
- Known risk: `/summaries/:id` calls `/api/summaries/view?id=...`, which may not exist on the backend. If it fails, record as a defect with network evidence.

### E2E-009: Billing and Usage History

1. Open `/account/billing`.
2. Verify current balance.
3. Review purchase history.
4. Review usage/debit history.
5. Filter ledger history by available UI controls.
6. Export history if the UI exposes CSV export.

Expected result:

- Current credit balance matches dashboard/sidebar.
- Purchases and debits reconcile with the upload and payment completed in this run.
- Empty states are clear for new accounts.
- CSV export opens/downloads a parseable file when available.

### E2E-010: Support Ticket

1. Open `/support`.
2. Submit without required fields.
3. Submit a valid ticket with name, email, subject, and message.
4. Capture the confirmation message.
5. As admin, open `/admin` and inspect the support tab.
6. Change the ticket status.
7. Send an admin reply.

Expected result:

- Required validation is visible.
- Valid ticket creates successfully through `POST /api/support`.
- Admin can list, update, and reply to the ticket.
- Customer email delivery succeeds or is clearly disabled in staging.

### E2E-011: Admin and Fine-Tune

1. Log in as admin.
2. Confirm sidebar shows Admin and Fine Tune links.
3. Open `/admin`.
4. Check purchases, signups, downloads, support, expired billing, and visible metrics.
5. Open `/admin/finetune`.
6. Load prompt config.
7. Save a harmless prompt config edit only if the environment owner approves config changes.
8. Upload a human summary file.
9. Upload a training pair file.
10. Generate pairs from transcript + human summary test files.
11. Review fine-tune history.

Expected result:

- Admin-only API calls require an admin-allowed account.
- Non-admin users cannot access sensitive backend data even if they manually open admin URLs.
- Prompt config and fine-tune endpoints return clear success/error messages.
- No production prompt or model config is modified during staging UAT unless explicitly approved.

### E2E-012: Help, Static Pages, and Footer

1. Open `/help`, `/help/user-guide`, and `/help/keyboard-shortcuts`.
2. Verify internal help/support links.
3. Open `/terms` and `/privacy` while logged out.
4. Verify footer Terms, Privacy, Help, Support, and disclaimer display.
5. Open `/security-commitment`.
6. Open `/automation`, `/case-preparation`, `/ai-insights`, and `/collaboration`.
7. Open an unknown path, for example `/not-a-real-route`.

Expected result:

- Static pages render without errors.
- UI-only/coming-soon pages do not imply unavailable production functionality unless clearly labeled.
- Help pages may call `/api/webcopy`; failures should not break the user experience.
- Unknown routes show the 404 page.

## 4. Role-Based Manual Scripts

### Guest Coverage

| ID | Steps | Expected Result |
|---|---|---|
| GUEST-001 | Open `/login`, `/register`, `/forgot-password`, `/reset-password/test-token`, `/terms`, `/privacy`. | Public routes render without auth. |
| GUEST-002 | Open `/dashboard`, `/summaries`, `/create-summary`, `/payment`, `/checkout`, `/account/billing`, `/support`, `/admin`. | Protected routes redirect to `/login`. |
| GUEST-003 | Submit login with invalid credentials. | Clear authentication error; no token stored. |
| GUEST-004 | Submit forgot password for valid and unknown emails. | User-safe response; no account enumeration in copy if product requires that. |
| GUEST-005 | Submit reset password with invalid token and mismatched confirmation. | Clear validation/error; user remains unauthenticated. |

### Authenticated User Coverage

| ID | Steps | Expected Result |
|---|---|---|
| USER-001 | Login and reload protected pages. | Session persists while token is valid. |
| USER-002 | Force an expired access token with valid refresh token, then open a protected route. | Refresh-token flow restores access or redirects cleanly if refresh fails. |
| USER-003 | Navigate all sidebar/footer links. | Each destination loads and active nav state is correct. |
| USER-004 | Complete purchase, upload, preview, download, billing, support. | Core customer workflow passes end to end. |
| USER-005 | Attempt to open another user's summary/preview/download/status by ID, if approved. | Access is denied or behavior is logged as a security defect. |

### Admin Coverage

| ID | Steps | Expected Result |
|---|---|---|
| ADMIN-001 | Login as admin and open `/admin`. | Admin dashboard loads data from admin endpoints. |
| ADMIN-002 | Login as non-admin and open `/admin` manually. | Sensitive API calls fail with 403/401 or no sensitive data is displayed. |
| ADMIN-003 | Reply to and change status on a support ticket. | Ticket status/reply persists and customer notification path is exercised. |
| ADMIN-004 | Open `/admin/finetune` and load prompt/fine-tune history. | Page handles configured/unconfigured environments cleanly. |

### Ops/API Coverage

| ID | Steps | Expected Result |
|---|---|---|
| OPS-001 | Run health and readiness endpoint checks. | Health endpoints return 200. |
| OPS-002 | Check job-status emergency endpoint. | Queued/processing jobs return with safe fields only. |
| OPS-003 | Reset stuck jobs only in an approved staging window. | Processing jobs are set back to queued and count is reported. |
| OPS-004 | Replay/test Stripe webhook from Stripe CLI or dashboard in staging. | Signature verification and idempotent purchase handling work. |
| OPS-005 | Check debug routes only if enabled in staging. | Disabled environments return 404; enabled staging returns non-secret diagnostic values. |

## 5. Frontend Route and Interaction Checklist

| ID | Route | Role | Required Checks |
|---|---|---|---|
| FE-001 | `/login` | Guest | Valid login, invalid login, password visibility/keyboard submit, link to forgot/register if present. |
| FE-002 | `/register` | Guest | Valid registration, duplicate email, invalid email/password, post-register navigation. |
| FE-003 | `/forgot-password` | Guest | Valid email, invalid email, back-to-login link, email-delivery evidence. |
| FE-004 | `/reset-password/:token` | Guest | Valid token reset, invalid token, mismatched passwords, relative API path behavior. |
| FE-005 | `/terms` | Guest | Page renders while logged out; legal copy is readable. |
| FE-006 | `/privacy` | Guest | Page renders while logged out; privacy copy is readable. |
| FE-007 | `/` | Authenticated | Default protected landing shows summaries list; guest redirects to login. |
| FE-008 | `/dashboard` | Authenticated | Summary stats, credit balance, quick actions, support/help links. |
| FE-009 | `/summaries` | Authenticated | Tabs/filters, processing/active/error states, CSV export if available, preview/download actions. |
| FE-010 | `/summaries/:id` | Authenticated | Detail load, missing backend `/api/summaries/view` behavior, fallback/error state. |
| FE-011 | `/preview/:id` | Authenticated | HTML preview, download action, back/close behavior, 404 for missing ID. |
| FE-012 | `/create-summary` | Authenticated | Required fields, drag/drop, invalid file, successful upload, insufficient credits. |
| FE-013 | `/download/:id` | Authenticated | Format picker and downloads for `pdf`, `docx`, `txt`, `csv`; unsupported/missing job behavior. |
| FE-014 | `/payment` | Authenticated | Plan cards, package selection, returnTo preservation, navigation to checkout. |
| FE-015 | `/checkout` | Authenticated | Payment intent creation/update, billing fields, Stripe success/decline, credit update. |
| FE-016 | `/account/billing` | Authenticated | Current balance, purchase history, usage ledger, empty states, CSV export/API CSV if available. |
| FE-017 | `/automation` | Authenticated | Coming-soon/static copy; no broken controls. |
| FE-018 | `/help` | Authenticated | Help cards, support link, optional `/api/webcopy` behavior. |
| FE-019 | `/help/user-guide` | Authenticated | Guide content, back link, support link. |
| FE-020 | `/help/keyboard-shortcuts` | Authenticated | Shortcut content, back link, optional `/api/webcopy` behavior. |
| FE-021 | `/support` | Authenticated | Required validation, successful ticket submission, error handling. |
| FE-022 | `/admin` | Admin | Purchases, signups, downloads, support, expired credits; non-admin access behavior. |
| FE-023 | `/admin/finetune` | Admin intended | Prompt config load/save, upload human summary, upload training pair, generate pairs, history. |
| FE-024 | `/success` | Authenticated | Direct route renders; return button routes to `returnTo` or `/`. |
| FE-025 | `/security-commitment` | Authenticated | Static security content and links. |
| FE-026 | `/case-preparation` | Authenticated | Static/demo controls do not error; route is not misleading. |
| FE-027 | `/ai-insights` | Authenticated | Static/demo controls do not error; route is not misleading. |
| FE-028 | `/collaboration` | Authenticated | Static/demo controls do not error; route is not misleading. |
| FE-029 | `*` | Any | Unknown path shows NotFound and Return to Home works. |
| FE-030 | Layout | Authenticated | Sidebar desktop/mobile, logout, footer links, disclaimer, active state, theme if visible. |
| FE-031 | Modal | Authenticated | Email notification dialog opens after upload state and saves/cancels cleanly. |
| FE-032 | Modal | Authenticated | Preview modal loads, handles loading/error state, closes with Escape/back/click. |
| FE-033 | Modal | Admin | Support ticket detail/reply dialog opens, validates, submits, and closes. |

## 6. Backend Endpoint Checklist

Execute API checks with a REST client, curl, Postman, or browser DevTools. Use the staging API base URL unless a row says otherwise.

For protected endpoints, verify at least these auth states:

- Missing `Authorization` header.
- Invalid/expired bearer token.
- Valid standard-user token.
- Valid admin token where required.

### Core and Ops

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-CORE-001 | GET | `/health` | None | Returns `200 OK` and body `OK`. |
| API-CORE-002 | GET | `/api/health` | None | Returns `200 OK` and body `OK`. |
| API-CORE-003 | POST | `/api/test` | None | Echoes JSON body; malformed JSON returns `400 INVALID_JSON`. |
| API-CORE-004 | POST | `/api/emergency/reset-stuck-jobs` | None | Approved staging only; returns reset count or safe error. |
| API-CORE-005 | GET | `/api/emergency/job-status` | None | Returns queued/processing jobs with expected safe fields. |
| API-CORE-006 | Any | Unknown API path | None | Returns 404 or configured not-found behavior without leaking stack traces. |

### Authentication

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-AUTH-001 | POST | `/api/auth/register` | None | Valid registration, duplicate email, invalid/missing fields. |
| API-AUTH-002 | POST | `/api/auth/login` | None | Valid credentials return tokens; invalid credentials return clear 4xx. |
| API-AUTH-003 | POST | `/api/auth/forgot-password` | None | Valid/unknown email responses are safe and email path works. |
| API-AUTH-004 | POST | `/api/auth/reset-password` | None | Valid token resets password; invalid token and weak/mismatched password fail. |
| API-AUTH-005 | GET | `/api/auth/get-reset-email` | None | Valid reset lookup returns expected safe response; invalid token fails safely. |
| API-AUTH-006 | POST | `/api/auth/refresh-token` | None | Valid refresh token returns new access token; invalid/expired token fails. |

### User and Credits

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-USER-001 | GET | `/api/user` | User | Returns current profile, role, and effective credits. |
| API-USER-002 | GET | `/api/user/credits` | User | Returns numeric current credit balance. |
| API-USER-003 | GET | `/api/user/signups` | Admin | Admin can list signups; non-admin and missing token fail. |

### Billing

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-BILL-001 | GET | `/api/billing/balance` | User | Returns effective credit balance matching UI. |
| API-BILL-002 | GET | `/api/billing/history` | User | Supports pagination and filters `type`, `from`, `to`, `cursor`. |
| API-BILL-003 | GET | `/api/billing/history` with `Accept: text/csv` | User | Returns parseable CSV export. |
| API-BILL-004 | POST | `/api/billing/debit` | User | Valid summary debit succeeds; insufficient credits returns 400/402. |

### Purchase and Stripe

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-PAY-001 | POST | `/api/purchase/purchase-credits` | User | Valid amount/credits creates PaymentIntent/client secret; missing fields fail. |
| API-PAY-002 | POST | `/api/purchase/update-payment-intent` | User | Valid owner can update amount/tax; missing/foreign PaymentIntent fails. |
| API-PAY-003 | POST | `/api/purchase/confirm` | User | Confirmed PaymentIntent adds credits once; replay is idempotent. |
| API-PAY-004 | GET | `/api/purchase/history` | Admin | Admin can list all purchases; standard user fails. |
| API-PAY-005 | GET | `/api/purchase/user-history` | User | Current user's purchase history matches billing UI. |
| API-PAY-006 | POST | `/api/purchase/stripe-webhook` | Stripe signed | Valid signed event succeeds; missing/bad signature fails; replay is safe. |

### Upload and Summary Jobs

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-UPLOAD-001 | POST | `/api/upload` | User | Legacy streaming upload accepts valid file and rejects invalid/missing file. |
| API-UPLOAD-002 | POST | `/api/upload/init` | User | Valid fileName/contentType reserves credits and returns signed upload details. |
| API-UPLOAD-003 | POST | `/api/upload/complete` | User | Valid reservation/objectKey creates job; missing object refunds/fails safely. |
| API-JOB-001 | GET | `/api/summary-jobs/:jobId` | User | Owned job status returns expected status/metadata. |
| API-JOB-002 | POST | `/api/summary-jobs/upload` | User | Legacy multipart upload path creates a job or fails with clear validation. |
| API-JOB-003 | GET | `/api/summary-jobs/:jobId` for another user | User | If allowed by UAT policy, verify access is denied or log as security defect. |

### Summaries, Preview, Download, and Email

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-SUM-001 | GET | `/api/summaries` | User | Returns only current user's summaries and signed URLs where expected. |
| API-SUM-002 | GET | `/api/summaries/prompt-config` | User | Returns prompt config or clear error. |
| API-SUM-003 | PUT | `/api/summaries/prompt-config` | User | Save only with approval; validates `system`, `temperature`, `maxTokens`. |
| API-SUM-004 | GET | `/api/summaries/download-history` | User | Returns current behavior, currently expected to be an empty array/stub. |
| API-SUM-005 | GET | `/api/summaries/view?id=...` | User | Frontend-called route; expected current result may be 404. Record defect if detail page depends on it. |
| API-PREV-001 | GET | `/api/preview?id=...` | User | Owned job returns HTML preview; missing ID 400; unknown/foreign ID 404. |
| API-DOWN-001 | GET | `/api/download?jobId=...&format=pdf` | User | Streams valid PDF attachment. |
| API-DOWN-002 | GET | `/api/download?jobId=...&format=docx` | User | Streams valid DOCX attachment. |
| API-DOWN-003 | GET | `/api/download?jobId=...&format=txt` | User | Streams valid TXT attachment. |
| API-DOWN-004 | GET | `/api/download?jobId=...&format=csv` | User | Streams valid CSV attachment. |
| API-DOWN-005 | GET | `/api/download?jobId=...&format=bad` | User | Unsupported format returns 400. |
| API-DOWN-006 | GET | `/api/download` missing query | User | Missing jobId/format returns 400. |
| API-DOWN-007 | GET | `/api/download?jobId=foreign&format=pdf` | User | If allowed by UAT policy, verify ownership protection or log as security defect. |
| API-EMAIL-001 | POST | `/api/email-notifications` | User | Valid `summaryId` and boolean save; missing fields 400; wrong job 404. |

### Support

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-SUP-001 | POST | `/api/support` | Optional | Guest/auth user can submit valid ticket; missing fields fail. |
| API-SUP-002 | GET | `/api/support` | Admin | Admin lists tickets; non-admin fails. |
| API-SUP-003 | PATCH | `/api/support/:id` | Admin | Valid status update persists; invalid status/unknown ticket fails. |
| API-SUP-004 | POST | `/api/support/:id/reply` | Admin | Valid reply persists and email path runs; empty message/unknown ticket fails. |

### Admin

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-ADM-001 | GET | `/api/admin/metrics/overview` | Admin | Returns overview KPIs. |
| API-ADM-002 | GET | `/api/admin/metrics/revenue` | Admin | Returns revenue metrics. |
| API-ADM-003 | GET | `/api/admin/metrics/users` | Admin | Returns user metrics. |
| API-ADM-004 | GET | `/api/admin/metrics/summaries` | Admin | Returns summary metrics. |
| API-ADM-005 | GET | `/api/admin/metrics/downloads` | Admin | Returns download metrics. |
| API-ADM-006 | GET | `/api/admin/metrics/support` | Admin | Returns support metrics. |
| API-ADM-007 | GET | `/api/admin/metrics/system-health` | Admin | Returns system health details without secret leakage. |
| API-ADM-008 | GET | `/api/admin/billing/expired` | Admin | Returns expired credit summary. |
| API-ADM-009 | POST | `/api/admin/reset-stuck-jobs` | Admin | Approved staging only; resets stuck jobs and returns count. |
| API-ADM-010 | POST | `/api/admin/reset-stuck-jobs-emergency` | Admin | Despite name, verify admin auth is still required. |

### Fine-Tune, Validation, Webcopy, Snapshots, Cleanup, Debug, Assets

| ID | Method | Endpoint | Auth | Required Checks |
|---|---|---|---|---|
| API-FT-001 | POST | `/api/fine-tune/upload-human-summary` | User | Multipart `file` upload succeeds/fails clearly. |
| API-FT-002 | POST | `/api/fine-tune/upload-training-pair` | User | Multipart `file` upload succeeds/fails clearly. |
| API-FT-003 | POST | `/api/fine-tune/generate-pairs` | User | Transcript + summary files generate JSONL or return clear error. |
| API-FT-004 | GET | `/api/fine-tune/history` | User | Returns current user's training assets/history. |
| API-VAL-001 | POST | `/api/validation/run` | User | Valid `jobId`/`summaryName` runs validation; foreign job behavior is checked if approved. |
| API-WEB-001 | POST | `/api/webcopy` | User | Valid `route` and `lines[]` succeeds; invalid body returns 400. |
| API-SNAP-001 | POST | `/api/snapshots` | None | Multipart snapshot upload works only when intended for staging QA. |
| API-SNAP-002 | POST | `/api/snapshots/meta` | None | Metadata logging works only when intended for staging QA. |
| API-CLEAN-001 | POST | `/api/cleanup/summaries` | Admin role in JWT | Admin-role token succeeds; standard user fails 403. |
| API-DBG-001 | GET | `/api/debug/stripe-account` | Debug enabled only | Disabled env returns 404; enabled staging returns account diagnostic only. |
| API-DBG-002 | GET | `/api/debug/stripe-key-prefix` | Debug enabled only | Disabled env returns 404; enabled staging returns non-secret prefix only. |
| API-ASSET-001 | GET | `/api/assets/:filename` | None | Allowed logo/icon files return; disallowed filenames return 404. |

## 7. Negative, Security, and Edge-Case Checks

Run these after the happy path unless the UAT owner asks for security checks first.

| ID | Check | Expected Result |
|---|---|---|
| NEG-001 | Send malformed JSON to a JSON endpoint. | Returns `400` with `INVALID_JSON`; server remains healthy. |
| NEG-002 | Remove bearer token from protected API calls. | Returns `401` and no protected data. |
| NEG-003 | Use invalid bearer token. | Returns `403` or equivalent invalid-token error. |
| NEG-004 | Open protected frontend routes as guest. | Redirects to `/login`. |
| NEG-005 | Use standard user token on admin APIs. | Returns `403` and no sensitive data. |
| NEG-006 | Use another user's job ID on preview. | Preview should deny access with 404. |
| NEG-007 | Use another user's job ID on download/status/validation if approved. | Deny access or record security defect if data is exposed. |
| NEG-008 | Upload invalid extension and missing required metadata. | Clear validation message; no job created; no credits consumed. |
| NEG-009 | Begin upload, then fail the signed storage PUT. | Reservation is not completed; user sees recovery path. |
| NEG-010 | Submit payment confirm twice or replay webhook. | Credits are not duplicated. |
| NEG-011 | Request unsupported download format. | Returns 400 and UI shows clear error. |
| NEG-012 | Use missing IDs for preview/download/email notification/support reply. | Returns 400/404 with no crash. |
| NEG-013 | Trigger network offline/slow conditions during upload, checkout, and download. | UI shows loading/error states and can recover. |
| NEG-014 | Paste script-like content into support fields and summary metadata. | UI/API store or display safely without executing scripts. |
| NEG-015 | Navigate directly to `/admin` as non-admin. | Backend blocks sensitive data even if page shell renders. |

## 8. Special Handling Notes

- Stripe webhook tests require a valid signed event from Stripe CLI or the Stripe dashboard. Do not send unsigned fake events and count them as success.
- Emergency reset endpoints mutate job state. Run them only in a staging window approved by the environment owner.
- Prompt config writes can affect all testers in staging. Prefer GET-only validation unless config edits are explicitly approved.
- Snapshot endpoints are intended for visual/regression evidence, not normal customer behavior.
- Debug routes should be disabled in production. In staging, they must never reveal full secret keys.
- The backend source of truth appears to be `backend/src`. A duplicate root `src` tree exists and should not be treated as the deployed backend without confirmation.
- `/api/summaries/view` is called by the frontend detail page but is not mounted in the current backend route inventory. Treat failures there as a UAT defect, not tester error.
- Some ownership-sensitive endpoints should be checked only with approved test accounts and non-production data.

## 9. Exit Criteria

UAT is complete when:

- Every row in `docs/manual-uat-e2e-matrix.csv` is marked Pass, Fail, Blocked, or N/A.
- All Fail and Blocked rows include evidence and an owner.
- The full happy-path sequence passes for at least one standard user.
- Payment, upload, processing, preview, download, billing, support, and admin verification have current evidence from staging.
- Any production-only differences, especially live Stripe and email settings, are documented before release.
