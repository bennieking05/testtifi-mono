import fs from 'fs';
import path from 'path';
import process from 'process';
import { createRequire } from 'module';

// Resolve backend dependencies
const backendPkgJson = path.resolve(process.cwd(), 'backend/package.json');
const requireFromBackend = createRequire(backendPkgJson);
const PDFDocument = requireFromBackend('pdfkit');
const { Document, Packer, Paragraph, Table, TableRow, TableCell, WidthType, TextRun, ImageRun, BorderStyle } = requireFromBackend('docx');

function loadLogoCandidates() {
  const candidates = [
    process.env.LIGHT_LOGO_PATH,
    process.env.LOGO_PATH,
    path.resolve(process.cwd(), 'backend/og-image.png'),
    path.resolve(process.cwd(), 'og-image.png'),
    path.resolve(process.cwd(), 'loveable/public/testifi_light_logo.png'),
    path.resolve(process.cwd(), 'loveable/public/testifi_dark_logo.png'),
    path.resolve(process.cwd(), 'public/testifi_light_logo.png'),
    path.resolve(process.cwd(), 'public/testifi_dark_logo.png'),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const buf = fs.readFileSync(p);
        let width, height, mime = 'image/png';
        if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50) {
          width = buf.readUInt32BE(16);
          height = buf.readUInt32BE(20);
        } else if (buf[0] === 0xff && buf[1] === 0xd8) {
          mime = 'image/jpeg';
        }
        return { buf, mime, width, height };
      }
    } catch {}
  }
  return null;
}

function nowStamp() {
  const d = new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}

async function generatePdf(outPath, title, metaLines, rows) {
  const pdf = new PDFDocument({ margin: 40, size: 'LETTER' });
  const out = fs.createWriteStream(outPath);
  pdf.pipe(out);

  const lm = pdf.page.margins.left;
  const rm = pdf.page.margins.right;
  const full = pdf.page.width - lm - rm;
  const gap = 0;
  const pageCol = 100;
  const sumCol = full - pageCol - gap;

  // Cover centered
  try {
    const pageH = pdf.page.height;
    const top = pdf.page.margins.top;
    const bottom = pdf.page.margins.bottom;
    const usableH = pageH - top - bottom;
    const logo = loadLogoCandidates();
    let contentH = 0, logoH = 0;
    const targetW = Math.min(260, full);
    if (logo) {
      if (logo.width && logo.height) {
        const scale = targetW / logo.width;
        logoH = logo.height * scale;
      } else {
        logoH = targetW * 0.33;
      }
      contentH += logoH + 16;
    }
    const lineOpts = { width: full, align: 'center' };
    pdf.font('Times-Bold').fontSize(22);
    contentH += pdf.heightOfString(title, lineOpts) + 6;
    pdf.font('Times-Roman').fontSize(12);
    const dateLine = `Date: ${new Date().toLocaleDateString()}`;
    contentH += pdf.heightOfString(dateLine, lineOpts) + 2;

    const startY = top + Math.max(0, (usableH - contentH) / 2);
    pdf.y = startY;
    if (logo) {
      const x = lm + (full - targetW) / 2;
      pdf.image(logo.buf, x, pdf.y, { width: targetW });
      pdf.y += logoH + 16;
    }
    pdf.font('Times-Bold').fontSize(22).text(title, { align: 'center' });
    pdf.moveDown(0.25);
    pdf.font('Times-Roman').fontSize(12).text(dateLine, { align: 'center' });
  } catch {}

  // New page
  pdf.addPage();

  // Metadata
  pdf.font('Times-Roman').fontSize(12);
  metaLines.forEach((l) => pdf.text(l));
  pdf.moveDown(0.5);

  // Enclosed table
  const pad = 6;
  let y = pdf.y + 18;
  const tableLeft = lm;
  const col1Left = tableLeft + pad;
  const col2Left = tableLeft + pageCol + gap + pad;

  // Header band
  pdf.font('Times-Bold').fontSize(12);
  const headerH = Math.max(
    pdf.heightOfString('Page(s)', { width: pageCol - 2 * pad }),
    pdf.heightOfString('Testimony Summary', { width: sumCol - 2 * pad })
  ) + pad * 2;
  const tableTop = y;
  pdf.save();
  pdf.lineWidth(0.5).strokeColor('#bdbdbd').fillColor('#f1f5f9');
  pdf.rect(tableLeft, y, full, headerH).fillAndStroke('#f1f5f9', '#bdbdbd');
  pdf.restore();
  pdf.fillColor('#000');
  pdf.text('Page(s)', col1Left, y + pad, { width: pageCol - 2 * pad });
  pdf.text('Testimony Summary', col2Left, y + pad, { width: sumCol - 2 * pad });
  y += headerH;

  // Rows
  rows.forEach(([p, s]) => {
    pdf.font('Times-Roman').fontSize(11);
    const h1 = pdf.heightOfString(p, { width: pageCol - 2 * pad });
    const h2 = pdf.heightOfString(s, { width: sumCol - 2 * pad });
    const rowH = Math.max(h1, h2) + pad * 2;
    pdf.lineWidth(0.5).strokeColor('#e0e0e0');
    pdf.rect(tableLeft, y, full, rowH).stroke();
    pdf.fillColor('#000');
    pdf.text(p, col1Left, y + pad, { width: pageCol - 2 * pad });
    pdf.text(s, col2Left, y + pad, { width: sumCol - 2 * pad });
    y += rowH;
  });
  pdf.lineWidth(0.75).strokeColor('#bdbdbd');
  pdf.rect(tableLeft, tableTop, full, y - tableTop).stroke();

  pdf.end();
  await new Promise((resolve) => out.on('finish', resolve));
}

