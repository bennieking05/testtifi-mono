/**
 * Screenshot Evidence Utilities
 *
 * Provides deterministic screenshot capture for regression evidence.
 * Screenshots are saved to:
 *   tests/regression-screenshots/<FEATURE_NAME>/<EVIDENCE_TS>/
 *
 * Control via env vars:
 *   FEATURE_NAME  - folder name for the feature/branch (default: "default")
 *   EVIDENCE_TS   - timestamp subfolder (default: ISO timestamp at import time)
 */

import { Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const FEATURE = process.env.FEATURE_NAME || 'default';
const TS = process.env.EVIDENCE_TS || new Date().toISOString().replace(/[:.]/g, '-');

const EVIDENCE_DIR = path.join(ROOT, 'tests', 'regression-screenshots', FEATURE, TS);

let screenshotCount = 0;

export function getEvidenceDir(): string {
  return EVIDENCE_DIR;
}

export function getScreenshotCount(): number {
  return screenshotCount;
}

export function getTimestamp(): string {
  return TS;
}

/**
 * Capture a deterministic evidence screenshot.
 *
 * @param page      - Playwright Page
 * @param index     - numeric index (zero-padded to 2 digits)
 * @param name      - short kebab-case name (e.g. "login", "dashboard")
 * @param viewport  - "desktop" | "mobile"
 */
export async function evidenceScreenshot(
  page: Page,
  index: number,
  name: string,
  viewport: 'desktop' | 'mobile',
): Promise<string> {
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const padded = String(index).padStart(2, '0');
  const filename = `${padded}-${name}-${viewport}.png`;
  const filepath = path.join(EVIDENCE_DIR, filename);

  await page.screenshot({ path: filepath, fullPage: false, timeout: 5000 });
  screenshotCount++;

  return filepath;
}

/** Desktop viewport dimensions */
export const DESKTOP_VIEWPORT = { width: 1280, height: 720 };

/** Mobile viewport dimensions (iPhone SE-ish) */
export const MOBILE_VIEWPORT = { width: 375, height: 667 };
