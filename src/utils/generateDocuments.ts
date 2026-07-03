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
import { stripRedundantFullPageLineSuffix } from "./pageLineDisplay";
import {
  isNonSubstantiveSummary,
  sanitizeDepositionOverviewProse,
  sanitizeSummaryMetaLanguage,
  stripInCaseOfInternalTitle,
} from "./summarySanitize";

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
  depositionOverview?: string | null;
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
  const { rows, depositionOverview } = documentData;
  const displayRows = rows
    .filter((r) => !isNonSubstantiveSummary(r.summary))
    .map((row) => ({
      ...row,
      pageLine: stripRedundantFullPageLineSuffix(row.pageLine),
    }));
  const hasMultipleWitnesses =
    new Set(displayRows.map((r) => r.witness).filter(Boolean)).size > 1;
  const depositionOverviewRaw =
    (depositionOverview && depositionOverview.trim()) ||
    (metadata.depositionOverview && String(metadata.depositionOverview).trim()) ||
    "";
  const internalDocTitle =
    (job.file?.title && String(job.file.title).trim()) ||
    (job.fileName || "").replace(/\.[^.]+$/, "").trim() ||
    "";
  const depositionOverviewText = depositionOverviewRaw
    ? stripInCaseOfInternalTitle(
        sanitizeDepositionOverviewProse(sanitizeSummaryMetaLanguage(depositionOverviewRaw)),
        internalDocTitle
      )
    : "";
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
          ...(hasMultipleWitnesses
            ? [
                new Paragraph({
                  children: [
                    new TextRun({ text: "Deponent:", bold: true }),
                    new TextRun(` ${deponentName}`),
                  ],
                  alignment: "left",
                }),
                new Paragraph({ children: [], spacing: { before: 80 } }),
              ]
            : []),
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
          ...(depositionOverviewText
            ? [
                new Paragraph({
                  children: [new TextRun({ text: "Deposition overview", bold: true })],
                  spacing: { after: 160 },
                }),
                ...depositionOverviewText
                  .split(/\n\s*\n/)
                  .filter((b) => b.trim())
                  .map(
                    (block) =>
                      new Paragraph({
                        children: [new TextRun(block.trim())],
                        spacing: { after: 120 },
                      })
                  ),
                new Paragraph({ children: [], spacing: { before: 160 } }),
              ]
            : []),
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
                children: hasMultipleWitnesses
                  ? [
                      new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Page/Line", bold: true })] })] }),
                      new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Witness", bold: true })] })] }),
                      new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Summary", bold: true })] })] }),
                    ]
                  : [
                      new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Page/Line", bold: true })] })] }),
                      new TableCell({ width: { size: 82, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Summary", bold: true })] })] }),
                    ],
              }),
              ...displayRows.map((row) =>
                new TableRow({
                  children: hasMultipleWitnesses
                    ? [
                        new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, children: [new Paragraph(row.pageLine)] }),
                        new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph(row.witness)] }),
                        new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, children: [new Paragraph(row.summary)] }),
                      ]
                    : [
                        new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, children: [new Paragraph(row.pageLine)] }),
                        new TableCell({ width: { size: 82, type: WidthType.PERCENTAGE }, children: [new Paragraph(row.summary)] }),
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
  const { rows, depositionOverview } = documentData;
  const displayRows = rows
    .filter((r) => !isNonSubstantiveSummary(r.summary))
    .map((row) => ({
      ...row,
      pageLine: stripRedundantFullPageLineSuffix(row.pageLine),
    }));
  const hasMultipleWitnesses =
    new Set(displayRows.map((r) => r.witness).filter(Boolean)).size > 1;
  const depositionOverviewRaw =
    (depositionOverview && depositionOverview.trim()) ||
    (metadata.depositionOverview && String(metadata.depositionOverview).trim()) ||
    "";
  const internalDocTitle =
    (job.file?.title && String(job.file.title).trim()) ||
    (job.fileName || "").replace(/\.[^.]+$/, "").trim() ||
    "";
  const depositionOverviewText = depositionOverviewRaw
    ? stripInCaseOfInternalTitle(
        sanitizeDepositionOverviewProse(sanitizeSummaryMetaLanguage(depositionOverviewRaw)),
        internalDocTitle
      )
    : "";
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
    
    const col1Width = hasMultipleWitnesses ? full * 0.15 : full * 0.18;
    const col2Width = hasMultipleWitnesses ? full * 0.20 : full * 0.82;
    const col3Width = hasMultipleWitnesses ? full * 0.65 : 0;

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
      if (hasMultipleWitnesses) {
        const deponentLine = `Deponent: ${deponentName}`;
        contentH += pdf.heightOfString(deponentLine, lineOpts) + 10;
      }

      const caseLine = `Case Title: ${coverTitle}`;
      contentH += pdf.heightOfString(caseLine, lineOpts) + 10;

      const fileLine = `Source File: ${sourceFileName}`;
      contentH += pdf.heightOfString(fileLine, lineOpts) + 10;

      const displayPages =
        (metadata.totalPages && metadata.totalPages > 0
          ? metadata.totalPages
          : deriveMaxPageFromRows(displayRows)) || 0;
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

      if (hasMultipleWitnesses) {
        pdf.font("Times-Roman").fontSize(14).text(`Deponent: ${deponentName}`, { align: "left" });
        pdf.moveDown(0.5);
      }

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

    if (depositionOverviewText) {
      pdf.font("Times-Bold").fontSize(12).text("Deposition overview", { align: "left" });
      pdf.moveDown(0.4);
      pdf.font("Times-Roman").fontSize(10);
      for (const block of depositionOverviewText.split(/\n\s*\n/).filter((b) => b.trim())) {
        pdf.text(block.trim(), { align: "left", width: full });
        pdf.moveDown(0.5);
      }
      pdf.moveDown(0.5);
    }

    const pad = 4;
    let y = pdf.y + 18;
    const tableLeft = lm;

    const col1Left = tableLeft + pad;
    const col2Left = tableLeft + col1Width + pad;
    const summaryLeftMulti = tableLeft + col1Width + col2Width + pad;

    const drawHeader = (yPos: number): number => {
      pdf.font("Times-Bold").fontSize(10);
      const headerH =
        (hasMultipleWitnesses
          ? Math.max(
              pdf.heightOfString("Page/Line", { width: col1Width - 2 * pad }),
              pdf.heightOfString("Witness", { width: col2Width - 2 * pad }),
              pdf.heightOfString("Summary", { width: col3Width - 2 * pad })
            )
          : Math.max(
              pdf.heightOfString("Page/Line", { width: col1Width - 2 * pad }),
              pdf.heightOfString("Summary", { width: col2Width - 2 * pad })
            )) + pad * 2;

      pdf.save();
      pdf.lineWidth(1).strokeColor("#9da9bb").fillColor("#eef2f7");
      pdf.rect(tableLeft, yPos, full, headerH).fillAndStroke("#eef2f7", "#9da9bb");
      pdf.restore();
      pdf.fillColor("#000");

      pdf.text("Page/Line", col1Left, yPos + pad, { width: col1Width - 2 * pad });
      if (hasMultipleWitnesses) {
        pdf.text("Witness", col2Left, yPos + pad, { width: col2Width - 2 * pad });
        pdf.text("Summary", summaryLeftMulti, yPos + pad, { width: col3Width - 2 * pad });
      } else {
        pdf.text("Summary", col2Left, yPos + pad, { width: col2Width - 2 * pad });
      }
      return headerH;
    };

    const headerH = drawHeader(y);
    y += headerH;
    pdf.font("Times-Roman").fontSize(9);

    const pageHeight = pdf.page.height;
    const bottomMargin = 60;

    displayRows.forEach((row) => {
      pdf.font("Times-Roman").fontSize(9);
      const h1 = pdf.heightOfString(row.pageLine, { width: col1Width - 2 * pad });
      const h2 = hasMultipleWitnesses
        ? pdf.heightOfString(row.witness, { width: col2Width - 2 * pad })
        : pdf.heightOfString(row.summary, { width: col2Width - 2 * pad });
      const h3 = hasMultipleWitnesses ? pdf.heightOfString(row.summary, { width: col3Width - 2 * pad }) : 0;
      const rowH = Math.max(h1, h2, h3) + pad * 2;

      if (y + rowH > pageHeight - bottomMargin) {
        pdf.addPage();
        y = 80;
        const newHeaderH = drawHeader(y);
        y += newHeaderH;
        pdf.font("Times-Roman").fontSize(9);
      }

      pdf.lineWidth(0.75).strokeColor("#c8d0da");
      pdf.rect(tableLeft, y, full, rowH).stroke();

      if (hasMultipleWitnesses) {
        pdf.moveTo(tableLeft + col1Width, y).lineTo(tableLeft + col1Width, y + rowH).stroke();
        pdf.moveTo(tableLeft + col1Width + col2Width, y).lineTo(tableLeft + col1Width + col2Width, y + rowH).stroke();
        pdf.text(row.pageLine, col1Left, y + pad, { width: col1Width - 2 * pad });
        pdf.text(row.witness, col2Left, y + pad, { width: col2Width - 2 * pad });
        pdf.text(row.summary, summaryLeftMulti, y + pad, { width: col3Width - 2 * pad });
      } else {
        pdf.moveTo(tableLeft + col1Width, y).lineTo(tableLeft + col1Width, y + rowH).stroke();
        pdf.text(row.pageLine, col1Left, y + pad, { width: col1Width - 2 * pad });
        pdf.text(row.summary, col2Left, y + pad, { width: col2Width - 2 * pad });
      }
      y += rowH;
    });

    pdf.end();
  });
}
