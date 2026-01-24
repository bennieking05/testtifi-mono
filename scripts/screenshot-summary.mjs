import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1200 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);

  await page.goto('http://localhost:3000/login', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);

  await page.fill('input[type="email"]', 'test@testifi.ai');
  await page.fill('input[type="password"]', 'TestPass123!');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2000);

  await page.goto('http://localhost:3000/summaries', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Scroll down on the page first
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(500);

  // Click Preview button using JavaScript
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const previewBtn = buttons.find(b => b.textContent.includes('Preview'));
    if (previewBtn) previewBtn.click();
  });
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: 'test-results/preview-1.png', fullPage: true });
  console.log('Saved: preview-1.png');

  // Scroll dialog content
  await page.evaluate(() => {
    const scrollables = document.querySelectorAll('[role="dialog"] .overflow-auto, [role="dialog"] .overflow-y-auto, [role="dialog"] > div');
    scrollables.forEach(el => el.scrollBy(0, 500));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/preview-2.png', fullPage: true });
  console.log('Saved: preview-2.png');

  await page.evaluate(() => {
    const scrollables = document.querySelectorAll('[role="dialog"] .overflow-auto, [role="dialog"] .overflow-y-auto, [role="dialog"] > div');
    scrollables.forEach(el => el.scrollBy(0, 500));
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/preview-3.png', fullPage: true });
  console.log('Saved: preview-3.png');

  await browser.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
