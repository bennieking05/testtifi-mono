// ─── src/utils/generateDocuments.ts ────────────────────────────────────────
// Utility functions to generate DOCX and PDF documents for email attachments

import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  WidthType,
  TextRun,
  ImageRun,
  BorderStyle,
} from "docx";
import PDFDocument from "pdfkit";
import { loadLogo } from "./logo";

interface JobData {
  id: string;
  fileName: string | null;
  createdAt: Date;
  file?: {
    title?: string | null;
    deponent?: string | null;
    pages?: string | null;
  } | null;
}

interface DocumentData {
  meta: string[];
  rows: Array<[string, string]>;
}

/**
 * Generate DOCX buffer from summary data
 */
export async function generateDocxBuffer(
  job: JobData,
  documentData: DocumentData,
  _summaryContent: string
): Promise<Buffer> {
  const { meta, rows } = documentData;
  const uploadedTitle = job.file?.title || job.fileName?.replace(/\.[^.]+$/, "") || "summary";
  const sourceFileName = job.fileName || "Unknown Source";
  const coverTitle = uploadedTitle;

  // Extract deponent name
  let deponentName = job.file?.deponent || "Not Specified";
  const titleLike = meta.find((l) => /transcript\s+summary\s+of\s+/i.test(l));
  if (titleLike) {
    const m1 = titleLike.match(/transcript\s+summary\s+of\s+(.+)/i);
    if (m1 && !m1[1].includes("[Unknown]")) {
      deponentName = m1[1].trim();
    } else if (job.file?.deponent) {
      deponentName = job.file.deponent;
    }
  }

  // Extract deposition date
  let depositionDate: string | null = null;
  const dateLine = meta.find((l) => /date\s+of\s+deposition\s*:/i.test(l));
  if (dateLine && !dateLine.includes("[Unknown]")) {
    const mDate = dateLine.match(/date\s+of\s+deposition\s*:\s*(.+)/i);
    if (mDate) depositionDate = mDate[1].trim();
  }

  // Construct title
  let titleOfDocument = `Transcript Summary of ${deponentName}`;

  const logo = loadLogo();
  const logoMaxWidth = 400;
  let logoRun: ImageRun | null = null;
  if (logo) {
    let w = 0;
    let h = 0;
    if (logo.width && logo.height) {
      const scale = Math.min(1, logoMaxWidth / logo.width);
      w = Math.round(logo.width * scale);
      h = Math.round(logo.height * scale);
    } else {
      w = logoMaxWidth;
      h = Math.round(logoMaxWidth * 0.33);
    }
    const docxType = logo.mime.includes("png")
      ? "png"
      : logo.mime.includes("jpeg") || logo.mime.includes("jpg")
      ? "jpg"
      : ("png" as const);
    logoRun = new ImageRun({
      type: docxType,
      data: logo.buf,
      transformation: { width: w, height: h },
    });
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Times New Roman", size: 24 },
          paragraph: { spacing: { after: 160 } },
        },
        heading1: { run: { size: 36, bold: true } },
      },
    },
    sections: [
      {
        children: [
          new Paragraph({ children: [], spacing: { before: 2400 } }),
          ...(logoRun
            ? [
                new Paragraph({
                  children: [logoRun],
                  alignment: "center",
                }),
              ]
            : []),
          new Paragraph({
            text: titleOfDocument || "DEPOSITION SUMMARY",
            alignment: "center",
            heading: "Heading1",
          }),
          new Paragraph({ children: [], spacing: { before: 120 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Deponent:", bold: true }),
              new TextRun(` ${deponentName}`),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Case Title:", bold: true }),
              new TextRun(` ${coverTitle}`),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Source File:", bold: true }),
              new TextRun(` ${sourceFileName}`),
            ],
            alignment: "left",
          }),
          ...(job.file?.pages
            ? [
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [
                    new TextRun({ text: "Pages:", bold: true }),
                    new TextRun(` ${job.file.pages}`),
                  ],
                  alignment: "left",
                }),
              ]
            : []),
          new Paragraph({ children: [], spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Date:", bold: true }),
              new TextRun(
                ` ${depositionDate || new Date(job.createdAt || new Date()).toLocaleDateString()}`
              ),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Upload Date:", bold: true }),
              new TextRun(` ${new Date(job.createdAt || new Date()).toLocaleDateString()}`),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Download Date:", bold: true }),
              new TextRun(` ${new Date().toLocaleDateString()}`),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], pageBreakBefore: true }),
          ...(() => {
            const paras: Paragraph[] = [];
            if (depositionDate) {
              paras.push(new Paragraph(`Date of Deposition: ${depositionDate}`));
            }
            return paras;
          })(),
          new Paragraph({ children: [], spacing: { before: 160 } }),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 2, color: "A0A0A0" },
              bottom: { style: BorderStyle.SINGLE, size: 2, color: "A0A0A0" },
              left: { style: BorderStyle.SINGLE, size: 2, color: "A0A0A0" },
              right: { style: BorderStyle.SINGLE, size: 2, color: "A0A0A0" },
              insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "C0C0C0" },
              insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "C0C0C0" },
            },
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 20, type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "Page(s)", bold: true })] }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 80, type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "Testimony", bold: true })] }),
                    ],
                  }),
                ],
              }),
              ...rows.map(
                ([p, s]) =>
                  new TableRow({
                    children: [
                      new TableCell({
                        width: { size: 20, type: WidthType.PERCENTAGE },
                        children: [new Paragraph(p)],
                      }),
                      new TableCell({
                        width: { size: 80, type: WidthType.PERCENTAGE },
                        children: [new Paragraph(s)],
                      }),
                    ],
                  })
              ),
            ],
          }),
        ],
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/**
 * Generate PDF buffer from summary data
 */
