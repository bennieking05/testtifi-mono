# Production Readiness and Stripe Live Payments Report

## 1. Executive Summary

- Production ready: No.
- Stripe live payment ready: No.
- Staging still working: Partially verified. Staging loads and uses test Stripe keys, but the regression suite has API expectation failures and protected browser coverage was mostly skipped because the available credentials did not authenticate.
- Recommended decision: No-go for live customer payments until the launch blockers below are fixed and re-tested.

Top launch blockers:

- Production backend secret `backend-secrets-STRIPE_API_KEY` is a Stripe test key (`sk_test_...`) while the production frontend bundle uses a live publishable key (`pk_live_...`). Live payments cannot be considered enabled in this state.
- No live Stripe webhook endpoint could be verified because no live secret key was available locally or in Secret Manager.
- Production debug endpoints are publicly reachable in the currently deployed backend and exposed the Stripe key prefix during smoke testing. A code fix was prepared, but it has not been deployed because the working tree already contains unrelated backend changes.
- The available test credentials did not authenticate against production or staging API login, so authenticated API/payment/summary regression coverage was incomplete.

## 2. Environment Comparison

| Area | Staging Value | Production Value | Status | Notes |
|---|---|---|---|---|
| GCP project | `golden-cosmos-450417-i8` | `golden-cosmos-450417-i8` | Pass | Same project, separate Cloud Run services and Secret Manager prefixes. |
| Region | `us-central1` | `us-central1` | Pass | Same region. |
| Frontend domain | `https://staging.app.testifi.ai` | `https://app.testifi.ai` | Pass | Domain mappings ready, TLS provisioned and routable. |
| Frontend service | `testifi-frontend-staging` | `testifi-frontend` | Pass | Both Cloud Run services ready. |
| Backend service | `testifi-backend-staging` | `testifi-backend` | Pass | Both Cloud Run services ready. |
| Worker service | `testifi-summarize-worker-staging` | `testifi-summarize-worker` | Pass | Both Cloud Run services ready. |
| Backend image | `gcr.io/.../testifi-backend:staging` | `gcr.io/.../testifi-backend:signed-url-fix` | Review | Production image tag is not `latest`; deploy config drift should be tracked before release. |
| Frontend image | `gcr.io/.../testifi-frontend:staging` | `gcr.io/.../testifi-frontend:prod-signed-url` | Review | Production image tag is not `latest`; current bundle loads. |
| Worker image | `gcr.io/.../summarize-worker:staging` | `gcr.io/.../summarize-worker:healthfix` | Review | Production worker is ready and already uses `gpt-5-testifi`. |
| `NODE_ENV` | `staging` | `production` | Pass | Correct. |
| `BASE_URL` | `https://staging.app.testifi.ai` | `https://app.testifi.ai` | Pass | Correct. |
| `BACKEND_URL` | `https://staging.app.testifi.ai` | `https://app.testifi.ai` | Pass | Correct on backend service. |
| Frontend `VITE_API_URL` | `https://testifi-backend-staging-748916208557.us-central1.run.app` | `https://testifi-backend-748916208557.us-central1.run.app` | Pass | Frontend bundles target matching backend environments. |
| `DATABASE_URL` | Secret exists; Cloud SQL socket; contains staging marker | Secret exists; Cloud SQL socket; contains `testifi` | Review | Separate secret names. Production DB identity should be manually confirmed before launch. |
| Cloud SQL attachment | `golden-cosmos-450417-i8:us-central1:testifi` | `golden-cosmos-450417-i8:us-central1:testifi` | Review | Same instance, likely different DB/schema through URL. Confirm isolation manually. |
| Storage buckets | Hardcoded `deposition-files`, `deposition-summaries` | Hardcoded `deposition-files`, `deposition-summaries` | Risk | Storage is not environment-specific in code reviewed. Confirm object prefixes/permissions prevent cross-environment leakage. |
| `JWT_SECRET` | Exists; length 128; same hash prefix as production | Exists; length 128; same hash prefix as staging | Risk | Staging and production appear to share the same JWT secret. Rotate/separate with care if session isolation is required. |
| `SENDGRID_API_KEY` | Exists; SendGrid-like | Exists; SendGrid-like | Pass | Values masked. Sender is `admin@testifi.ai`. |
| `EMAIL_USER` | `admin@testifi.ai` | `admin@testifi.ai` | Pass | Same sender. |
| `AZURE_OPENAI_API_KEY` | Exists | Exists | Pass | Values masked. |
| `AZURE_OPENAI_ENDPOINT` | `testifi.openai.azure.com` | `testifi.openai.azure.com` | Pass | Same Azure resource. |
| `AZURE_OPENAI_DEPLOYMENT_NAME` backend | `gpt-4o` | Changed from `gpt-4o` to `gpt-5-testifi` | Fixed | Production backend now matches production deploy config. |
| `AZURE_OPENAI_DEPLOYMENT_NAME` worker | `gpt-4o` | `gpt-5-testifi` | Pass | Correct environment split. |
| `AZURE_API_VERSION` | `2025-01-01-preview` | `2025-01-01-preview` | Pass | Same. |
| Frontend Stripe publishable key | `pk_test_...` | `pk_live_...` | Pass | Correct mode split in deployed bundles. |
| Backend `STRIPE_API_KEY` | `sk_test_...` | `sk_test_...` | Fail | Production backend must use `sk_live_...`. |
| `STRIPE_WEBHOOK_SECRET` | Exists; `whsec_...` | Exists; `whsec_...` | Review | Existing values exist, but no matching Stripe endpoint was verified. |
| Stripe webhook endpoint | No endpoint returned by test-mode Stripe API | Not verifiable without live secret key | Fail | Correct app route is `/api/purchase/stripe-webhook`. |
| CORS | `app.use(cors())` | `app.use(cors())` | Risk | Permissive CORS in backend code. |
| Debug routes | Deployed staging returns 401 | Deployed production returned 200 with key prefix | Fail | Code fix prepared to 404 in production, not deployed. |
| Payment credits | Server tier pricing in `purchaseRoutes.ts`; no Stripe Price IDs | Same | Pass | Amounts are computed server-side and metadata includes user/credits. |

