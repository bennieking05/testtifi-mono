import fs from 'fs';
import path from 'path';
import process from 'process';
import PDFDocument from 'pdfkit';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';

function usage() {
  console.error('Usage: node scripts/generate-local-summary.mjs <input.pdf> <output.pdf>');
  process.exit(2);
}

const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) usage();
if (!fs.existsSync(inPath)) {
  console.error(`Input file not found: ${inPath}`);
  process.exit(1);
}

async function extractWithPdfJs(buf) {
  const data = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const loadingTask = pdfjs.getDocument({ data, useSystemFonts: true, isEvalSupported: false });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  let text = '';
  for (let i = 1; i <= numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it) => ('str' in it ? it.str : '')).filter(Boolean);
    text += `\nPage ${i}\n` + strings.join(' ') + '\n';
  }
  return { text, numPages };
}

async function extractText(inputBuf) {
  const out = await extractWithPdfJs(inputBuf);
  return { text: out.text, pages: out.numPages };
}

function extractDates(text) {
  const re = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/g;
  return Array.from(new Set(text.match(re) || [])).slice(0, 5);
}

function extractNames(text) {
  const re = /\b([A-Z][a-z]+\s+[A-Z][a-z]+)(?:\s+[A-Z][a-z]+)?\b/g;
  const map = new Map();
  let m;
  while ((m = re.exec(text))) {
    const n = m[1].trim();
    const bad = /^(Page|United States|Superior Court|Circuit Court|Case No|Deposition|Exhibit)$/i;
    if (bad.test(n)) continue;
    map.set(n, (map.get(n) || 0) + 1);
  }
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([k])=>k);
}

function splitByPages(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let page = 1;
  let buf = [];
  const marker = /^\s*(?:Page\s*)?(\d{1,5})\s*$/i;
  const flush = () => { if (buf.length) out.push({ page, text: buf.join('\n') }); buf = []; };
  for (const raw of lines) {
    const m = raw.trim().match(marker);
    if (m) { flush(); page = parseInt(m[1],10) || page + 1; continue; }
    buf.push(raw);
  }
  flush();
  return out;
}

function sentenceChunks(str, maxLen = 280) {
  const sentences = str.replace(/\s+/g,' ').split(/(?<=[\.!?])\s+/);
  const out = [];
  for (const s of sentences) {
    if (s.length < 40) continue;
    out.push(s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s);
    if (out.length >= 2) break;
  }
  return out;
}

(async () => {
  const inputBuf = fs.readFileSync(inPath);
  const { text, pages: parsedPages } = await extractText(inputBuf);
  const pages = parsedPages || splitByPages(text).length;

  const names = extractNames(text);
  const dates = extractDates(text);
  const byPage = splitByPages(text);

  const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
  const outStream = fs.createWriteStream(outPath);
  doc.pipe(outStream);

  const title = 'Deposition Summary - Richard S. Sackler (Toya W. Draft)';

  // Cover
  doc.font('Times-Bold').fontSize(22).text(title, { align: 'center' });
  doc.moveDown();
  doc.font('Times-Roman').fontSize(12).text(`Source: ${path.basename(inPath)}`, { align: 'center' });
  doc.text(`Pages: ${pages}`, { align: 'center' });
  if (dates.length) doc.text(`Detected Dates: ${dates.join(' • ')}`, { align: 'center' });
  doc.moveDown(0.5);
  if (names.length) doc.text(`Top Names: ${names.join(', ')}`, { align: 'center' });
  doc.addPage();

  // Metadata section
  doc.font('Times-Bold').fontSize(14).text('Case Metadata');
  doc.moveDown(0.25);
  doc.font('Times-Roman').fontSize(12);
  if (dates[0]) doc.text(`Date of Deposition: ${dates[0]}`);
  if (names[0]) doc.text(`Deponent: ${names[0]}`);
  doc.moveDown();

  // Table-like summary
  doc.font('Times-Bold').fontSize(14).text('Detailed Testimony');
  doc.moveDown(0.5);
  const leftX = doc.x;
  const pageColW = 80; const gap = 10; const sumColW = doc.page.width - doc.page.margins.left - doc.page.margins.right - pageColW - gap;

  const maxRows = 100; // cap output
  let rows = 0;
  for (const seg of byPage) {
    if (rows >= maxRows) break;
    const chunks = sentenceChunks(seg.text, 360);
    if (chunks.length === 0) continue;

    // draw row
    const startY = doc.y + 6;
    doc.font('Times-Bold').fontSize(11).text(`p.${seg.page}`, leftX, startY, { width: pageColW });
    doc.font('Times-Roman').fontSize(11).text(chunks.join(' '), leftX + pageColW + gap, startY, { width: sumColW });

    // row separator
    doc.moveTo(leftX, doc.y + 4).lineTo(leftX + pageColW + gap + sumColW, doc.y + 4).strokeColor('#e0e0e0').stroke();

    // paginate if near end
    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
      doc.addPage();
    }
    rows++;
  }

  doc.end();
  await new Promise((resolve) => outStream.on('finish', resolve));
  console.log(`Wrote PDF: ${outPath}`);
})();
