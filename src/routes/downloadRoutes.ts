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
import { normalizeUnknownString, resolveSummaryMetadata } from "../utils/summaryMetadata";
import { formatDateInTimeZoneMDY, parseLooseDate } from "../utils/dateTime";

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

  const splitMarkdownTableRow = (
    line: string
  ): { firstCell: string; restCells: string[] } | null => {
    // Accept common markdown table row shapes:
    // - "| p.6:1-25, p.7:1-25 | testimony |"
    // - "| p.6:1-25 | testimony | extra |"
    if (!line.includes("|")) return null;
    const stripped = line.replace(/^\|+/, "").replace(/\|+$/, "").trim();
    const parts = stripped.split("|").map((p) => clean(p));
    if (parts.length < 2) return null;
    const first = (parts[0] || "").trim();
    const rest = parts.slice(1).map((p) => String(p || "").trim());
    if (
      /^page\s*\(s\)$/i.test(first) ||
      (/^page\s*number$/i.test(first) && rest[0] && /^testimony$/i.test(rest[0]))
    ) {
      return null;
    }
    if (first && rest.join("").trim()) return { firstCell: first, restCells: rest };
    return null;
  };

  md.split(/\r?\n/).forEach((raw) => {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("```")) return;
    if (isRule(trimmed)) return;

    trimmed = clean(trimmed);
    if (!trimmed) return;

    // Handle markdown table rows with leading pipes.
    const pipeRow = splitMarkdownTableRow(trimmed);
    if (pipeRow) {
      const labelCell = pipeRow.firstCell;
      const testimonyCell = pipeRow.restCells.join(" | ").trim();

      // Extract one or more page tokens from the label cell
      const pages: string[] = [];
      let rest = labelCell.replace(/^\|+/, "").trim();
      let m = rest.match(pageToken);
      while (m) {
        pages.push(m[0].replace(/\s+/g, " ").trim());
        rest = rest.slice(m[0].length).trim();
        rest = rest.replace(/^\s*[,|]+\s*/, "");
        m = rest.match(pageToken);
      }
      if (pages.length) {
        seenRow = true;
        rows.push([pages.join(", "), testimonyCell || ""]);
        return;
      }
    }

    // Capture one or more page tokens at the beginning
    const pages: string[] = [];
    let rest = trimmed.replace(/^\|+/, "").trim();
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
      if (/^page\s*\(s\)\s*\|\s*testimony/i.test(trimmed)) return;
      if (/^page\s*number\s*\|\s*testimony/i.test(trimmed)) return;
      meta.push(trimmed);
    }
  });

  const typedRows: Array<[string, string]> = rows.map(([a, b]) => [a, b]);

  return { meta, rows: typedRows };
}