## 3. Stripe Configuration Review

Current architecture:

- Frontend pages/components: `loveable/src/pages/Payment.tsx`, `loveable/src/pages/Checkout.tsx`, `loveable/src/components/payment/StripeCheckoutForm.tsx`, `loveable/src/pages/Success.tsx`, `loveable/src/pages/AccountBilling.tsx`.
- Backend routes: `backend/src/routes/purchaseRoutes.ts`, mounted from `backend/src/server.ts`.
- Webhook route: `POST /api/purchase/stripe-webhook`, registered before JSON body parsing with `bodyParser.raw`.
- Primary flow: frontend requests `POST /api/purchase/purchase-credits`, backend creates a Stripe PaymentIntent, frontend confirms with Stripe Elements, frontend calls `POST /api/purchase/confirm`, backend records credits.
- Webhook events handled: `payment_intent.succeeded`, `checkout.session.completed`, `charge.refund.created`, `charge.dispute.created`.
- Database tables updated: `Purchase` and `LedgerEntry`. `LedgerEntry.idempotencyKey` uses `pi:<paymentIntentId>`, `refund:<refundId>`, and `dispute:<disputeId>` patterns to avoid duplicate credit/refund application.
- Stripe catalog: the active flow does not use Stripe Price IDs. Credit price tiers are app-defined and server-calculated.

Findings:

- Production frontend is live-mode, but production backend is test-mode. This is the main live payment blocker.
- Existing docs/scripts referred to `/api/purchase/webhook`; they were corrected to `/api/purchase/stripe-webhook`.
- A hardcoded webhook signing secret in setup docs was redacted.
- No live Stripe dashboard webhook could be verified because no `sk_live_...` key was available.
- Failed payment events are not explicitly handled in `purchaseRoutes.ts`; unpaid PaymentIntents remain `requires_payment_method` unless later confirmed or succeeded via webhook.

Required Stripe dashboard configuration before launch:

- Production secret key: `sk_live_...` stored in `backend-secrets-STRIPE_API_KEY`.
- Production publishable key: matching `pk_live_...` used in frontend build.
- Live webhook endpoint URL: `https://app.testifi.ai/api/purchase/stripe-webhook`.
- Enabled live events: `payment_intent.succeeded`, `checkout.session.completed`, `charge.refund.created`, `charge.dispute.created`.
- Webhook signing secret: matching `whsec_...` stored in `backend-secrets-STRIPE_WEBHOOK_SECRET`.

