/**
 * Evidence Screenshot Spec
 *
 * Captures deterministic desktop + mobile screenshots for core flows.
 * Run with:  npm run test:evidence
 *
 * Env vars:
 *   FEATURE_NAME  - folder label (default: "default")
 *   EVIDENCE_TS   - timestamp label (default: auto-generated)
 *   BASE_URL      - target app URL (set via playwright.config.ts)
 */

import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  evidenceScreenshot,
  getEvidenceDir,
  getScreenshotCount,
  getTimestamp,
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
} from '../utils/screenshot';

// ── Credentials (same pattern as existing regression specs) ──────────────────
let testEmail = process.env.TEST_EMAIL || '';
let testPassword = process.env.TEST_PASSWORD || '';

if (!testEmail || !testPassword) {
  try {
    const loginFile = path.join(process.cwd(), 'test-login.json');
    if (fs.existsSync(loginFile)) {
      const creds = JSON.parse(fs.readFileSync(loginFile, 'utf8'));
      testEmail = testEmail || creds.email || '';
      testPassword = testPassword || creds.password || '';
    }
  } catch {
    // no creds
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function login(page: Page): Promise<boolean> {
  if (!testEmail || !testPassword) return false;

  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1000);

  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();

  await emailInput.fill(testEmail);
  await passwordInput.fill(testPassword);
  await submitButton.click();

  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

async function captureDesktopAndMobile(
  page: Page,
  index: number,
  name: string,
  route: string,
) {
  // Desktop
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.goto(route);
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);
  await evidenceScreenshot(page, index, name, 'desktop');

  // Mobile
  await page.setViewportSize(MOBILE_VIEWPORT);
  await page.waitForTimeout(500);
  await evidenceScreenshot(page, index, name, 'mobile');

  // Reset to desktop
  await page.setViewportSize(DESKTOP_VIEWPORT);
}

// ── Evidence Tests ───────────────────────────────────────────────────────────

test.describe('Evidence Screenshots — Public Flows', () => {
  test('01 — Login page', async ({ page }) => {
    await captureDesktopAndMobile(page, 1, 'login', '/login');
  });

  test('02 — Register page', async ({ page }) => {
    await captureDesktopAndMobile(page, 2, 'register', '/register');
  });

  test('03 — Forgot Password page', async ({ page }) => {
    await captureDesktopAndMobile(page, 3, 'forgot-password', '/forgot-password');
  });

  test('04 — Terms page', async ({ page }) => {
    await captureDesktopAndMobile(page, 4, 'terms', '/terms');
  });

  test('05 — Privacy page', async ({ page }) => {
    await captureDesktopAndMobile(page, 5, 'privacy', '/privacy');
  });
});

test.describe('Evidence Screenshots — Authenticated Flows', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('06 — Dashboard', async ({ page }) => {
    await captureDesktopAndMobile(page, 6, 'dashboard', '/dashboard');
  });

  test('07 — Summaries list', async ({ page }) => {
    await captureDesktopAndMobile(page, 7, 'summaries', '/summaries');
  });

  test('08 — Create Summary', async ({ page }) => {
    await captureDesktopAndMobile(page, 8, 'create-summary', '/create-summary');
  });

  test('09 — Payment / Pricing', async ({ page }) => {
    await captureDesktopAndMobile(page, 9, 'payment', '/payment');
  });

  test('10 — Billing', async ({ page }) => {
    await captureDesktopAndMobile(page, 10, 'billing', '/account/billing');
  });

  test('11 — Support', async ({ page }) => {
    await captureDesktopAndMobile(page, 11, 'support', '/support');
  });

  test('12 — Help', async ({ page }) => {
    await captureDesktopAndMobile(page, 12, 'help', '/help');
  });

  test('13 — Automation', async ({ page }) => {
    await captureDesktopAndMobile(page, 13, 'automation', '/automation');
  });

  test('14 — Case Preparation', async ({ page }) => {
    await captureDesktopAndMobile(page, 14, 'case-preparation', '/case-preparation');
  });

  test('15 — AI Insights', async ({ page }) => {
    await captureDesktopAndMobile(page, 15, 'ai-insights', '/ai-insights');
  });

  test('16 — Collaboration', async ({ page }) => {
    await captureDesktopAndMobile(page, 16, 'collaboration', '/collaboration');
  });
});

test.describe('Evidence Summary', () => {
  test('Print evidence summary', async () => {
    const dir = getEvidenceDir();
    const count = getScreenshotCount();
    const ts = getTimestamp();

    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log('  EVIDENCE CAPTURE SUMMARY');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  📸 Screenshots Captured: ${count}`);
    console.log(`  📁 Evidence Location:    ${dir}`);
    console.log(`  🕒 Timestamp:            ${ts}`);
    console.log('══════════════════════════════════════════════════════════');
    console.log('');

    // This test always passes — it's just a summary printer
    expect(true).toBe(true);
  });
});