export async function generatePdfBuffer(
  job: JobData,
  documentData: DocumentData,
  _summaryContent: string
): Promise<Buffer> {
  const { meta, rows } = documentData;
  const uploadedTitle = job.file?.title || job.fileName?.replace(/\.[^.]+$/, "") || "summary";
  const sourceFileName = job.fileName || "Unknown Source";
  const coverTitle = uploadedTitle;

  // Extract deponent name
  let deponentName = job.file?.deponent || "Not Specified";
  const titleLike = meta.find((l) => /transcript\s+summary\s+of\s+/i.test(l));
  if (titleLike) {
    const m1 = titleLike.match(/transcript\s+summary\s+of\s+(.+)/i);
    if (m1 && !m1[1].includes("[Unknown]")) {
      deponentName = m1[1].trim();
    } else if (job.file?.deponent) {
      deponentName = job.file.deponent;
    }
  }

  // Extract deposition date
  let depositionDate: string | null = null;
  const dateLine = meta.find((l) => /date\s+of\s+deposition\s*:/i.test(l));
  if (dateLine && !dateLine.includes("[Unknown]")) {
    const mDate = dateLine.match(/date\s+of\s+deposition\s*:\s*(.+)/i);
    if (mDate) depositionDate = mDate[1].trim();
  }

  // Construct title
  let titleOfDocument = `Transcript Summary of ${deponentName}`;

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks: Buffer[] = [];

    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const lm = pdf.page.margins.left;
    const rm = pdf.page.margins.right;
    const full = pdf.page.width - lm - rm;
    const gap = 0;
    const pageCol = 100;
    const sumCol = full - pageCol - gap;

    // Cover page
    try {
      const pageH = pdf.page.height;
      const top = pdf.page.margins.top;
      const bottom = pdf.page.margins.bottom;
      const usableH = pageH - top - bottom;

      let contentH = 0;
      let logoH = 0;
      let targetW = Math.min(260, full);
      const logo = loadLogo();
      if (logo) {
        if (logo.width && logo.height) {
          const scale = targetW / logo.width;
          logoH = logo.height * scale;
        } else {
          logoH = targetW * 0.33;
        }
        contentH += logoH + 16;
      }

      const lineOpts = { width: full, align: "center" as const };
      pdf.font("Times-Bold").fontSize(24);
      const titleLine = titleOfDocument || "DEPOSITION SUMMARY";
      contentH += pdf.heightOfString(titleLine, lineOpts) + 20;

      pdf.font("Times-Bold").fontSize(14);
      const deponentLine = `Deponent: ${deponentName}`;
      contentH += pdf.heightOfString(deponentLine, lineOpts) + 10;

      const caseLine = `Case Title: ${coverTitle}`;
      contentH += pdf.heightOfString(caseLine, lineOpts) + 10;

      const fileLine = `Source File: ${sourceFileName}`;
      contentH += pdf.heightOfString(fileLine, lineOpts) + 10;

      let hasPages = false;
      if (job.file?.pages) {
        hasPages = true;
        contentH += pdf.heightOfString(`Pages: ${job.file.pages}`, lineOpts) + 10;
      }

      pdf.font("Times-Roman").fontSize(12);
      const dateLine = `Date: ${new Date(job.createdAt || new Date()).toLocaleDateString()}`;
      contentH += pdf.heightOfString(dateLine, lineOpts) + 2;

      const startY = top + Math.max(0, (usableH - contentH) / 2);
      pdf.y = startY;
      if (logo) {
        const x = lm + (full - targetW) / 2;
        pdf.image(logo.buf, x, pdf.y, { width: targetW });
        pdf.y += logoH + 20;
      }

      pdf.font("Times-Bold").fontSize(24).text(titleLine, { align: "center" });
      pdf.moveDown(1);

      pdf.font("Times-Roman").fontSize(14).text(`Deponent: ${deponentName}`, { align: "left" });
      pdf.moveDown(0.5);

      pdf.font("Times-Roman").fontSize(14).text(`Case Title: ${coverTitle}`, { align: "left" });
      pdf.moveDown(0.5);

      pdf.font("Times-Roman").fontSize(14).text(`Source File: ${sourceFileName}`, { align: "left" });
      pdf.moveDown(0.5);

      if (hasPages) {
        pdf.font("Times-Roman").fontSize(14).text(`Pages: ${job.file!.pages}`, { align: "left" });
        pdf.moveDown(0.5);
      }

      const uploadDate = new Date(job.createdAt || new Date()).toLocaleDateString();
      const downloadDate = new Date().toLocaleDateString();
      const dateForCover = depositionDate || uploadDate;

      pdf.font("Times-Roman").fontSize(14).text(`Date: ${dateForCover}`, { align: "left" });
      pdf.moveDown(0.5);
      pdf.font("Times-Roman").fontSize(14).text(`Upload Date: ${uploadDate}`, { align: "left" });
      pdf.moveDown(0.5);
      pdf.font("Times-Roman").fontSize(14).text(`Download Date: ${downloadDate}`, { align: "left" });
    } catch {}

    // New page for body
    pdf.addPage();

    pdf.font("Times-Roman").fontSize(12);
    const details: string[] = [];
    if (depositionDate) details.push(`Date of Deposition: ${depositionDate}`);
    details.forEach((l) => pdf.text(l));
    if (details.length) pdf.moveDown(0.5);

    const pad = 6;
    let y = pdf.y + 18;
    const tableLeft = lm;
    const col1Left = tableLeft + pad;
    const col2Left = tableLeft + pageCol + gap + pad;

    // Header
    pdf.font("Times-Bold").fontSize(12);
    const headerH =
      Math.max(
        pdf.heightOfString("Page(s)", { width: pageCol - 2 * pad }),
        pdf.heightOfString("Testimony", { width: sumCol - 2 * pad })
      ) +
      pad * 2;
    pdf.save();
    pdf.lineWidth(1).strokeColor("#9da9bb").fillColor("#eef2f7");
    pdf.rect(tableLeft, y, full, headerH).fillAndStroke("#eef2f7", "#9da9bb");
    pdf.restore();
    pdf.fillColor("#000");
    pdf.text("Page(s)", col1Left, y + pad, { width: pageCol - 2 * pad });
    pdf.text("Testimony", col2Left, y + pad, { width: sumCol - 2 * pad });
    y += headerH;
    pdf.font("Times-Roman").fontSize(11);

    const pageHeight = pdf.page.height;
    const bottomMargin = 60;

    rows.forEach(([p, s]) => {
      pdf.font("Times-Roman").fontSize(11);
      const h1 = pdf.heightOfString(p, { width: pageCol - 2 * pad });
      const h2 = pdf.heightOfString(s, { width: sumCol - 2 * pad });
      const rowH = Math.max(h1, h2) + pad * 2;

      if (y + rowH > pageHeight - bottomMargin) {
        pdf.addPage();
        y = 80;

        pdf.font("Times-Bold").fontSize(12);
        pdf.save();
        pdf.lineWidth(1).strokeColor("#9da9bb").fillColor("#eef2f7");
        pdf.rect(tableLeft, y, full, headerH).fillAndStroke("#eef2f7", "#9da9bb");
        pdf.restore();
        pdf.fillColor("#000");
        pdf.text("Page(s)", col1Left, y + pad, { width: pageCol - 2 * pad });
        pdf.text("Testimony", col2Left, y + pad, { width: sumCol - 2 * pad });
        y += headerH;
        pdf.font("Times-Roman").fontSize(11);
      }

      pdf.lineWidth(0.75).strokeColor("#c8d0da");
      pdf.rect(tableLeft, y, full, rowH).stroke();
      pdf.fillColor("#000");
      pdf.text(p, col1Left, y + pad, { width: pageCol - 2 * pad });
      pdf.text(s, col2Left, y + pad, { width: sumCol - 2 * pad });
      y += rowH;
    });

    pdf.end();
  });
}