## 4. Production Smoke Test Results

| Check | Result | Notes |
|---|---:|---|
| `https://app.testifi.ai/` loads | Pass | HTTP 200. |
| `https://app.testifi.ai/login` loads | Pass | HTTP 200. |
| Backend `/health` | Pass | HTTP 200 `OK`. |
| Webhook unsigned request | Pass | HTTP 400 `Missing stripe-signature header`. |
| Frontend API URL isolation | Pass | Bundle references production backend run.app URL only. |
| Frontend Stripe mode | Pass | Bundle contains `pk_live_...`; no `sk_...` or `whsec_...` in bundle. |
| Backend Stripe mode | Fail | Production backend secret is `sk_test_...`. |
| Debug route exposure | Fail | `/api/debug/stripe-key-prefix` returned 200 and exposed `sk_test...` prefix. |
| Login with available credentials | Fail | Browser smoke stayed on `/login`; API login returned 400. |
| Checkout/payment smoke | Blocked | Checkout redirects to login with available credentials; backend key mismatch prevents live payment validation. |
| Recent production error logs | Pass | No recent matching Cloud Run error log rows returned by the query. |

## 5. Production Regression Test Results

Command: `npm run test:regression:prod`

Artifacts:

- API results: `test-results/api-results-2026-04-26T15-39-14-497Z.csv`
- Summary: `test-results/regression-summary-2026-04-26T15-39-14-447Z.csv`
- Screenshots: `test-results/screenshots/`

Results:

- API phase: 12/12 passed, but authenticated API coverage was skipped because admin login failed with HTTP 400.
- Playwright phase: started 74 tests; output stats showed 25 expected, 14 skipped, 35 unexpected. Many later failures were `net::ERR_INTERNET_DISCONNECTED` or navigation timeouts.
- Runner summary: 12 passed, 1 failed, 92.3% because the runner collapses frontend JSON into a single frontend result.

Important coverage gaps:

- Authenticated production API routes were not validated.
- Production checkout/payment completion was not validated.
- Core upload/summary workflows were not validated because auth did not succeed.

## 6. Staging Regression Test Results

Command: `npm run test:regression:staging`

Artifacts:

- API results: `test-results/api-results-2026-04-27T13-10-15-649Z.csv`
- Summary: `test-results/regression-summary-2026-04-27T13-10-15-598Z.csv`
- Screenshots: `test-results/screenshots/`

Results:

- Staging frontend loaded, login page loaded, and backend `/health` returned 200.
- Staging frontend bundle contains `pk_test_...`, no secret keys, and references the staging backend URL.
- Staging backend Stripe secret is `sk_test_...`.
- API phase: 9 passed, 3 failed.
- Frontend phase: no unexpected failures; output stats showed 30 expected, 44 skipped, 0 unexpected. Protected coverage was mostly skipped due the same auth issue.

API failures:

- `POST /api/snapshots`: returned 401, expected 400.
- `POST /api/snapshots/meta`: returned 401, expected 200/400/504.
- `GET /api/emergency/job-status`: returned 404, expected 200.

Interpretation:

- These staging API failures look like route hardening or endpoint removal relative to outdated regression expectations, not evidence that staging is broken.
- Staging was not modified except for local documentation/script/code changes in the repository; no staging Cloud Run config or secrets were changed.

## 7. Issues Found and Fixes Applied

