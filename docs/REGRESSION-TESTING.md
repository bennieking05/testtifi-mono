# TestifiAI Regression Testing Documentation

This document provides a comprehensive overview of the regression testing suite for TestifiAI, including all API endpoints and frontend pages that are tested.

## Quick Start

```bash
# Run full regression suite (API + Frontend)
npm run test:regression

# Run against specific environment
npm run test:regression:local    # localhost
npm run test:regression:staging  # staging.app.testifi.ai
npm run test:regression:prod     # app.testifi.ai

# Run API tests only
npm run test:api
npm run test:api:staging

# Run frontend tests only
npm run test:frontend
```

## Test Results

Results are output to `test-results/` directory:

| File | Description |
|------|-------------|
| `api-results-{timestamp}.csv` | API endpoint test results |
| `frontend-results-{timestamp}.csv` | Frontend test results |
| `regression-summary-{timestamp}.csv` | Aggregated summary |
| `screenshots/` | Test screenshots |

### CSV Format

**API Results:**
```
timestamp,endpoint,method,status_code,expected_status,passed,response_time_ms,error_message
```

**Summary:**
```
timestamp,target,total_tests,passed,failed,pass_rate,api_passed,api_failed,frontend_passed,frontend_failed
```

---

## API Endpoint Inventory

### Health Checks
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/health` | No | K8s liveness/readiness probe |
| GET | `/api/health` | No | Public health check |

### Authentication (`/api/auth`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | No | User registration |
| POST | `/api/auth/login` | No | User login |
| POST | `/api/auth/forgot-password` | No | Request password reset |
| POST | `/api/auth/reset-password` | No | Reset password with token |
| GET | `/api/auth/get-reset-email` | No | Get email for reset token |
| POST | `/api/auth/refresh-token` | No | Refresh access token |

### User (`/api/user`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/user` | Yes | Get current user profile |
| GET | `/api/user/credits` | Yes | Get credit balance |
| GET | `/api/user/signups` | Admin | List all user signups |

### Billing (`/api/billing`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/billing/balance` | Yes | Get effective credit balance |
| GET | `/api/billing/history` | Yes | Get billing history (paginated) |
| POST | `/api/billing/debit` | Yes | Debit credits for summary |

### Purchase (`/api/purchase`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/purchase/purchase-credits` | Yes | Create payment intent |
| POST | `/api/purchase/update-payment-intent` | Yes | Update payment amount |
| POST | `/api/purchase/confirm` | Yes | Confirm payment |
| GET | `/api/purchase/history` | Admin | All purchase history |
| GET | `/api/purchase/user-history` | Yes | User's purchase history |
| POST | `/api/purchase/stripe-webhook` | No | Stripe webhook handler |

### Summaries (`/api/summaries`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/summaries` | Yes | List user's summaries |
| GET | `/api/summaries/prompt-config` | Yes | Get prompt configuration |
| PUT | `/api/summaries/prompt-config` | Yes | Update prompt config |
| GET | `/api/summaries/download-history` | Yes | Get download history |

### Download (`/api/download`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/download?jobId=X&format=Y` | Yes | Download summary (pdf/docx/txt/csv) |

### Upload (`/api/upload`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/upload` | Yes | Upload file for summarization |

### Support (`/api/support`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/support` | Optional | Submit support ticket |
| GET | `/api/support` | Admin | List all tickets |
| PATCH | `/api/support/:id` | Admin | Update ticket status |
| POST | `/api/support/:id/reply` | Admin | Reply to ticket |

### Summary Jobs (`/api/summary-jobs`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/summary-jobs/:jobId` | Yes | Get job status |
| POST | `/api/summary-jobs/upload` | Yes | Upload and start job |

### Preview (`/api/preview`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/preview?id=X` | Yes | Get summary preview HTML |

### Snapshots (`/api/snapshots`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/snapshots` | No | Upload snapshot |
| POST | `/api/snapshots/meta` | No | Log metadata |

### Email Notifications (`/api/email-notifications`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/email-notifications` | Yes | Set notification preference |

### Validation (`/api/validation`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/validation/run` | Yes | Run validation on summary |

### Admin (`/api/admin`)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/admin/metrics/overview` | Admin | Dashboard KPIs |
| GET | `/api/admin/metrics/revenue` | Admin | Revenue metrics |
| GET | `/api/admin/metrics/users` | Admin | User analytics |
| GET | `/api/admin/metrics/summaries` | Admin | Summary metrics |
| GET | `/api/admin/metrics/downloads` | Admin | Download analytics |
| GET | `/api/admin/metrics/support` | Admin | Support metrics |
| GET | `/api/admin/metrics/system-health` | Admin | System health |
| GET | `/api/admin/billing/expired` | Admin | Expired credits info |
| POST | `/api/admin/reset-stuck-jobs` | Admin | Reset stuck jobs |

