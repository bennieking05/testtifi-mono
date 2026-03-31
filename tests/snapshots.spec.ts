import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const ART_DIR = path.join(process.cwd(), 'artifacts');
const SNAP_DIR = path.join(ART_DIR, 'snaps');

test.beforeAll(async () => {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
});

test.use({
  contextOptions: { recordHar: { path: path.join(ART_DIR, 'network.har'), mode: 'minimal' } },
});

test('snap on nav & clicks; log console + network', async ({ page, context }) => {
  await page.context().tracing.start({ screenshots: true, snapshots: true });

  // Console capture
  page.on('console', msg => {
    const line = `[${new Date().toISOString()}][console:${msg.type()}] ${msg.text()}\n`;
    fs.appendFileSync(path.join(ART_DIR, 'console.log'), line);
  });

  // Network breadcrumbs
  context.on('request', req => {
    const line = `[${new Date().toISOString()}][request] ${req.method()} ${req.url()}\n`;
    fs.appendFileSync(path.join(ART_DIR, 'network.log'), line);
  });
  context.on('response', res => {
    const line = `[${new Date().toISOString()}][response] ${res.status()} ${res.url()}\n`;
    fs.appendFileSync(path.join(ART_DIR, 'network.log'), line);
  });

  const snap = async (tag: string) => {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    await page.screenshot({ path: path.join(SNAP_DIR, `${ts}_${tag}.png`), fullPage: false, timeout: 5000 });
  };

  await page.goto('/', { waitUntil: 'networkidle' });
  await snap('home-loaded');

  // Try a few obvious nav targets
  const candidates = page.locator('a[href], button, [role="button"]');
  const count = await candidates.count();
  for (let i = 0, taken = 0; i < count && taken < 8; i++) {
    const el = candidates.nth(i);
    const text = (await el.innerText().catch(() => 'elem')).trim().replace(/\s+/g, '_').slice(0, 24) || `elem-${i}`;
    try {
      await el.click({ trial: false, force: false });
      await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
      await snap(`after-click-${taken}-${text}`);
      taken++;
    } catch {
      // ignore non-clickables
    }
  }

  await page.context().tracing.stop({ path: path.join(ART_DIR, 'trace.zip') });
});

