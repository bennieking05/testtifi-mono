// ─── src/routes/downloadRoutes.ts ────────────────────────────────────────────

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";
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
import stream from "stream";
import { loadLogo } from "../utils/logo";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");

export const sanitize = (s: string) =>
  s
    .replace(/[^a-z0-9_.-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
export const stripExt = (s: string) => s.replace(/\.[^.]+$/, "");
export const objectKey = (u: string) => {
  try {
    return new URL(u).pathname.split("/").pop()!;
  } catch {
    return u;
  }
};

// RFC 5987 encoder for UTF-8 filenames in Content-Disposition
function encodeRFC5987ValueChars(str: string) {
  return encodeURIComponent(str)
    .replace(/['()]/g, escape)
    .replace(/\*/g, '%2A');
}

function setAttachmentFilename(res: Response, baseName: string, ext: string) {
  const asciiFallback = sanitize(stripExt(baseName)) || "summary";
  const fileAscii = `${asciiFallback}.${ext}`;
  const fileUtf8 = `${baseName}.${ext}`;
  const encoded = encodeRFC5987ValueChars(fileUtf8);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${fileAscii}"; filename*=UTF-8''${encoded}`
  );
}

export function parseMarkdown(md: string) {
  const clean = (s: string) =>
    s
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .trim();

  const isRule = (s: string) => /^(?:-{3,}|_{3,}|\*{3,})$/.test(s.trim());
  // A single page token that may appear repeatedly at the start, separated by commas
  const pageToken = /^(?:p(?:age)?\.?)?\s*\d+(?::\d+(?:-\d+)?)?(?:\s*[-–]\s*\d+(?::\d+)?)?/i;

  const meta: string[] = [];
  const rows: string[][] = [];
  let seenRow = false;

  md.split(/\r?\n/).forEach((raw) => {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("```")) return;
    if (isRule(trimmed)) return;

    trimmed = clean(trimmed);
    if (!trimmed) return;

    // Capture one or more page tokens at the beginning
    const pages: string[] = [];
    let rest = trimmed;
    let m = rest.match(pageToken);
    while (m) {
      pages.push(m[0].replace(/\s+/g, " ").trim());
      rest = rest.slice(m[0].length).trim();
      // remove delimiter(s) between tokens
      rest = rest.replace(/^\s*[,|]+\s*/, "");
      m = rest.match(pageToken);
    }
    if (pages.length) {
      seenRow = true;
      rest = rest.replace(/^[−–:,|\s]+/, "").trim();
      rows.push([pages.join(", "), rest || ""]);
      return;
    }

    if (!seenRow) {
      // Skip obvious table header lines
      if (/^\|/.test(trimmed)) return;
      if (/^page\s*\(s\)\s*\|\s*testimony/i.test(trimmed)) return;
      if (/^page\s*number\s*\|\s*testimony/i.test(trimmed)) return;
      meta.push(trimmed);
    }
  });

  const typedRows: Array<[string, string]> = rows.map(([a, b]) => [a, b]);

  return { meta, rows: typedRows };
}

router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const { jobId, format } = req.query as { jobId?: string; format?: string };
    if (!jobId || !format) {
      res.status(400).json({ error: "Missing jobId or format" });
      return;
    }

    const job = await prisma.summaryJob.findUnique({
      where: { id: jobId },
      include: { file: true },
    });
    if (!job) {
      res.status(404).json({ error: "Summary job not found." });
      return;
    }

    const key = job.summaryCsvUrl
      ? objectKey(job.summaryCsvUrl)
      : job.file?.summaryFileName ?? `summary-${job.id}.md`;
    const uploadedTitle = job.file?.title || stripExt(job.fileName || "summary");
    const sourceFileName = job.fileName || "Unknown Source";
    const coverTitle = uploadedTitle;

    console.log(`[Download] Job ID: ${jobId}, Format: ${format}`);
    console.log(`[Download] File data:`, {
      title: job.file?.title,
      deponent: job.file?.deponent,
      pages: job.file?.pages,
      fileName: job.fileName
    });

    try {
      const [buf] = await bucket.file(key).download();
      const data = buf.toString("utf-8");
      const { meta, rows } = parseMarkdown(data);
      
      // Derive deponent and deposition date from metadata when available
      let deponentName = job.file?.deponent || "Not Specified";
      const depLine = meta.find(l => /(?:deponent|deposition\s+of)\s*:/.test(l));
      const titleLike = meta.find(l => /transcript\s+summary\s+of\s+/i.test(l));
      if (!job.file?.deponent) {
        let m1 = depLine?.match(/(?:deponent|deposition\s+of)\s*:\s*(.+)/i);
        if (!m1 && titleLike) m1 = titleLike.match(/transcript\s+summary\s+of\s+(.+)/i);
        if (m1) deponentName = m1[1].replace(/\[?unknown\]?/i, "").trim() || deponentName;
      }

      let depositionDate: string | null = null;
      const dateLine = meta.find(l => /date\s+of\s+deposition\s*:/i.test(l));
      const mDate = dateLine?.match(/date\s+of\s+deposition\s*:\s*(.+)/i);
      if (mDate) depositionDate = mDate[1].replace(/\[?unknown\]?/i, "").trim();
      
      console.log(`[Download] Cover page info:`, {
        deponentName,
        coverTitle,
        sourceFileName,
        pages: job.file?.pages,
        date: new Date(job.createdAt || new Date()).toLocaleDateString()
      });

      // TXT — fixed-width two-column table
      if (format === "txt") {
        const col1 = 18;
        const line = "-".repeat(col1 + 2 + 80);
        const header = `${"Page(s)".padEnd(col1)}| Testimony`;
        const body = [
          ...meta,
          "",
          line,
          header,
          line,
          ...rows.map(([p, s]) => p.padEnd(col1) + "| " + s),
          line,
        ].join("\n");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        setAttachmentFilename(res, uploadedTitle, "txt");
        res.send(body);
        return;
      }

      // DOCX — cover page (logo + title + date + case name/pages), then bordered table content
      if (format === "docx") {
        const logo = loadLogo();
        const logoMaxWidth = 400; // px in docx units used by docx lib
        let logoRun: ImageRun | null = null;
        if (logo) {
          // Compute scaled dimensions to avoid stretching
          let w = 0;
          let h = 0;
          if (logo.width && logo.height) {
            const scale = Math.min(1, logoMaxWidth / logo.width);
            w = Math.round(logo.width * scale);
            h = Math.round(logo.height * scale);
          } else {
            // Fallback: assume a conservative aspect ratio
            w = logoMaxWidth;
            h = Math.round(logoMaxWidth * 0.33);
          }
          const docxType = logo.mime.includes("png")
            ? "png"
            : logo.mime.includes("jpeg") || logo.mime.includes("jpg")
            ? "jpg"
            : ("png" as const);
          logoRun = new ImageRun({ type: docxType, data: logo.buf, transformation: { width: w, height: h } });
        }
        const doc = new Document({
          styles: {
            default: {
              document: {
                run: { font: "Times New Roman", size: 24 }, // 11pt
                paragraph: { spacing: { after: 160 } },
              },
              heading1: { run: { size: 36, bold: true } },
            },
          },
          sections: [
            {
              children: [
                // Add top spacing to visually center cover content vertically
                new Paragraph({ children: [], spacing: { before: 2400 } }),
                // Logo (centered)
                ...(logoRun
                  ? [
                      new Paragraph({
                        children: [logoRun],
                        alignment: "center",
                      }),
                    ]
                  : []),
                // Cover page
                new Paragraph({
                  text: "DEPOSITION SUMMARY",
                  alignment: "center",
                  heading: "Heading1",
                }),
                new Paragraph({ children: [], spacing: { before: 120 } }),
                new Paragraph({
                  children: [new TextRun({ text: "Deponent:", bold: true }), new TextRun(` ${deponentName}`)],
                  alignment: "center",
                }),
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [new TextRun({ text: "Case Title:", bold: true }), new TextRun(` ${coverTitle}`)],
                  alignment: "center",
                }),
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [new TextRun({ text: "Source File:", bold: true }), new TextRun(` ${sourceFileName}`)],
                  alignment: "center",
                }),
                ...(job.file?.pages
                  ? [
                      new Paragraph({ children: [], spacing: { before: 80 } }),
                      new Paragraph({
                        children: [new TextRun({ text: "Pages:", bold: true }), new TextRun(` ${job.file.pages}`)],
                        alignment: "center",
                      }),
                    ]
                  : []),
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [new TextRun({ text: "Date:", bold: true }), new TextRun(` ${depositionDate || new Date(job.createdAt || new Date()).toLocaleDateString()}`)],
                  alignment: "center",
                }),
                new Paragraph({ children: [], pageBreakBefore: true }),
                // Body metadata — show only curated items
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
        const docBuf = await Packer.toBuffer(doc);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        setAttachmentFilename(res, uploadedTitle, "docx");
        res.send(docBuf);
        return;
      }

      // PDF — cover page (logo + title + date + case name/pages), then bordered table content
      if (format === "pdf") {
      const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
        const pass = new stream.PassThrough();
        pdf.pipe(pass).pipe(res);
        res.setHeader("Content-Type", "application/pdf");
        setAttachmentFilename(res, uploadedTitle, "pdf");
        const lm = pdf.page.margins.left;
        const rm = pdf.page.margins.right;
        const full = pdf.page.width - lm - rm;
        // Use a clean grid with no gap for enclosed tabular style
        const gap = 0;
        const pageCol = 100;
        const sumCol = full - pageCol - gap;

        // Cover page centered both horizontally and vertically
        try {
          const pageH = pdf.page.height;
          const top = pdf.page.margins.top;
          const bottom = pdf.page.margins.bottom;
          const usableH = pageH - top - bottom;

          // Measure content block height
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
            contentH += logoH + 16; // add spacing under logo
          }
          // Measure text heights
          const lineOpts = { width: full, align: "center" as const };
          pdf.font("Times-Bold").fontSize(24);
          const titleLine = "DEPOSITION SUMMARY";
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
          
          // Use single centered lines to avoid layout overlap from continued+centered text
          pdf.font("Times-Roman").fontSize(14).text(`Deponent: ${deponentName}`, { align: "center" });
          pdf.moveDown(0.5);

          pdf.font("Times-Roman").fontSize(14).text(`Case Title: ${coverTitle}`, { align: "center" });
          pdf.moveDown(0.5);

          pdf.font("Times-Roman").fontSize(14).text(`Source File: ${sourceFileName}`, { align: "center" });
          pdf.moveDown(0.5);

          if (hasPages) {
            pdf.font("Times-Roman").fontSize(14).text(`Pages: ${job.file!.pages}` , { align: "center" });
            pdf.moveDown(0.5);
          }

          const dateForCover = depositionDate || new Date(job.createdAt || new Date()).toLocaleDateString();
          pdf.font("Times-Roman").fontSize(12).text(`Date: ${dateForCover}` , { align: "center" });
        } catch {}

        // New page for body
        pdf.addPage();

        // Metadata — show only clean extracted items
        pdf.font("Times-Roman").fontSize(12);
        const details: string[] = [];
        if (depositionDate) details.push(`Date of Deposition: ${depositionDate}`);
        details.forEach((l) => pdf.text(l));
        if (details.length) pdf.moveDown(0.5);
        
        // Enclosed table with borders
        const pad = 6;
        let y = pdf.y + 18; // add some space after cover
        const tableLeft = lm;
        const col1Left = tableLeft + pad;
        const col2Left = tableLeft + pageCol + gap + pad;

        // Header
        pdf.font("Times-Bold").fontSize(12);
        const headerH = Math.max(
          pdf.heightOfString("Page(s)", { width: pageCol - 2 * pad }),
          pdf.heightOfString("Testimony", { width: sumCol - 2 * pad })
        ) + pad * 2;
        pdf.save();
        pdf.lineWidth(1).strokeColor('#9da9bb').fillColor('#eef2f7');
        pdf.rect(tableLeft, y, full, headerH).fillAndStroke('#eef2f7', '#9da9bb');
        pdf.restore();
        pdf.fillColor('#000');
        pdf.text("Page(s)", col1Left, y + pad, { width: pageCol - 2 * pad });
        pdf.text("Testimony", col2Left, y + pad, { width: sumCol - 2 * pad });
        y += headerH;
        // Ensure body text starts with normal font/size
        pdf.font("Times-Roman").fontSize(11);

        // Rows with page overflow handling
        const pageHeight = pdf.page.height;
        const bottomMargin = 60; // Leave space at bottom
        
        rows.forEach(([p, s]) => {
          pdf.font("Times-Roman").fontSize(11);
          const h1 = pdf.heightOfString(p, { width: pageCol - 2 * pad });
          const h2 = pdf.heightOfString(s, { width: sumCol - 2 * pad });
          const rowH = Math.max(h1, h2) + pad * 2;
          
          // Check if row will overflow page
          if (y + rowH > pageHeight - bottomMargin) {
            // Add new page
            pdf.addPage();
            
            // Reset y position and restart table
            y = 80; // Top margin on new page
            
            // Redraw table header on new page
            pdf.font("Times-Bold").fontSize(12);
            pdf.save();
            pdf.lineWidth(1).strokeColor('#9da9bb').fillColor('#eef2f7');
            pdf.rect(tableLeft, y, full, headerH).fillAndStroke('#eef2f7', '#9da9bb');
            pdf.restore();
            pdf.fillColor('#000');
            pdf.text("Page(s)", col1Left, y + pad, { width: pageCol - 2 * pad });
            pdf.text("Testimony", col2Left, y + pad, { width: sumCol - 2 * pad });
            y += headerH;
            // Reset font after drawing header so first row on new page is not bold
            pdf.font("Times-Roman").fontSize(11);
          }
          
          // Row box with stronger borders
          pdf.lineWidth(0.75).strokeColor('#c8d0da');
          pdf.rect(tableLeft, y, full, rowH).stroke();
          // Text
          pdf.fillColor('#000');
          pdf.text(p, col1Left, y + pad, { width: pageCol - 2 * pad });
          pdf.text(s, col2Left, y + pad, { width: sumCol - 2 * pad });
          y += rowH;
        });
        // No final border needed - each row has its own border
        pdf.end();
        return;
      }

      // CSV — strict two-column table with header: Page(s),Testimony
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        setAttachmentFilename(res, uploadedTitle, "csv");
        const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
        const header = '"Page(s)","Testimony"';
        const lines = rows.map(([p, s]) => `${esc(p)},${esc(s)}`);
        const csv = [header, ...lines].join("\n");
        res.send(csv);
        return;
      }

      res.status(400).json({ error: "Supported formats: csv, txt, docx, pdf" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to retrieve summary content." });
    }
  }
);

export default router;