function extractAllPages(label: string): number[] {
  const out: number[] = [];
  const re = /(?:^|[,\s|])(?:p(?:age)?\.?)?\s*(\d{1,6})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(label))) {
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function enforcePageBounds(
  rows: Array<[string, string]>,
  opts: { maxPage?: number } = {}
): Array<[string, string]> {
  const maxPage = opts.maxPage && opts.maxPage > 0 ? opts.maxPage : null;
  if (!maxPage) return rows;

  const kept: Array<[string, string]> = [];
  let sawValidRow = false;
  let invalidStreak = 0;
  for (const row of rows) {
    const [label] = row;
    const pages = extractAllPages(label);
    // If we can't parse a page number, keep the row as-is.
    if (!pages.length) {
      kept.push(row);
      continue;
    }
    // Reject page 0 and anything beyond known max.
    const invalid = pages.some((p) => p < 1 || p > maxPage);
    if (invalid) {
      if (!sawValidRow) continue; // drop leading p.0 etc
      // Be tolerant: sometimes the model emits a few out-of-range rows in the middle.
      // Only truncate if we see a sustained invalid tail.
      invalidStreak++;
      if (invalidStreak >= 10) break;
      continue;
    }
    sawValidRow = true;
    invalidStreak = 0;
    kept.push(row);
  }
  return kept;
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
    let sourceFileName = job.fileName || "Unknown Source";
    let coverTitle = uploadedTitle;

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
      const metadata = await resolveSummaryMetadata(bucket, job);
      let deponentName = metadata.deponent || job.file?.deponent || "Not Specified";
      sourceFileName = metadata.sourceFileName || sourceFileName;
      coverTitle = metadata.caseTitle || coverTitle;
      const depositionDateRaw: string | null = normalizeUnknownString(metadata.depositionDate);
      // If already in human-readable format (e.g., "July 7, 2022"), use as-is to avoid timezone shift.
      // Only reformat if it's a machine format like ISO date.
      const isHumanReadable = depositionDateRaw && /^[A-Za-z]+\s+\d{1,2},?\s+\d{4}$/.test(depositionDateRaw.trim());
      const depositionDateDisplay = isHumanReadable
        ? depositionDateRaw
        : (parseLooseDate(depositionDateRaw) ? formatDateInTimeZoneMDY(parseLooseDate(depositionDateRaw)!) : (depositionDateRaw || null));
      // Fallback chain for page count: metadata.totalPages > job.totalPages > job.file.pages
      const normalizedPages =
        metadata.totalPages && metadata.totalPages > 0
          ? metadata.totalPages
          : job.totalPages && job.totalPages > 0
          ? job.totalPages
          : job.file?.pages
          ? Number(job.file.pages)
          : undefined;
      const boundedRows = enforcePageBounds(rows, {
        maxPage: normalizedPages || metadata.totalPages || undefined,
      });

      // Extract company information from case caption
      let companyName = "";
      const captionLine = meta.find(l => /case\s+caption:/i.test(l));
      if (captionLine) {
        // Look for company patterns like "PURDUE PHARMA L.P."
        const companyMatch = captionLine.match(/PURDUE\s+PHARMA[^\s]*/i) || 
                           captionLine.match(/([A-Z\s]+PHARMA[A-Z\s]*)/i) ||
                           captionLine.match(/([A-Z\s]+L\.P\.)/i);
        if (companyMatch) {
          companyName = companyMatch[1] || companyMatch[0];
        }
      }

      // Construct enhanced title
      let titleOfDocument = `Transcript Summary of ${deponentName}`;
      if (companyName) {
        titleOfDocument = `Transcript Summary of ${deponentName} from ${companyName}`;
      }
      
      console.log(`[Download] Cover page info:`, {
        deponentName,
        coverTitle,
        sourceFileName,
        pages: job.file?.pages,
        date: formatDateInTimeZoneMDY(job.createdAt || new Date())
      });

      // TXT — clean text format with consistent title page matching DOCX format
      if (format === "txt") {
        const uploadDate = formatDateInTimeZoneMDY(metadata.uploadDate || job.createdAt || new Date());
        const downloadDate = formatDateInTimeZoneMDY(new Date());

        // Build warnings section if any judge failed
        const warningsSection: string[] = [];
        if (metadata.judgeResults && !metadata.judgeResults.allPassed) {
          warningsSection.push("", "⚠️ VALIDATION WARNINGS:", "-".repeat(30));
          for (const judge of metadata.judgeResults.judges) {
            if (!judge.passed || judge.warnings.length > 0) {
              for (const w of judge.warnings) {
                warningsSection.push(`• [${judge.name}] ${w}`);
              }
            }
          }
          warningsSection.push("");
        }
        
        const titlePage = [
          titleOfDocument || "DEPOSITION SUMMARY",
          "",
          `Deponent: ${deponentName}`,
          `Case Title: ${coverTitle}`,
          `Source File: ${sourceFileName}`,
          ...(normalizedPages ? [`Pages: ${normalizedPages}`] : []),
          `Date of Deposition: ${depositionDateDisplay || "[Unknown]"}`,
          `Upload Date: ${uploadDate}`,
          `Download Date: ${downloadDate}`,
          ...warningsSection,
          "",
          "=".repeat(50),
          "",
        ];
        
        const body = [
          ...titlePage,
          ...boundedRows.map(([p, s]) => `${p}\n${s}\n`),
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
                  text: titleOfDocument || "DEPOSITION SUMMARY",
                  alignment: "center",
                  heading: "Heading1",
                }),
                new Paragraph({ children: [], spacing: { before: 120 } }),
                new Paragraph({
                  children: [new TextRun({ text: "Deponent:", bold: true }), new TextRun(` ${deponentName}`)],
                  alignment: "left",
                }),
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [new TextRun({ text: "Case Title:", bold: true }), new TextRun(` ${coverTitle}`)],
                  alignment: "left",
                }),
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [new TextRun({ text: "Source File:", bold: true }), new TextRun(` ${sourceFileName}`)],
                  alignment: "left",
                }),
                ...(normalizedPages
                  ? [
                      new Paragraph({ children: [], spacing: { before: 80 } }),
                      new Paragraph({
                        children: [new TextRun({ text: "Pages:", bold: true }), new TextRun(` ${normalizedPages}`)],
                        alignment: "left",
                      }),
                    ]
                  : []),
                new Paragraph({ children: [], spacing: { before: 80 } }),
                new Paragraph({
                  children: [
                    new TextRun({ text: "Date of Deposition:", bold: true }),
                    new TextRun(
                      ` ${depositionDateDisplay || "[Unknown]"}`
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
                // Add validation warnings if any
                ...(() => {
                  if (!metadata.judgeResults || metadata.judgeResults.allPassed) return [];
                  const warningParas: Paragraph[] = [
                    new Paragraph({ children: [], spacing: { before: 200 } }),
                    new Paragraph({
                      children: [
                        new TextRun({ text: "⚠️ Validation Warnings:", bold: true, color: "856404" }),
                      ],
                      alignment: "left",
                    }),
                  ];
                  for (const judge of metadata.judgeResults.judges) {
                    if (!judge.passed || judge.warnings.length > 0) {
                      for (const w of judge.warnings) {
                        warningParas.push(
                          new Paragraph({
                            children: [
                              new TextRun({ text: `• [${judge.name}] ${w}`, color: "856404" }),
                            ],
                            alignment: "left",
                            spacing: { before: 60 },
                          })
                        );
                      }
                    }
                  }
                  return warningParas;
                })(),
                new Paragraph({ children: [], pageBreakBefore: true }),
                // Body metadata — show only curated items
                ...(() => {
                  const paras: Paragraph[] = [];
                  if (depositionDateDisplay) paras.push(new Paragraph(`Date of Deposition: ${depositionDateDisplay}`));
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
                    ...boundedRows.map(
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
          if (normalizedPages) {
            hasPages = true;
            contentH += pdf.heightOfString(`Pages: ${normalizedPages}`, lineOpts) + 10;
          }
          
          pdf.font("Times-Roman").fontSize(12);
          const dateLine = `Date of Deposition: ${depositionDateDisplay || "[Unknown]"}`;
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
          
          // Align metadata to the left to match DOCX format
          pdf.font("Times-Roman").fontSize(14).text(`Deponent: ${deponentName}`, { align: "left" });
          pdf.moveDown(0.5);

          pdf.font("Times-Roman").fontSize(14).text(`Case Title: ${coverTitle}`, { align: "left" });
          pdf.moveDown(0.5);

          pdf.font("Times-Roman").fontSize(14).text(`Source File: ${sourceFileName}`, { align: "left" });
          pdf.moveDown(0.5);

          if (hasPages) {
            pdf.font("Times-Roman").fontSize(14).text(`Pages: ${normalizedPages}` , { align: "left" });
            pdf.moveDown(0.5);
          }

          const uploadDate = formatDateInTimeZoneMDY(job.createdAt || new Date());
          const downloadDate = formatDateInTimeZoneMDY(new Date());
          
          pdf.font("Times-Roman")
            .fontSize(14)
            .text(`Date of Deposition: ${depositionDateDisplay || "[Unknown]"}` , { align: "left" });
          pdf.moveDown(0.5);
          pdf.font("Times-Roman").fontSize(14).text(`Upload Date: ${uploadDate}` , { align: "left" });
          pdf.moveDown(0.5);
          pdf.font("Times-Roman").fontSize(14).text(`Download Date: ${downloadDate}` , { align: "left" });

          // Add validation warnings if any
          if (metadata.judgeResults && !metadata.judgeResults.allPassed) {
            pdf.moveDown(1);
            pdf.font("Times-Bold").fontSize(12).fillColor("#856404").text("⚠️ Validation Warnings:", { align: "left" });
            pdf.font("Times-Roman").fontSize(11).fillColor("#856404");
            for (const judge of metadata.judgeResults.judges) {
              if (!judge.passed || judge.warnings.length > 0) {
                for (const w of judge.warnings) {
                  pdf.moveDown(0.3);
                  pdf.text(`• [${judge.name}] ${w}`, { align: "left" });
                }
              }
            }
            pdf.fillColor("black");
          }
        } catch {}

        // New page for body
        pdf.addPage();

        // Metadata — show only clean extracted items
        pdf.font("Times-Roman").fontSize(12);
        const details: string[] = [];
        if (depositionDateDisplay) details.push(`Date of Deposition: ${depositionDateDisplay}`);
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
        
        boundedRows.forEach(([p, s]) => {
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
        const lines = boundedRows.map(([p, s]) => `${esc(p)},${esc(s)}`);
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