### Emergency Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/api/emergency/job-status` | No | Check job status |
| POST | `/api/emergency/reset-stuck-jobs` | No | Reset stuck jobs |

---

## Frontend Page Inventory

### Public Pages (No Auth Required)
| Route | Page | Description |
|-------|------|-------------|
| `/login` | Login | User login form |
| `/register` | Register | User registration form |
| `/forgot-password` | ForgotPassword | Request password reset |
| `/reset-password/:token` | ResetPassword | Reset password with token |
| `/terms` | Terms | Terms of service |
| `/privacy` | Privacy | Privacy policy |
| `*` | NotFound | 404 page |

### Protected Pages (Auth Required)
| Route | Page | Description |
|-------|------|-------------|
| `/` | Summaries | Default landing (summaries list) |
| `/dashboard` | Dashboard | User dashboard |
| `/summaries` | Summaries | List of summaries |
| `/summaries/:id` | SummaryDetail | Summary detail view |
| `/create-summary` | CreateSummary | Upload and create summary |
| `/preview/:id` | SummaryPreview | Preview summary |
| `/download/:id` | DownloadSummary | Download summary |
| `/payment` | Payment | Purchase credits |
| `/checkout` | Checkout | Stripe checkout |
| `/account/billing` | Billing | Billing history |
| `/success` | Success | Payment success |
| `/help` | Help | Help documentation |
| `/support` | Support | Submit support ticket |
| `/automation` | Automation | Automation features |
| `/case-preparation` | CasePreparation | Case prep tools |
| `/ai-insights` | AIInsights | AI insights |
| `/collaboration` | Collaboration | Team collaboration |
| `/security-commitment` | SecurityCommitment | Security info |

### Admin Pages (Admin Role Required)
| Route | Page | Description |
|-------|------|-------------|
| `/admin` | Admin | Admin dashboard |
| `/admin/finetune` | AdminFineTune | Prompt fine-tuning |

---

## Test Configuration

### Test Credentials

Create `test-login.json` in project root for authenticated tests:
```json
{
  "email": "test@example.com",
  "password": "yourpassword"
}
```

For admin tests, create `test-admin-login.json`:
```json
{
  "email": "admin@example.com",
  "password": "adminpassword"
}
```

### Environment URLs

| Target | Backend URL | Frontend URL |
|--------|-------------|--------------|
| local | http://localhost:4000 | http://localhost:5173 |
| staging | https://staging.app.testifi.ai | https://staging.app.testifi.ai |
| prod | https://app.testifi.ai | https://app.testifi.ai |

---

## Adding New Tests

### Adding a New API Endpoint Test

1. Open `scripts/api-regression.mjs`
2. Add test to appropriate function or create new test suite
3. Update this documentation

```javascript
// Example: Add new endpoint test
await testEndpoint('New Endpoint', 'GET', '/api/new-endpoint', {
  headers,
  expectedStatus: 200,
});
```

### Adding a New Frontend Page Test

1. Open `tests/regression/pages.spec.ts`
2. Add test to appropriate describe block
3. Update this documentation

```typescript
test('New page loads', async ({ page }) => {
  await page.goto('/new-page');
  await page.waitForLoadState('networkidle');
  await snap(page, 'page-new-page');
});
```

---

## Maintenance

**When adding new routes:**
1. Add endpoint to `scripts/api-regression.mjs`
2. Update the API Endpoint Inventory table above

**When adding new frontend pages:**
1. Add test to `tests/regression/pages.spec.ts`
2. Update the Frontend Page Inventory table above

**When modifying endpoints:**
1. Update expected status codes in tests
2. Update documentation tables

---

## Troubleshooting

### Common Issues

1. **Auth tests skipped**: Ensure `test-login.json` exists with valid credentials
2. **Admin tests skipped**: Ensure `test-admin-login.json` exists with admin credentials
3. **Frontend tests fail to start**: Ensure frontend dev server is running for local tests
4. **Network errors**: Check if backend server is accessible at configured URL

### Running Individual Tests

```bash
# Run specific Playwright test file
npx playwright test tests/regression/auth.spec.ts

# Run with headed browser
npx playwright test tests/regression/ --headed

# Run with debug mode
npx playwright test tests/regression/ --debug
```

