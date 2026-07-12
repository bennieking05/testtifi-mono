// ─── src/routes/downloadRoutes.ts ────────────────────────────────────────────

import express, { Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken, AuthRequest } from "../middlewares/authMiddleware";
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
import { splitDepositionOverview } from "../utils/summaryOverviewDelimiter";
import { stripRedundantFullPageLineSuffix } from "../utils/pageLineDisplay";
import { isNonSubstantiveSummary, sanitizeDepositionOverviewProse, sanitizeSummaryMetaLanguage, stripInCaseOfInternalTitle } from "../utils/summarySanitize";

const router = express.Router();
const prisma = new PrismaClient();
const bucket = new Storage().bucket("deposition-summaries");

// Helper to track download history
async function trackDownload(userId: string, fileId: string, format: string) {
  try {
    await prisma.downloadHistory.create({
      data: {
        userId,
        fileId,
        format: format.toLowerCase(),
      },
    });
    console.log(`[Download] Tracked download: user=${userId}, file=${fileId}, format=${format}`);
  } catch (err) {
    console.error("[Download] Failed to track download:", err);
    // Don't throw - download tracking failure shouldn't block the download
  }
}

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

// 4-column row structure for deposition summaries
export interface SummaryRow {
  pageLine: string;   // e.g., "8:2-10:15"
  witness: string;    // e.g., "Dr. Rhodes" (injected from metadata)
  topic: string;      // e.g., "Surgical Procedure"
  summary: string;    // Narrative summary text
}