async function generateDocx(outPath, title, metaLines, rows) {
  const logo = loadLogoCandidates();
  const logoMaxWidth = 400;
  let logoRun = null;
  if (logo) {
    let w = 0, h = 0;
    if (logo.width && logo.height) {
      const scale = Math.min(1, logoMaxWidth / logo.width);
      w = Math.round(logo.width * scale);
      h = Math.round(logo.height * scale);
    } else {
      w = logoMaxWidth; h = Math.round(logoMaxWidth * 0.33);
    }
    const docxType = logo.mime.includes('png') ? 'png' : (logo.mime.includes('jpeg') || logo.mime.includes('jpg')) ? 'jpg' : 'png';
    logoRun = new ImageRun({ type: docxType, data: logo.buf, transformation: { width: w, height: h } });
  }
  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: 'Times New Roman', size: 24 },
          paragraph: { spacing: { after: 160 } },
        },
        heading1: { run: { size: 36, bold: true } },
      },
    },
    sections: [
      {
        children: [
          new Paragraph({ children: [], spacing: { before: 2400 } }),
          ...(logoRun ? [ new Paragraph({ children: [logoRun], alignment: 'center' }) ] : []),
          new Paragraph({ text: title, alignment: 'center', heading: 'Heading1' }),
          new Paragraph({ text: `Date: ${new Date().toLocaleDateString()}`, alignment: 'center' }),
          new Paragraph({ children: [], pageBreakBefore: true }),
          ...metaLines.map((m) => new Paragraph(m)),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: 'C0C0C0' },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: 'C0C0C0' },
              left: { style: BorderStyle.SINGLE, size: 1, color: 'C0C0C0' },
              right: { style: BorderStyle.SINGLE, size: 1, color: 'C0C0C0' },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
              insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E0E0E0' },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [ new Paragraph({ children: [ new TextRun({ text: 'Page(s)', bold: true }) ] }) ] }),
                  new TableCell({ width: { size: 80, type: WidthType.PERCENTAGE }, children: [ new Paragraph({ children: [ new TextRun({ text: 'Testimony Summary', bold: true }) ] }) ] }),
                ],
              }),
              ...rows.map(([p, s]) => new TableRow({
                children: [
                  new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [ new Paragraph(p) ] }),
                  new TableCell({ width: { size: 80, type: WidthType.PERCENTAGE }, children: [ new Paragraph(s) ] }),
                ],
              })),
            ],
          }),
        ],
      },
    ],
  });
  const buf = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buf);
}

(async () => {
  const title = process.argv[2] || 'Demo Deposition Title';
  const outDir = path.resolve(process.cwd(), 'artifacts');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const stamp = nowStamp();
  const base = title.replace(/[^a-z0-9_.-]+/gi,'-');
  const pdfOut = path.join(outDir, `${base}-${stamp}.pdf`);
  const docxOut = path.join(outDir, `${base}-${stamp}.docx`);

  const meta = [
    'Case Caption: Example Corp. v. Demonstration LLC',
    'Title of Document: Transcript Summary of Jane Doe',
    `Date of Deposition: ${new Date().toLocaleDateString()}`,
  ];
  const rows = [
    ['p.1', 'Counsel identifies exhibits and swears in the witness. Basic background.'],
    ['p.2', 'Witness discusses role and responsibilities; timestamps and names captured.'],
    ['p.3', 'Questions on Exhibit 1; objections raised and noted by counsel.'],
  ];

  await generatePdf(pdfOut, title, meta, rows);
  await generateDocx(docxOut, title, meta, rows);
  console.log('Generated files:\n' + pdfOut + '\n' + docxOut);
})();
