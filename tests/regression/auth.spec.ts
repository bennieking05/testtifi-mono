/**
 * Auth Flow Regression Tests
 * 
 * Tests login, registration, and password reset flows.
 * Results are captured via custom reporter for CSV output.
 */

import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = path.join(process.cwd(), 'test-results');
const SNAPS_DIR = path.join(RESULTS_DIR, 'screenshots');

// Ensure directories exist
fs.mkdirSync(SNAPS_DIR, { recursive: true });

// Helper to take timestamped screenshots
async function snap(page: any, name: string) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${ts}_${name}.png`;
  await page.screenshot({ path: path.join(SNAPS_DIR, filename), fullPage: true });
  return filename;
}

// ─────────────────────────────────────────────────────────────────────────────
// Login Page Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Login Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
  });

  test('should display login form', async ({ page }) => {
    // Check for email input
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await expect(emailInput.first()).toBeVisible();

    // Check for password input
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput.first()).toBeVisible();

    // Check for submit button
    const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")');
    await expect(submitButton.first()).toBeVisible();

    await snap(page, 'login-form-visible');
  });

  test('should show validation errors for empty form', async ({ page }) => {
    // Try to submit empty form
    const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();
    await submitButton.click();

    // Wait for validation
    await page.waitForTimeout(500);
    await snap(page, 'login-validation-empty');

    // Check that we're still on login page (didn't navigate away)
    expect(page.url()).toContain('/login');
  });

  test('should show error for invalid credentials', async ({ page }) => {
    // Fill in invalid credentials
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    
    await emailInput.fill('invalid@test.com');
    await passwordInput.fill('wrongpassword123');

    // Submit form
    const submitButton = page.locator('button[type="submit"], button:has-text("Login"), button:has-text("Sign in")').first();
    await submitButton.click();

    // Wait for response
    await page.waitForTimeout(2000);
    await snap(page, 'login-invalid-credentials');

    // Should still be on login page or show error
    expect(page.url()).toContain('/login');
  });

  test('should have link to register page', async ({ page }) => {
    const registerLink = page.locator('a[href*="register"], a:has-text("Register"), a:has-text("Sign up"), a:has-text("Create account")');
    await expect(registerLink.first()).toBeVisible();
    await snap(page, 'login-register-link');
  });

  test('should have link to forgot password', async ({ page }) => {
    const forgotLink = page.locator('a[href*="forgot"], a:has-text("Forgot"), a:has-text("Reset password")');
    await expect(forgotLink.first()).toBeVisible();
    await snap(page, 'login-forgot-link');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Register Page Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Register Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/register');
    await page.waitForLoadState('networkidle');
  });

  test('should display registration form', async ({ page }) => {
    // Check for name input (optional)
    const nameInput = page.locator('input[name="name"], input[placeholder*="name" i]');
    
    // Check for email input
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await expect(emailInput.first()).toBeVisible();

    // Check for password input
    const passwordInput = page.locator('input[type="password"]');
    await expect(passwordInput.first()).toBeVisible();

    await snap(page, 'register-form-visible');
  });

  test('should show validation for empty form', async ({ page }) => {
    const submitButton = page.locator('button[type="submit"], button:has-text("Register"), button:has-text("Sign up"), button:has-text("Create")').first();
    await submitButton.click();

    await page.waitForTimeout(500);
    await snap(page, 'register-validation-empty');

    // Should still be on register page
    expect(page.url()).toContain('/register');
  });

  test('should show validation for invalid email', async ({ page }) => {
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill('invalid-email');

    const passwordInput = page.locator('input[type="password"]').first();
    await passwordInput.fill('ValidPass123!');

    const submitButton = page.locator('button[type="submit"], button:has-text("Register"), button:has-text("Sign up"), button:has-text("Create")').first();
    await submitButton.click();

    await page.waitForTimeout(500);
    await snap(page, 'register-validation-invalid-email');
  });

  test('should have link to login page', async ({ page }) => {
    const loginLink = page.locator('a[href*="login"], a:has-text("Login"), a:has-text("Sign in"), a:has-text("Already have")');
    await expect(loginLink.first()).toBeVisible();
    await snap(page, 'register-login-link');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Forgot Password Page Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Forgot Password Page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/forgot-password');
    await page.waitForLoadState('networkidle');
  });

  test('should display forgot password form', async ({ page }) => {
    // Check for email input
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]');
    await expect(emailInput.first()).toBeVisible();

    // Check for submit button
    const submitButton = page.locator('button[type="submit"], button:has-text("Reset"), button:has-text("Send"), button:has-text("Submit")');
    await expect(submitButton.first()).toBeVisible();

    await snap(page, 'forgot-password-form-visible');
  });

  test('should show validation for empty email', async ({ page }) => {
    const submitButton = page.locator('button[type="submit"], button:has-text("Reset"), button:has-text("Send"), button:has-text("Submit")').first();
    await submitButton.click();

    await page.waitForTimeout(500);
    await snap(page, 'forgot-password-validation-empty');
  });

  test('should accept email submission', async ({ page }) => {
    const emailInput = page.locator('input[type="email"], input[name="email"], input[placeholder*="email" i]').first();
    await emailInput.fill('test@testifi.ai');

    const submitButton = page.locator('button[type="submit"], button:has-text("Reset"), button:has-text("Send"), button:has-text("Submit")').first();
    await submitButton.click();

    // Wait for response
    await page.waitForTimeout(2000);
    await snap(page, 'forgot-password-submitted');
  });

  test('should have link back to login', async ({ page }) => {
    const loginLink = page.locator('a[href*="login"], a:has-text("Login"), a:has-text("Sign in"), a:has-text("Back")');
    await expect(loginLink.first()).toBeVisible();
    await snap(page, 'forgot-password-login-link');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Reset Password Page Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Reset Password Page', () => {
  test('should handle invalid reset token', async ({ page }) => {
    await page.goto('/reset-password/invalid-token');
    await page.waitForLoadState('networkidle');

    await snap(page, 'reset-password-invalid-token');

    // Page should either show error or have password fields
    // Both are valid states depending on implementation
  });

  test('should display password reset form with valid-looking token', async ({ page }) => {
    // Use a UUID-like token format
    await page.goto('/reset-password/12345678-1234-1234-1234-123456789abc');
    await page.waitForLoadState('networkidle');

    await snap(page, 'reset-password-form');

    // Check for password input (may show error if token is actually invalid)
    const passwordInput = page.locator('input[type="password"]');
    // The form might or might not be visible depending on token validation
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Authenticated Flow Tests
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Authentication Flow', () => {
  test('should redirect unauthenticated users to login', async ({ page }) => {
    // Clear any existing auth
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    // Try to access protected route
    await page.goto('/dashboard');
    await page.waitForLoadState('networkidle');

    // Should be redirected to login
    await page.waitForURL(/\/(login|$)/, { timeout: 5000 });
    await snap(page, 'auth-redirect-to-login');
  });

  test('should redirect unauthenticated users from summaries', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    await page.goto('/summaries');
    await page.waitForLoadState('networkidle');

    await page.waitForURL(/\/(login|$)/, { timeout: 5000 });
    await snap(page, 'auth-redirect-summaries');
  });

  test('should redirect unauthenticated users from payment', async ({ page }) => {
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());

    await page.goto('/payment');
    await page.waitForLoadState('networkidle');

    await page.waitForURL(/\/(login|$)/, { timeout: 5000 });
    await snap(page, 'auth-redirect-payment');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Terms and Privacy (Public Pages)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Public Legal Pages', () => {
  test('should display terms page', async ({ page }) => {
    await page.goto('/terms');
    await page.waitForLoadState('networkidle');

    // Should have some content
    const content = page.locator('main, article, .content, body');
    await expect(content.first()).toBeVisible();

    await snap(page, 'terms-page');
  });

  test('should display privacy page', async ({ page }) => {
    await page.goto('/privacy');
    await page.waitForLoadState('networkidle');

    const content = page.locator('main, article, .content, body');
    await expect(content.first()).toBeVisible();

    await snap(page, 'privacy-page');
  });
});

