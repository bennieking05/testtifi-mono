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
import { normalizeUnknownString, SummaryMetadata } from "./summaryMetadata";
import { formatDateInTimeZoneMDY, parseLooseDate } from "./dateTime";

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

// 4-column row structure for deposition summaries
export interface SummaryRow {
  pageLine: string;   // e.g., "8:2-10:15"
  witness: string;    // e.g., "Dr. Rhodes"
  topic: string;      // e.g., "Surgical Procedure"
  summary: string;    // Narrative summary text
}

export interface DocumentData {
  meta: string[];
  rows: SummaryRow[];
}

// Legacy 2-column format for backwards compatibility
export interface LegacyDocumentData {
  meta: string[];
  rows: Array<[string, string]>;
}

function deriveMaxPageFromRows(rows: SummaryRow[]): number {
  let maxPage = 0;
  for (const row of rows) {
    const m = row.pageLine.match(/(\d+)(?::\d+)?(?:\s*[-–]\s*(\d+)(?::\d+)?)?/);
    if (m) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : a;
      if (!Number.isNaN(a)) maxPage = Math.max(maxPage, a);
      if (!Number.isNaN(b)) maxPage = Math.max(maxPage, b);
    }
  }
  return maxPage;
}

/**
 * Generate DOCX buffer from summary data (4-column format)
 */
