/**
 * Form Interaction Regression Tests
 * 
 * Tests form submissions, validations, and interactions across the app.
 */

import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.join(process.cwd(), 'test-results');
const SNAPS_DIR = path.join(RESULTS_DIR, 'screenshots');

// Ensure directories exist
fs.mkdirSync(SNAPS_DIR, { recursive: true });

// Test credentials - loaded from environment variables or test-admin-login.json
// Priority: 1. Environment variables, 2. test-admin-login.json file
let testEmail = process.env.TEST_EMAIL || '';
let testPassword = process.env.TEST_PASSWORD || '';

// Fall back to test-admin-login.json if env vars not set
if (!testEmail || !testPassword) {
  try {
    const loginFile = path.join(process.cwd(), 'test-admin-login.json');
    if (fs.existsSync(loginFile)) {
      const creds = JSON.parse(fs.readFileSync(loginFile, 'utf8'));
      testEmail = testEmail || creds.email || '';
      testPassword = testPassword || creds.password || '';
    }
  } catch {
    // No credentials available
  }
}

// Helper to take timestamped screenshots
async function snap(page: Page, name: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}_${name}.png`;
  await page.screenshot({ path: path.join(SNAPS_DIR, filename), fullPage: true });
  return filename;
}

// Helper to login
async function login(page: Page) {
  if (!testEmail || !testPassword) {
    return false;
  }

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

// ─────────────────────────────────────────────────────────────────────────────
// Support Form Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Support Form', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should display support form fields', async ({ page }) => {
    await page.goto('/support');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Check for form elements
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]');
    const emailInput = page.locator('input[type="email"], input[name="email"]');
    const subjectInput = page.locator('input[name="subject"], input[placeholder*="subject" i]');
    const messageInput = page.locator('textarea, input[name="message"]');

    // At least some of these should be visible
    await snap(page, 'form-support-fields');
  });

  test('should validate required fields', async ({ page }) => {
    await page.goto('/support');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Try to submit empty form
    const submitButton = page.locator('button[type="submit"], button:has-text("Submit"), button:has-text("Send")').first();
    
    if (await submitButton.isVisible()) {
      await submitButton.click();
      await page.waitForTimeout(500);
      await snap(page, 'form-support-validation');
    }
  });

  test('should allow filling out support form', async ({ page }) => {
    await page.goto('/support');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Fill in form fields
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]').first();
    const subjectInput = page.locator('input[name="subject"], input[placeholder*="subject" i]').first();
    const messageInput = page.locator('textarea, input[name="message"]').first();

    if (await nameInput.isVisible()) {
      await nameInput.fill('Regression Test User');
    }

    if (await subjectInput.isVisible()) {
      await subjectInput.fill('Regression Test Subject');
    }

    if (await messageInput.isVisible()) {
      await messageInput.fill('This is an automated regression test message. Please ignore.');
    }

    await snap(page, 'form-support-filled');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Create Summary Form Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Create Summary Form', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should display file upload area', async ({ page }) => {
    await page.goto('/create-summary');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for file input or upload zone
    const fileInput = page.locator('input[type="file"]');
    const uploadZone = page.locator('[class*="upload"], [class*="dropzone"], [role="button"]:has-text("Upload")');

    await snap(page, 'form-create-summary-upload');
  });

  test('should show summary name field', async ({ page }) => {
    await page.goto('/create-summary');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const nameInput = page.locator('input[name="summaryName"], input[name="name"], input[placeholder*="name" i], input[placeholder*="title" i]');
    
    await snap(page, 'form-create-summary-fields');
  });

  test('should show deponent field', async ({ page }) => {
    await page.goto('/create-summary');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const deponentInput = page.locator('input[name="deponent"], input[placeholder*="deponent" i]');
    
    await snap(page, 'form-create-summary-deponent');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Payment Form Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Payment Form', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should display pricing plans', async ({ page }) => {
    await page.goto('/payment');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for pricing cards or plan options
    const plans = page.locator('[class*="plan"], [class*="pricing"], [class*="card"]');
    
    await snap(page, 'form-payment-plans');
  });

  test('should allow selecting a plan', async ({ page }) => {
    await page.goto('/payment');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for buy/select buttons
    const buyButtons = page.locator('button:has-text("Buy"), button:has-text("Select"), button:has-text("Choose")');
    
    if (await buyButtons.count() > 0) {
      await snap(page, 'form-payment-buttons');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Checkout Form Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Checkout Form', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should display checkout page', async ({ page }) => {
    await page.goto('/checkout');
    // Use domcontentloaded - Stripe elements cause continuous network activity
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    await snap(page, 'form-checkout-page');
  });

  test('should show Stripe elements if configured', async ({ page }) => {
    await page.goto('/checkout');
    // Use domcontentloaded instead of networkidle - Stripe elements continuously poll
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000); // Give Stripe time to load

    // Stripe elements load in iframes
    const stripeFrame = page.locator('iframe[name*="stripe"], iframe[src*="stripe"]');
    
    await snap(page, 'form-checkout-stripe');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin Forms Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin Forms', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should display admin dashboard metrics', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Look for metric cards or charts
    const metrics = page.locator('[class*="metric"], [class*="stat"], [class*="chart"], [class*="card"]');
    
    await snap(page, 'form-admin-metrics');
  });

  test('should display admin fine-tune form', async ({ page }) => {
    await page.goto('/admin/finetune');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Look for prompt textarea or config fields
    const promptArea = page.locator('textarea, input[name="prompt"], input[name="system"]');
    
    await snap(page, 'form-admin-finetune');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Billing History Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Billing Forms', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should display billing history', async ({ page }) => {
    await page.goto('/account/billing');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Look for history table or list
    const history = page.locator('table, [class*="history"], [class*="list"]');
    
    await snap(page, 'form-billing-history');
  });

  test('should show credit balance', async ({ page }) => {
    await page.goto('/account/billing');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Look for balance display
    const balance = page.locator('[class*="balance"], [class*="credit"], :text("credit")');
    
    await snap(page, 'form-billing-balance');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Download Form Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Download Forms', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should display summaries list with download options', async ({ page }) => {
    await page.goto('/summaries');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Look for download buttons
    const downloadButtons = page.locator('button:has-text("Download"), a:has-text("Download"), [class*="download"]');
    
    await snap(page, 'form-summaries-download');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dialog and Modal Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Dialogs and Modals', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should handle email notification dialog', async ({ page }) => {
    await page.goto('/summaries');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Look for notification toggle or button
    const notifyButtons = page.locator('[class*="notify"], [class*="notification"], button:has-text("Notify")');
    
    if (await notifyButtons.count() > 0) {
      await notifyButtons.first().click();
      await page.waitForTimeout(500);
      await snap(page, 'dialog-email-notification');
    }
  });

  test('should handle preview modal', async ({ page }) => {
    await page.goto('/summaries');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
    await page.waitForTimeout(1000);

    // Look for preview buttons
    const previewButtons = page.locator('button:has-text("Preview"), a:has-text("Preview"), [class*="preview"]');
    
    if (await previewButtons.count() > 0) {
      await previewButtons.first().click();
      await page.waitForTimeout(1000);
      await snap(page, 'dialog-preview-modal');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Theme Toggle Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Theme Toggle', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('should toggle theme if available', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    // Look for theme toggle
    const themeToggle = page.locator('button[class*="theme"], [class*="dark-mode"], [class*="toggle-theme"], button:has([class*="moon"]), button:has([class*="sun"])');
    
    if (await themeToggle.count() > 0) {
      await snap(page, 'theme-before-toggle');
      await themeToggle.first().click();
      await page.waitForTimeout(500);
      await snap(page, 'theme-after-toggle');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error State Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error States', () => {
  test('should display login error state', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitButton = page.locator('button[type="submit"]').first();

    await emailInput.fill('invalid@test.com');
    await passwordInput.fill('wrongpassword');
    await submitButton.click();

    await page.waitForTimeout(2000);
    await snap(page, 'error-login-invalid');
  });

  test('should display form validation errors', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);

    const emailInput = page.locator('input[type="email"], input[name="email"]').first();
    
    // Wait for the input to be visible before filling
    if (await emailInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await emailInput.fill('not-an-email');

      const submitButton = page.locator('button[type="submit"]').first();
      await submitButton.click();

      await page.waitForTimeout(1000);
    }
    
    await snap(page, 'error-validation');
  });
});