| Issue | Root Cause | Files/Config Changed | Retest | Result |
|---|---|---|---|---|
| Production backend used `gpt-4o` while production deploy config expects `gpt-5-testifi`. | Live Cloud Run drift from repo deploy scripts. | Cloud Run `testifi-backend` env updated to `AZURE_OPENAI_DEPLOYMENT_NAME=gpt-5-testifi`; new revision `testifi-backend-00007-5fx`. | `gcloud run services describe` | Fixed in production. |
| Stripe setup docs/scripts used wrong webhook path. | Docs/scripts referenced `/api/purchase/webhook`; app implements `/api/purchase/stripe-webhook`. | `setup-production-stripe.sh`, `backend/setup-production-stripe.sh`, `STRIPE-PRODUCTION-SETUP.md`, `backend/STRIPE-PRODUCTION-SETUP.md`, `PRODUCTION-STRIPE-FINAL-SETUP.md`, `backend/PRODUCTION-STRIPE-FINAL-SETUP.md`. | `bash -n` and masked repo scan | Fixed locally. |
| Setup scripts referenced Kubernetes secrets/deployments for a Cloud Run app. | Legacy GKE instructions. | Same Stripe setup scripts/docs now use Secret Manager and Cloud Run commands. | `bash -n` | Fixed locally. |
| Webhook signing secret was present in docs. | Sensitive setup value committed into markdown. | Root and backend production Stripe setup docs. | Masked repo scan for `whsec_...` | Fixed locally; no remaining `whsec_...` hits found. |
| Production debug endpoint exposed Stripe key prefix. | `debugRoutes.ts` allowed unauthenticated access. | `backend/src/routes/debugRoutes.ts`, `src/routes/debugRoutes.ts`. | Lint check | Code fix prepared, not deployed. Production still needs a controlled backend release. |

Build result:

- `npm run build`: passed.

## 8. Remaining Risks

- Production live payments are blocked until `backend-secrets-STRIPE_API_KEY` is updated to a real `sk_live_...` value and the backend is restarted.
- A live Stripe webhook endpoint must be created or verified in Stripe Dashboard for `https://app.testifi.ai/api/purchase/stripe-webhook`, and its signing secret must be stored in production Secret Manager.
- The production debug route fix is not live until a controlled backend deploy is performed. Do not deploy from the current dirty working tree without reviewing unrelated backend changes.
- Available test credentials do not authenticate cleanly in production or staging API tests, so authenticated regression coverage is incomplete.
- Staging and production appear to share the same JWT secret. Confirm whether this is intentional before launch.
- Storage bucket names appear shared/hardcoded. Confirm production and staging storage isolation before customer use.
- Backend CORS is permissive. Consider restricting allowed origins before launch.
- Regression script expectations for staging snapshots/emergency endpoints appear stale.
- No real live transaction was performed. This was intentionally skipped because backend live Stripe credentials are not configured.

## 9. Launch Checklist

- [x] DNS/domain mapping for `app.testifi.ai` is ready.
- [x] SSL/TLS for `app.testifi.ai` is provisioned.
- [x] Production frontend URL is `https://app.testifi.ai`.
- [x] Production API URL in frontend bundle points to production backend run.app URL.
- [x] Production backend `BASE_URL` and `BACKEND_URL` point to `https://app.testifi.ai`.
- [ ] Auth test account works in production.
- [ ] Auth redirect URLs are manually confirmed for production.
- [ ] CORS allowed origins are restricted or accepted as a deliberate risk.
- [x] Stripe live publishable key is present in the production frontend bundle.
- [ ] Stripe live secret key is stored in production Secret Manager.
- [ ] Stripe live webhook endpoint exists and points to `/api/purchase/stripe-webhook`.
- [ ] Stripe live webhook signing secret matches the dashboard endpoint.
- [ ] Stripe products/prices are confirmed not required, or configured if the business wants dashboard-managed prices.
- [ ] Production database identity is manually confirmed.
- [ ] Storage bucket isolation is manually confirmed.
- [x] Email sender and SendGrid secret exist.
- [ ] Production debug route hardening is deployed.
- [x] Build passed.
- [ ] Production regression suite passes with authenticated coverage.
- [ ] Staging regression suite passes or expected statuses are updated for hardened routes.
- [ ] Live payment validation completed with the smallest approved transaction and refund/rollback plan.
- [ ] Rollback plan is documented with the previous Cloud Run revisions/images.

## 10. Final Recommendation

No-go for production launch with live payments today.

Production infrastructure is reachable and the frontend/backend services are healthy, but live Stripe is not ready because the production backend is still configured with a test secret key and no live webhook endpoint was verified. Complete the Stripe live secret/webhook setup, deploy the debug route hardening through a controlled backend release, fix or replace the regression credentials, and re-run production plus staging regression before launch.