export async function generateDocxBuffer(
  job: JobData,
  metadata: SummaryMetadata,
  documentData: DocumentData,
  _summaryContent: string
): Promise<Buffer> {
  const { rows } = documentData;
  // Use caseCaption (extracted from document) for Case Title, fallback to user-provided title
  const coverTitle =
    metadata.caseCaption || metadata.caseTitle || job.file?.title || job.fileName?.replace(/\.[^.]+$/, "") || "Case";
  const sourceFileName = metadata.sourceFileName || job.fileName || "Unknown Source";
  const deponentName = metadata.deponent || job.file?.deponent || "Not Specified";
  const depositionDateRaw = normalizeUnknownString(metadata.depositionDate);
  const depositionDateParsed = parseLooseDate(depositionDateRaw);
  const depositionDateDisplay =
    depositionDateParsed ? formatDateInTimeZoneMDY(depositionDateParsed) : depositionDateRaw;
  const titleOfDocument = `Transcript Summary of ${deponentName}`;

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
          ...(metadata.totalPages
            ? [
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [
                    new TextRun({ text: "Pages:", bold: true }),
                    new TextRun(` ${metadata.totalPages}`),
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
                ` ${
                  depositionDateDisplay ||
                  formatDateInTimeZoneMDY(job.createdAt || new Date())
                }`
              ),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Upload Date:", bold: true }),
              new TextRun(` ${formatDateInTimeZoneMDY(job.createdAt || new Date())}`),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], spacing: { before: 80 } }),
          new Paragraph({
            children: [
              new TextRun({ text: "Download Date:", bold: true }),
              new TextRun(` ${formatDateInTimeZoneMDY(new Date())}`),
            ],
            alignment: "left",
          }),
          new Paragraph({ children: [], pageBreakBefore: true }),
          ...(() => {
            const paras: Paragraph[] = [];
            if (depositionDateDisplay)
              paras.push(new Paragraph(`Date of Deposition: ${depositionDateDisplay}`));
            return paras;
          })(),
          new Paragraph({ children: [], spacing: { before: 160 } }),
          // 4-column table: Page/Line, Witness, Topic, Summary
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
              // Header row
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 12, type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "Page/Line", bold: true })] }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 13, type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "Witness", bold: true })] }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 15, type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "Topic", bold: true })] }),
                    ],
                  }),
                  new TableCell({
                    width: { size: 60, type: WidthType.PERCENTAGE },
                    children: [
                      new Paragraph({ children: [new TextRun({ text: "Summary", bold: true })] }),
                    ],
                  }),
                ],
              }),
              // Data rows
              ...rows.map(
                (row) =>
                  new TableRow({
                    children: [
                      new TableCell({
                        width: { size: 12, type: WidthType.PERCENTAGE },
                        children: [new Paragraph(row.pageLine)],
                      }),
                      new TableCell({
                        width: { size: 13, type: WidthType.PERCENTAGE },
                        children: [new Paragraph(row.witness)],
                      }),
                      new TableCell({
                        width: { size: 15, type: WidthType.PERCENTAGE },
                        children: [new Paragraph(row.topic)],
                      }),
                      new TableCell({
                        width: { size: 60, type: WidthType.PERCENTAGE },
                        children: [new Paragraph(row.summary)],
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
 * Generate PDF buffer from summary data (4-column format)
 */
export async function generatePdfBuffer(
  job: JobData,
  metadata: SummaryMetadata,
  documentData: DocumentData,
  _summaryContent: string
): Promise<Buffer> {
  const { rows } = documentData;
  // Use caseCaption (extracted from document) for Case Title, fallback to user-provided title
  const coverTitle =
    metadata.caseCaption || metadata.caseTitle || job.file?.title || job.fileName?.replace(/\.[^.]+$/, "") || "Case";
  const sourceFileName = metadata.sourceFileName || job.fileName || "Unknown Source";
  const deponentName = metadata.deponent || job.file?.deponent || "Not Specified";
  const depositionDateRaw = normalizeUnknownString(metadata.depositionDate);
  const depositionDateParsed = parseLooseDate(depositionDateRaw);
  const depositionDateDisplay =
    depositionDateParsed ? formatDateInTimeZoneMDY(depositionDateParsed) : depositionDateRaw;
  const titleOfDocument = `Transcript Summary of ${deponentName}`;

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
    const chunks: Buffer[] = [];

    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    const lm = pdf.page.margins.left;
    const rm = pdf.page.margins.right;
    const full = pdf.page.width - lm - rm;
    
    // 4-column widths: Page/Line (12%), Witness (13%), Topic (15%), Summary (60%)
    const col1Width = full * 0.12;  // Page/Line
    const col2Width = full * 0.13;  // Witness
    const col3Width = full * 0.15;  // Topic
    const col4Width = full * 0.60;  // Summary

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

      const displayPages =
        (metadata.totalPages && metadata.totalPages > 0
          ? metadata.totalPages
          : deriveMaxPageFromRows(rows)) || 0;
      const hasPages = displayPages > 0;
      if (hasPages) contentH += pdf.heightOfString(`Pages: ${displayPages}`, lineOpts) + 10;

      pdf.font("Times-Roman").fontSize(12);
      const dateLine = `Date: ${formatDateInTimeZoneMDY(job.createdAt || new Date())}`;
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
        pdf.font("Times-Roman").fontSize(14).text(`Pages: ${displayPages}`, { align: "left" });
        pdf.moveDown(0.5);
      }

      const uploadDate = formatDateInTimeZoneMDY(job.createdAt || new Date());
      const downloadDate = formatDateInTimeZoneMDY(new Date());

      pdf.font("Times-Roman")
        .fontSize(14)
        .text(`Date of Deposition: ${depositionDateDisplay || "[Unknown]"}`, { align: "left" });
      pdf.moveDown(0.5);
      pdf.font("Times-Roman").fontSize(14).text(`Upload Date: ${uploadDate}`, { align: "left" });
      pdf.moveDown(0.5);
      pdf.font("Times-Roman").fontSize(14).text(`Download Date: ${downloadDate}`, { align: "left" });
    } catch {}

    // New page for body
    pdf.addPage();

    pdf.font("Times-Roman").fontSize(12);
    const details: string[] = [];
    if (depositionDateDisplay) details.push(`Date of Deposition: ${depositionDateDisplay}`);
    details.forEach((l) => pdf.text(l));
    if (details.length) pdf.moveDown(0.5);

    const pad = 4;
    let y = pdf.y + 18;
    const tableLeft = lm;

    // Column positions
    const col1Left = tableLeft + pad;
    const col2Left = tableLeft + col1Width + pad;
    const col3Left = tableLeft + col1Width + col2Width + pad;
    const col4Left = tableLeft + col1Width + col2Width + col3Width + pad;

    // Draw header row
    const drawHeader = (yPos: number): number => {
      pdf.font("Times-Bold").fontSize(10);
      const headerH =
        Math.max(
          pdf.heightOfString("Page/Line", { width: col1Width - 2 * pad }),
          pdf.heightOfString("Witness", { width: col2Width - 2 * pad }),
          pdf.heightOfString("Topic", { width: col3Width - 2 * pad }),
          pdf.heightOfString("Summary", { width: col4Width - 2 * pad })
        ) +
        pad * 2;
      
      pdf.save();
      pdf.lineWidth(1).strokeColor("#9da9bb").fillColor("#eef2f7");
      pdf.rect(tableLeft, yPos, full, headerH).fillAndStroke("#eef2f7", "#9da9bb");
      pdf.restore();
      pdf.fillColor("#000");
      
      pdf.text("Page/Line", col1Left, yPos + pad, { width: col1Width - 2 * pad });
      pdf.text("Witness", col2Left, yPos + pad, { width: col2Width - 2 * pad });
      pdf.text("Topic", col3Left, yPos + pad, { width: col3Width - 2 * pad });
      pdf.text("Summary", col4Left, yPos + pad, { width: col4Width - 2 * pad });
      
      return headerH;
    };

    const headerH = drawHeader(y);
    y += headerH;
    pdf.font("Times-Roman").fontSize(9);

    const pageHeight = pdf.page.height;
    const bottomMargin = 60;

    rows.forEach((row) => {
      pdf.font("Times-Roman").fontSize(9);
      const h1 = pdf.heightOfString(row.pageLine, { width: col1Width - 2 * pad });
      const h2 = pdf.heightOfString(row.witness, { width: col2Width - 2 * pad });
      const h3 = pdf.heightOfString(row.topic, { width: col3Width - 2 * pad });
      const h4 = pdf.heightOfString(row.summary, { width: col4Width - 2 * pad });
      const rowH = Math.max(h1, h2, h3, h4) + pad * 2;

      if (y + rowH > pageHeight - bottomMargin) {
        pdf.addPage();
        y = 80;
        const newHeaderH = drawHeader(y);
        y += newHeaderH;
        pdf.font("Times-Roman").fontSize(9);
      }

      pdf.lineWidth(0.75).strokeColor("#c8d0da");
      pdf.rect(tableLeft, y, full, rowH).stroke();
      
      // Draw vertical lines between columns
      pdf.moveTo(tableLeft + col1Width, y).lineTo(tableLeft + col1Width, y + rowH).stroke();
      pdf.moveTo(tableLeft + col1Width + col2Width, y).lineTo(tableLeft + col1Width + col2Width, y + rowH).stroke();
      pdf.moveTo(tableLeft + col1Width + col2Width + col3Width, y).lineTo(tableLeft + col1Width + col2Width + col3Width, y + rowH).stroke();
      
      pdf.fillColor("#000");
      pdf.text(row.pageLine, col1Left, y + pad, { width: col1Width - 2 * pad });
      pdf.text(row.witness, col2Left, y + pad, { width: col2Width - 2 * pad });
      pdf.text(row.topic, col3Left, y + pad, { width: col3Width - 2 * pad });
      pdf.text(row.summary, col4Left, y + pad, { width: col4Width - 2 * pad });
      y += rowH;
    });

    pdf.end();
  });
}