export function parseMarkdown(md: string, witness: string = "Not Specified"): {
  meta: string[];
  rows: SummaryRow[];
  depositionOverview: string | null;
} {
  const { mdForTableParsing, depositionOverview } = splitDepositionOverview(md);

  const clean = (s: string) =>
    s
      .replace(/```[\s\S]*?```/g, "")
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .trim();

  const isRule = (s: string) => /^(?:-{3,}|_{3,}|\*{3,})$/.test(s.trim());
  const isMarkdownTableSeparator = (s: string) =>
    /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(s.trim());
  const pageLineToken = /^(?:p(?:age)?\.?)?\s*\d+(?::\d+)?(?:\s*[-–]\s*\d+(?::\d+)?)?/i;

  const meta: string[] = [];
  const rows: SummaryRow[] = [];
  let seenRow = false;

  const splitMarkdownTableRow = (line: string): string[] | null => {
    if (!line.includes("|")) return null;
    const stripped = line.replace(/^\|+/, "").replace(/\|+$/, "").trim();
    const parts = stripped.split("|").map((p) => clean(p));
    if (parts.length < 2) return null;
    const first = (parts[0] || "").trim().toLowerCase();
    if (first === "page/line" || first === "page(s)" || first === "page number") {
      return null;
    }
    return parts.map((p) => p.trim());
  };

  mdForTableParsing.split(/\r?\n/).forEach((raw) => {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("```")) return;
    if (isRule(trimmed) || isMarkdownTableSeparator(trimmed)) return;

    trimmed = clean(trimmed);
    if (!trimmed) return;

    const cells = splitMarkdownTableRow(trimmed);
    if (cells && cells.length >= 2) {
      const pageLineCell = cells[0];
      const pageMatch = pageLineCell.match(pageLineToken);
      if (pageMatch) {
        seenRow = true;
        if (cells.length >= 4) {
          rows.push({
            pageLine: pageLineCell,
            witness: (cells[1] || "").trim() || witness,
            topic: "",
            summary: cells.slice(3).join(" | ").trim() || "",
          });
        } else if (cells.length >= 3) {
          rows.push({
            pageLine: pageLineCell,
            witness,
            topic: "",
            summary: cells.slice(2).join(" | ").trim() || "",
          });
        } else {
          rows.push({
            pageLine: pageLineCell,
            witness,
            topic: "",
            summary: (cells[1] || "").trim(),
          });
        }
        return;
      }
    }

    let rest = trimmed.replace(/^\|+/, "").trim();
    const pageMatch2 = rest.match(pageLineToken);
    if (pageMatch2) {
      seenRow = true;
      const pageLine = pageMatch2[0].replace(/\s+/g, " ").trim();
      rest = rest.slice(pageMatch2[0].length).trim();
      rest = rest.replace(/^[−–:,|\s]+/, "").trim();
      rows.push({
        pageLine,
        witness,
        topic: "",
        summary: rest || "",
      });
      return;
    }

    if (!seenRow) {
      if (/^page\s*\/?\s*line\s*\|/i.test(trimmed)) return;
      if (/^page\s*\(s\)\s*\|\s*testimony/i.test(trimmed)) return;
      if (/^page\s*number\s*\|\s*testimony/i.test(trimmed)) return;
      if (trimmed.includes("|") && /\bpage\s*\/?\s*line\b/i.test(trimmed) && /\btopic\b/i.test(trimmed)) return;
      if (trimmed.includes("|") && /\bpage\s*\(s\)\b/i.test(trimmed) && /\btopic\b/i.test(trimmed)) return;
      meta.push(trimmed);
    }
  });

  return { meta, rows, depositionOverview };
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
  rows: SummaryRow[],
  opts: { maxPage?: number } = {}
): SummaryRow[] {
  const maxPage = opts.maxPage && opts.maxPage > 0 ? opts.maxPage : null;
  if (!maxPage) return rows;

  const kept: SummaryRow[] = [];
  let sawValidRow = false;
  let invalidStreak = 0;
  for (const row of rows) {
    const pages = extractAllPages(row.pageLine);
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
  async (req: AuthRequest, res: Response): Promise<void> => {
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
    // Ownership check: a user may only download their own summaries (admins may download any).
    // Return 404 (not 403) so a job's existence is not disclosed to non-owners.
    if (job.userId !== req.user?.userId && req.user?.role !== "admin") {
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
      const metadata = await resolveSummaryMetadata(bucket, job);
      let deponentName = metadata.deponent || job.file?.deponent || "Not Specified";
      const { meta, rows, depositionOverview: overviewFromMd } = parseMarkdown(data, deponentName);
      const depositionOverviewRaw =
        (overviewFromMd && overviewFromMd.trim()) ||
        (metadata.depositionOverview && String(metadata.depositionOverview).trim()) ||
        "";
      const internalDocTitleDl =
        (job.file?.title && String(job.file.title).trim()) ||
        (job.fileName || "").replace(/\.[^.]+$/, "").trim() ||
        "";
      const depositionOverviewText = depositionOverviewRaw
        ? stripInCaseOfInternalTitle(
            sanitizeDepositionOverviewProse(sanitizeSummaryMetaLanguage(depositionOverviewRaw)),
            internalDocTitleDl
          )
        : "";
      sourceFileName = metadata.sourceFileName || sourceFileName;
      coverTitle = metadata.caseCaption || metadata.caseTitle || coverTitle;
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
      // Exclude placeholder, __SKIP__, and meta-commentary rows from output
      const displayRows = boundedRows
        .filter((r) => !isNonSubstantiveSummary(r.summary))
        .map((r) => ({
          ...r,
          pageLine: stripRedundantFullPageLineSuffix(r.pageLine),
        }));
      const hasMultipleWitnesses =
        new Set(displayRows.map((r) => r.witness).filter(Boolean)).size > 1;

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

        const titlePage = [
          titleOfDocument || "DEPOSITION SUMMARY",
          "",
          ...(hasMultipleWitnesses ? [`Deponent: ${deponentName}`] : []),
          `Source File: ${sourceFileName}`,
          ...(normalizedPages ? [`Pages: ${normalizedPages}`] : []),
          `Date of Deposition: ${depositionDateDisplay || "[Unknown]"}`,
          `Upload Date: ${uploadDate}`,
          `Download Date: ${downloadDate}`,
          "",
          "=".repeat(50),
          "",
        ];
        
        const body = [
          ...titlePage,
          ...(depositionOverviewText
            ? ["Deposition overview", "", depositionOverviewText, "", "-".repeat(40), ""]
            : []),
          ...displayRows.map((row) =>
            hasMultipleWitnesses
              ? `${row.pageLine} | ${row.witness}\n${row.summary}\n`
              : `${row.pageLine}\n${row.summary}\n`
          ),
        ].join("\n");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        setAttachmentFilename(res, uploadedTitle, "txt");
        
        // Track download - use job.fileId directly for reliability
        if (req.user?.userId && job.fileId) {
          await trackDownload(req.user.userId, job.fileId, "txt");
        } else {
          console.warn(`[Download] Skipping tracking: userId=${req.user?.userId}, fileId=${job.fileId}`);
        }
        
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
                ...(hasMultipleWitnesses
                  ? [
                      new Paragraph({
                        children: [new TextRun({ text: "Deponent:", bold: true }), new TextRun(` ${deponentName}`)],
                        alignment: "left",
                      }),
                      new Paragraph({ children: [], spacing: { before: 80 } }),
                    ]
                  : []),
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
                new Paragraph({ children: [], pageBreakBefore: true }),
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
                            new TableCell({ width: { size: 15, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Page(s)", bold: true })] })] }),
                            new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Witness", bold: true })] })] }),
                            new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Summary", bold: true })] })] }),
                          ]
                        : [
                            new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: "Page(s)", bold: true })] })] }),
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
        const docBuf = await Packer.toBuffer(doc);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
        setAttachmentFilename(res, uploadedTitle, "docx");
        
        // Track download - use job.fileId directly for reliability
        if (req.user?.userId && job.fileId) {
          await trackDownload(req.user.userId, job.fileId, "docx");
        } else {
          console.warn(`[Download] Skipping tracking: userId=${req.user?.userId}, fileId=${job.fileId}`);
        }
        
        res.send(docBuf);
        return;
      }

      // PDF — cover page (logo + title + date + case name/pages), then bordered table content
      if (format === "pdf") {
        // Track download early for PDF (streamed) - use job.fileId directly for reliability
        if (req.user?.userId && job.fileId) {
          await trackDownload(req.user.userId, job.fileId, "pdf");
        } else {
          console.warn(`[Download] Skipping tracking: userId=${req.user?.userId}, fileId=${job.fileId}`);
        }
        
        res.setHeader("Content-Type", "application/pdf");
        setAttachmentFilename(res, uploadedTitle, "pdf");

        const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
        const pass = new stream.PassThrough();
        pdf.on("error", (pdfErr) => {
          console.error("[Download] PDF stream error:", pdfErr);
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to generate PDF." });
          } else {
            try {
              res.end();
            } catch {
              /* ignore */
            }
          }
        });
        pass.on("error", (passErr) => {
          console.error("[Download] PDF pass-through error:", passErr);
        });
        res.on("error", (resErr) => {
          console.error("[Download] Response error during PDF:", resErr);
        });
        pdf.pipe(pass).pipe(res);
        const lm = pdf.page.margins.left;
        const rm = pdf.page.margins.right;
        const full = pdf.page.width - lm - rm;
        const col1Width = hasMultipleWitnesses ? full * 0.15 : full * 0.18;
        const col2Width = hasMultipleWitnesses ? full * 0.20 : full * 0.82;
        const col3Width = hasMultipleWitnesses ? full * 0.65 : 0;

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
          if (hasMultipleWitnesses) {
            const deponentLine = `Deponent: ${deponentName}`;
            contentH += pdf.heightOfString(deponentLine, lineOpts) + 10;
          }
          
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
          
          if (hasMultipleWitnesses) {
            pdf.font("Times-Roman").fontSize(14).text(`Deponent: ${deponentName}`, { align: "left" });
            pdf.moveDown(0.5);
          }

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
        } catch {}

        // New page for body
        pdf.addPage();

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
        
        // Page-line summary table
        const pad = 4;
        let y = pdf.y + 18; // add some space after cover
        const tableLeft = lm;
        
        // Column positions
        const col1Left = tableLeft + pad;
        const col2Left = tableLeft + col1Width + pad;
        const summaryLeftMulti = tableLeft + col1Width + col2Width + pad;

        const drawHeader = (yPos: number): number => {
          pdf.font("Times-Bold").fontSize(10);
          const headerH =
            (hasMultipleWitnesses
              ? Math.max(
                  pdf.heightOfString("Page(s)", { width: col1Width - 2 * pad }),
                  pdf.heightOfString("Witness", { width: col2Width - 2 * pad }),
                  pdf.heightOfString("Summary", { width: col3Width - 2 * pad })
                )
              : Math.max(
                  pdf.heightOfString("Page(s)", { width: col1Width - 2 * pad }),
                  pdf.heightOfString("Summary", { width: col2Width - 2 * pad })
                )) + pad * 2;

          pdf.save();
          pdf.lineWidth(1).strokeColor('#9da9bb').fillColor('#eef2f7');
          pdf.rect(tableLeft, yPos, full, headerH).fillAndStroke('#eef2f7', '#9da9bb');
          pdf.restore();
          pdf.fillColor('#000');

          pdf.text("Page(s)", col1Left, yPos + pad, { width: col1Width - 2 * pad });
          if (hasMultipleWitnesses) {
            pdf.text("Witness", col2Left, yPos + pad, { width: col2Width - 2 * pad });
            pdf.text("Summary", summaryLeftMulti, yPos + pad, { width: col3Width - 2 * pad });
          } else {
            pdf.text("Summary", col2Left, yPos + pad, { width: col2Width - 2 * pad });
          }
          return headerH;
        };

        // Rows with page overflow handling
        const pageHeight = pdf.page.height;
        const bottomMargin = 60; // Leave space at bottom

        // Start a new page BEFORE drawing the header if the header + first row won't fit —
        // otherwise the header orphans at the bottom of the overview page and gets redrawn on
        // the next page (the duplicate-header bug, UAT R45 #2).
        pdf.font("Times-Bold").fontSize(10);
        const headerHEstimate =
          pdf.heightOfString("Page(s)", { width: col1Width - 2 * pad }) + pad * 2;
        let firstRowH = 0;
        if (displayRows.length > 0) {
          const r0 = displayRows[0];
          pdf.font("Times-Roman").fontSize(9);
          const a = pdf.heightOfString(r0.pageLine, { width: col1Width - 2 * pad });
          const b = hasMultipleWitnesses
            ? pdf.heightOfString(r0.witness, { width: col2Width - 2 * pad })
            : pdf.heightOfString(r0.summary, { width: col2Width - 2 * pad });
          const c = hasMultipleWitnesses
            ? pdf.heightOfString(r0.summary, { width: col3Width - 2 * pad })
            : 0;
          firstRowH = Math.max(a, b, c) + pad * 2;
        }
        if (y + headerHEstimate + firstRowH > pageHeight - bottomMargin) {
          pdf.addPage();
          y = 80;
        }

        const headerH = drawHeader(y);
        y += headerH;
        pdf.font("Times-Roman").fontSize(9);

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

          pdf.lineWidth(0.75).strokeColor('#c8d0da');
          pdf.rect(tableLeft, y, full, rowH).stroke();

          if (hasMultipleWitnesses) {
            pdf.moveTo(tableLeft + col1Width, y).lineTo(tableLeft + col1Width, y + rowH).stroke();
            pdf.moveTo(tableLeft + col1Width + col2Width, y).lineTo(tableLeft + col1Width + col2Width, y + rowH).stroke();
            pdf.fillColor('#000');
            pdf.text(row.pageLine, col1Left, y + pad, { width: col1Width - 2 * pad });
            pdf.text(row.witness, col2Left, y + pad, { width: col2Width - 2 * pad });
            pdf.text(row.summary, summaryLeftMulti, y + pad, { width: col3Width - 2 * pad });
          } else {
            pdf.moveTo(tableLeft + col1Width, y).lineTo(tableLeft + col1Width, y + rowH).stroke();
            pdf.fillColor('#000');
            pdf.text(row.pageLine, col1Left, y + pad, { width: col1Width - 2 * pad });
            pdf.text(row.summary, col2Left, y + pad, { width: col2Width - 2 * pad });
          }
          y += rowH;
        });
        
        pdf.end();
        return;
      }

      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        setAttachmentFilename(res, uploadedTitle, "csv");
        const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
        const header = hasMultipleWitnesses
          ? '"Page(s)","Witness","Summary"'
          : '"Page(s)","Summary"';
        const lines = displayRows.map((row) =>
          hasMultipleWitnesses
            ? `${esc(row.pageLine)},${esc(row.witness)},${esc(row.summary)}`
            : `${esc(row.pageLine)},${esc(row.summary)}`
        );
        const csv = [header, ...lines].join("\n");
        
        // Track download - use job.fileId directly for reliability
        if (req.user?.userId && job.fileId) {
          await trackDownload(req.user.userId, job.fileId, "csv");
        } else {
          console.warn(`[Download] Skipping tracking: userId=${req.user?.userId}, fileId=${job.fileId}`);
        }
        
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
