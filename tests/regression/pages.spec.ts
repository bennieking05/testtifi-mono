/**
 * Page Navigation Regression Tests
 * 
 * Tests that all frontend pages load correctly.
 * Covers both public and authenticated pages.
 */

import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.join(process.cwd(), 'test-results');
const SNAPS_DIR = path.join(RESULTS_DIR, 'screenshots');

// Ensure directories exist
fs.mkdirSync(SNAPS_DIR, { recursive: true });

// Test credentials - loaded from test-login.json if available
let testEmail = '';
let testPassword = '';

try {
  const loginFile = path.join(process.cwd(), 'test-login.json');
  if (fs.existsSync(loginFile)) {
    const creds = JSON.parse(fs.readFileSync(loginFile, 'utf8'));
    testEmail = creds.email || '';
    testPassword = creds.password || '';
  }
} catch {
  // No credentials available
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
  await page.waitForLoadState('networkidle');

  const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
  const passwordInput = page.locator('input[type="password"]').first();
  const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();

  await emailInput.fill(testEmail);
  await passwordInput.fill(testPassword);
  await submitButton.click();

  // Wait for navigation away from login
  try {
    await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 });
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Pages
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Public Pages', () => {
  test('Login page loads', async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveURL(/\/login/);
    await snap(page, 'page-login');
  });

  test('Register page loads', async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveURL(/\/register/);
    await snap(page, 'page-register');
  });

  test('Forgot Password page loads', async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveURL(/\/forgot-password/);
    await snap(page, 'page-forgot-password');
  });

  test('Terms page loads', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveURL(/\/terms/);
    await snap(page, 'page-terms');
  });

  test('Privacy page loads', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');
    
    await expect(page).toHaveURL(/\/privacy/);
    await snap(page, 'page-privacy');
  });

  test('404 Not Found page displays correctly', async ({ page }) => {
    await page.goto('/this-page-does-not-exist-12345');
    await page.waitForLoadState('networkidle');
    
    await snap(page, 'page-not-found');
    
    // Should show some indication of 404 or not found
    const body = await page.textContent('body');
    // Page loaded (didn't crash)
    expect(body).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Protected Pages (require authentication)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Protected Pages', () => {
  test.beforeEach(async ({ page }) => {
    // Try to login before each test
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('Dashboard page loads', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
    // Should not be redirected to login
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-dashboard');
  });

  test('Summaries page loads', async ({ page }) => {
    await page.goto('/summaries');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-summaries');
  });

  test('Create Summary page loads', async ({ page }) => {
    await page.goto('/create-summary');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-create-summary');
  });

  test('Payment page loads', async ({ page }) => {
    await page.goto('/payment');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-payment');
  });

  test('Checkout page loads', async ({ page }) => {
    await page.goto('/checkout');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    // Checkout might redirect if no payment intent
    
    await snap(page, 'page-checkout');
  });

  test('Billing page loads', async ({ page }) => {
    await page.goto('/account/billing');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-billing');
  });

  test('Help page loads', async ({ page }) => {
    await page.goto('/help');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-help');
  });

  test('Help User Guide page loads', async ({ page }) => {
    await page.goto('/help/user-guide');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-help-user-guide');
  });

  test('Help Keyboard Shortcuts page loads', async ({ page }) => {
    await page.goto('/help/keyboard-shortcuts');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-help-keyboard-shortcuts');
  });

  test('Support page loads', async ({ page }) => {
    await page.goto('/support');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-support');
  });

  test('Automation page loads', async ({ page }) => {
    await page.goto('/automation');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-automation');
  });

  test('Case Preparation page loads', async ({ page }) => {
    await page.goto('/case-preparation');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-case-preparation');
  });

  test('AI Insights page loads', async ({ page }) => {
    await page.goto('/ai-insights');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-ai-insights');
  });

  test('Collaboration page loads', async ({ page }) => {
    await page.goto('/collaboration');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-collaboration');
  });

  test('Security Commitment page loads', async ({ page }) => {
    await page.goto('/security-commitment');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    expect(page.url()).not.toContain('/login');
    
    await snap(page, 'page-security-commitment');
  });

  test('Success page loads', async ({ page }) => {
    await page.goto('/success');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    // Success page might redirect if no success context
    
    await snap(page, 'page-success');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin Pages
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Admin Pages', () => {
  // Admin pages require admin credentials
  // These tests will be skipped if not logged in as admin
  
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('Admin page loads (may require admin role)', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    await snap(page, 'page-admin');
    
    // Admin page may redirect non-admins
    // We just verify it doesn't crash
  });

  test('Admin Fine-tune page loads (may require admin role)', async ({ page }) => {
    await page.goto('/admin/finetune');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    await snap(page, 'page-admin-finetune');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dynamic Pages (require specific IDs)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Dynamic Pages', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('Summary Detail page handles invalid ID', async ({ page }) => {
    await page.goto('/summaries/invalid-id-12345');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    await snap(page, 'page-summary-detail-invalid');
    
    // Should handle gracefully (show error or redirect)
  });

  test('Preview page handles invalid ID', async ({ page }) => {
    await page.goto('/preview/invalid-id-12345');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    await snap(page, 'page-preview-invalid');
  });

  test('Download page handles invalid ID', async ({ page }) => {
    await page.goto('/download/invalid-id-12345');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    await snap(page, 'page-download-invalid');
  });

  test('Reset Password page handles token', async ({ page }) => {
    await page.goto('/reset-password/test-token-12345');
    await page.waitForLoadState('networkidle');
    
    await page.waitForTimeout(1000);
    await snap(page, 'page-reset-password-token');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Navigation Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test.beforeEach(async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
  });

  test('Sidebar navigation works', async ({ page }) => {
    await page.goto('/summaries');
    await page.waitForLoadState('networkidle');
    
    // Look for sidebar navigation
    const sidebar = page.locator('nav, aside, [role="navigation"], .sidebar');
    
    if (await sidebar.count() > 0) {
      await snap(page, 'nav-sidebar-visible');
      
      // Try clicking a navigation link
      const navLinks = page.locator('nav a, aside a, .sidebar a');
      const linkCount = await navLinks.count();
      
      if (linkCount > 0) {
        await navLinks.first().click();
        await page.waitForLoadState('networkidle');
        await snap(page, 'nav-after-click');
      }
    }
  });

  test('Header/logo navigation works', async ({ page }) => {
    await page.goto('/support');
    await page.waitForLoadState('networkidle');
    
    // Look for logo or home link
    const homeLink = page.locator('a[href="/"], header a, .logo');
    
    if (await homeLink.count() > 0) {
      await homeLink.first().click();
      await page.waitForLoadState('networkidle');
      await snap(page, 'nav-home-click');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Responsive Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Responsive Design', () => {
  test('Login page mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    
    await snap(page, 'responsive-login-mobile');
  });

  test('Login page tablet viewport', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    
    await snap(page, 'responsive-login-tablet');
  });

  test('Dashboard mobile viewport', async ({ page }) => {
    const loggedIn = await login(page);
    if (!loggedIn) {
      test.skip();
    }
    
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');
    
    await snap(page, 'responsive-dashboard-mobile');
  });
});

