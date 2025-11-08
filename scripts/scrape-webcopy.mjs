import fs from 'fs';
import { chromium } from 'playwright';

const BASE = process.env.WEB_BASE_URL || 'http://localhost:3000';
const OUT = process.env.WEB_COPY_PATH || '/Users/bennieking/Sites/testifiAi/webCopy.md';

const ROUTES = [
  '/',
  '/login',
  '/register',
  '/forgot-password',
  '/privacy',
  '/terms',
  '/help',
  '/dashboard',
  '/summaries',
  '/create-summary',
  '/payment',
  '/checkout',
  '/case-preparation',
  '/ai-insights',
  '/collaboration',
  '/support',
  '/admin',
  '/admin/finetune',
];

function header(route){
  return `\n\n/` + route.replace(/^\//,'') + ` - copy\n`;
}

function dedupe(lines){
  const seen = new Set();
  const out = [];
  for (const l of lines){
    const k = l.toLowerCase();
    if (k.length < 2 || seen.has(k)) continue;
    seen.add(k);
    out.push(l);
  }
  return out;
}

async function collectVisibleText(page){
  return await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const lines = [];
    let n;
    while ((n = walker.nextNode())){
      const t = (n.textContent || '').replace(/\s+/g,' ').trim();
      if (t.length > 1) lines.push(t);
    }
    return lines;
  });
}

function fakeJwt(){
  const exp = Math.floor(Date.now()/1000) + 60*60*24; // +1 day
  const header = Buffer.from(JSON.stringify({ alg:'none', typ:'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub:'mock', exp })).toString('base64url');
  return `${header}.${payload}.`;
}

async function main(){
  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addInitScript(({ token }) => {
    try {
      localStorage.setItem('token', token);
      localStorage.setItem('refreshToken', token);
    } catch {}
  }, { token: fakeJwt() });

  const page = await context.newPage();
  let appended = 0;

  for (const route of ROUTES){
    const url = BASE + route;
    try {
      console.log('Visiting', url);
      const resp = await page.goto(url, { waitUntil: 'load', timeout: 15000 });
      if (!resp) throw new Error('No response');
      // give client a moment to render
      await page.waitForTimeout(500);
      const lines = dedupe(await collectVisibleText(page));
      const block = header(route) + lines.map(l=>`- ${l}`).join('\n') + '\n';
      fs.appendFileSync(OUT, block);
      console.log(`  ✔ ${route}: wrote ${lines.length} lines`);
      appended += lines.length;
    } catch (e){
      console.log(`  ✖ ${route}: ${e.message}`);
    }
  }

  await browser.close();
  console.log(`Done. Appended ${appended} lines to ${OUT}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });


