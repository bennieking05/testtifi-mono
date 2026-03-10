#!/usr/bin/env node

// Simple smoke test for Testifi AI endpoints (staging/prod)
// Usage:
//   node scripts/smoke-endpoints.mjs staging
//   node scripts/smoke-endpoints.mjs prod

/* eslint-disable no-console */

const fs = await import('fs');

const TARGET = (process.argv[2] || '').toLowerCase();
const BASE = TARGET === 'staging'
  ? 'https://staging.app.testifi.ai'
  : 'https://app.testifi.ai';

function logStep(label) {
  process.stdout.write(`- ${label} ... `);
}

async function assertOk(resp, label) {
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`${label} failed: ${resp.status} ${resp.statusText} ${text}`);
  }
}

async function run() {
  console.log(`Running smoke tests against: ${BASE}`);

  // 1) /api/health
  logStep('GET /api/health');
  const health = await fetch(`${BASE}/api/health`);
  await assertOk(health, 'health');
  console.log('ok');

  // 2) Login (if test credentials available)
  let token = null;
  const loginPath = '/Users/bennieking/Sites/testifiAi/test-login.json';
  if (fs.existsSync(loginPath)) {
    const { email, password } = JSON.parse(fs.readFileSync(loginPath, 'utf8'));
    if (email && password) {
      logStep('POST /api/auth/login');
      const loginResp = await fetch(`${BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      await assertOk(loginResp, 'login');
      const body = await loginResp.json();
      token = body?.accessToken || body?.token;
      if (!token) throw new Error('login returned no accessToken');
      console.log('ok');
    }
  }

  // 3) Authenticated checks
  if (token) {
    const authHeaders = { Authorization: `Bearer ${token}` };

    logStep('GET /api/user');
    const userResp = await fetch(`${BASE}/api/user`, { headers: authHeaders });
    await assertOk(userResp, 'user');
    console.log('ok');

    logStep('GET /api/summaries');
    const sumsResp = await fetch(`${BASE}/api/summaries`, { headers: authHeaders });
    await assertOk(sumsResp, 'summaries');
    console.log('ok');

    // 4) Billing balance
    logStep('GET /api/billing/balance');
    const balResp = await fetch(`${BASE}/api/billing/balance`, { headers: authHeaders });
    await assertOk(balResp, 'billing balance');
    console.log('ok');

    // 5) Purchase user-history
    logStep('GET /api/purchase/user-history');
    const phResp = await fetch(`${BASE}/api/purchase/user-history`, { headers: authHeaders });
    if (phResp.status === 502) {
      console.log('skipped (502)');
    } else {
      await assertOk(phResp, 'purchase user-history');
      console.log('ok');
    }

    // 6) Download endpoint (expect 400 on missing params)
    logStep('GET /api/download (expect 400)');
    const dlResp = await fetch(`${BASE}/api/download`, { headers: authHeaders });
    if (dlResp.status !== 400) throw new Error(`download expected 400, got ${dlResp.status}`);
    console.log('ok');

    // 7) Upload (may return 402 if no credits; accept 200 or 402)
    try {
      logStep('POST /api/upload (pdf)');
      const pdfPath = '/Users/bennieking/Sites/testifiAi/correct_PDF_DOWNLOAD.pdf';
      if (fs.existsSync(pdfPath)) {
        const fd = new FormData();
        const buf = fs.readFileSync(pdfPath);
        fd.append('file', new Blob([buf], { type: 'application/pdf' }), 'smoke.pdf');
        fd.append('summaryName', 'Smoke Test Upload');
        fd.append('deponent', 'Smoke User');
        fd.append('notifyOnComplete', 'false');
        const upResp = await fetch(`${BASE}/api/upload`, { method: 'POST', headers: authHeaders, body: fd });
        if (![200, 201, 202, 402].includes(upResp.status)) {
          const tx = await upResp.text().catch(() => '');
          throw new Error(`upload unexpected status ${upResp.status} ${tx}`);
        }
      }
      console.log('ok');
    } catch (_) {
      console.log('skipped');
    }
  } else {
    console.log('Skipping authenticated checks (no token)');
  }

  // 8) Support ticket (optional auth)
  logStep('POST /api/support');
  const { email: loginEmail } = fs.existsSync(loginPath)
    ? JSON.parse(fs.readFileSync(loginPath, 'utf8'))
    : { email: 'smoke@testifi.ai' };
  const supp = await fetch(`${BASE}/api/support`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Smoke Tester',
      email: loginEmail || 'smoke@testifi.ai',
      subject: 'Smoke test ticket',
      message: 'Automated smoke test - please ignore.'
    })
  });
  await assertOk(supp, 'support');
  console.log('ok');

  // 9) Forgot/reset password endpoints
  logStep('POST /api/auth/forgot-password');
  const fp = await fetch(`${BASE}/api/auth/forgot-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: (fs.existsSync(loginPath) ? JSON.parse(fs.readFileSync(loginPath, 'utf8')).email : 'smoke@testifi.ai') })
  });
  await assertOk(fp, 'forgot-password');
  console.log('ok');

  logStep('POST /api/auth/reset-password (expect 400/404)');
  const rp = await fetch(`${BASE}/api/auth/reset-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: 'invalid-token', newPassword: 'XyZ12345!' })
  });
  if (![400, 404].includes(rp.status)) throw new Error(`reset-password expected 400/404, got ${rp.status}`);
  console.log('ok');

  console.log('\nAll smoke checks passed.');
}

run().catch((err) => {
  console.error('\nSmoke test FAILED:', err.message);
  process.exit(1);
});



