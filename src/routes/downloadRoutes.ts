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
import fs from "fs";
import path from "path";

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

// Attempt to locate the Testifi AI logo locally.
function loadLogo(): { buf: Buffer; mime: string; width?: number; height?: number } | null {
  const candidates = [
    process.env.LIGHT_LOGO_PATH,
    process.env.LOGO_PATH,
    path.resolve(__dirname, "../../../og-image.png"), // typical during runtime (dist/src/routes -> ../../../)
    path.resolve(process.cwd(), "og-image.png"),
    // Common repo paths during local/dev
    path.resolve(process.cwd(), "loveable/public/testifi_light_logo.png"),
    path.resolve(process.cwd(), "loveable/public/testifi_dark_logo.png"),
    path.resolve(process.cwd(), "public/testifi_light_logo.png"),
    path.resolve(process.cwd(), "public/testifi_dark_logo.png"),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const buf = fs.readFileSync(p);
      // Minimal PNG size parsing (IHDR at bytes 16..24)
      let width: number | undefined;
      let height: number | undefined;
      let mime = "image/png";
      if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
        width = buf.readUInt32BE(16);
        height = buf.readUInt32BE(20);
      } else if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) {
        mime = "image/jpeg";
        // JPEG parsing omitted; we won't have intrinsic size for DOCX scaling.
      }
      return { buf, mime, width, height };
    } catch {}
  }
  return null;
}

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
  const pageRegex = /^(?:p(?:age)?\.?)?\s*\d+(?::\d+(?:-\d+)?)?(?:\s*[-–]\s*\d+(?::\d+)?)?/i;

  const meta: string[] = [];
  const rows: string[][] = [];
  let seenRow = false;

  md.split(/\r?\n/).forEach((raw) => {
    let trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith("```")) return;
    if (isRule(trimmed)) return;

    trimmed = clean(trimmed);
    if (!trimmed) return;

    const rowMatch = trimmed.match(pageRegex);
    if (rowMatch) {
      seenRow = true;
      const label = rowMatch[0].replace(/\s+/g, " ").trim();
      let remainder = trimmed.slice(rowMatch[0].length).trim();
      remainder = remainder.replace(/^[-–:|]\s*/, "").trim();
      rows.push([label || "", remainder || ""]);
      return;
    }

    if (!seenRow) {
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
    const coverTitle = uploadedTitle;

    try {
      const [buf] = await bucket.file(key).download();
      const data = buf.toString("utf-8");
      const { meta, rows } = parseMarkdown(data);

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
                  text: coverTitle,
                  alignment: "center",
                  heading: "Heading1",
                }),
                new Paragraph({
                  text: `Date: ${new Date(job.createdAt || new Date()).toLocaleDateString()}`,
                  alignment: "center",
                }),
                ...(job.file?.title
                  ? [
                      new Paragraph({
                        text: `Case: ${job.file.title}`,
                        alignment: "center",
                      }),
                    ]
                  : []),
                ...(job.file?.pages
                  ? [
                      new Paragraph({
                        text: `Pages: ${job.file.pages}`,
                        alignment: "center",
                      }),
                    ]
                  : []),
                new Paragraph({ children: [], pageBreakBefore: true }),
                // Body from parsed markdown
                ...meta.map((m) => new Paragraph(m)),
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
          pdf.font("Times-Bold").fontSize(22);
          contentH += pdf.heightOfString(coverTitle, lineOpts) + 6;
          pdf.font("Times-Roman").fontSize(12);
          const dateLine = `Date: ${new Date(job.createdAt || new Date()).toLocaleDateString()}`;
          contentH += pdf.heightOfString(dateLine, lineOpts) + 2;
          let hasCase = false;
          let hasPages = false;
          if (job.file?.title) {
            hasCase = true;
            contentH += pdf.heightOfString(`Case: ${job.file.title}`, lineOpts) + 2;
          }
          if (job.file?.pages) {
            hasPages = true;
            contentH += pdf.heightOfString(`Pages: ${job.file.pages}`, lineOpts) + 2;
          }

          const startY = top + Math.max(0, (usableH - contentH) / 2);
          pdf.y = startY;
          if (logo) {
            const x = lm + (full - targetW) / 2;
            pdf.image(logo.buf, x, pdf.y, { width: targetW });
            pdf.y += logoH + 16;
          }
          pdf.font("Times-Bold").fontSize(22).text(coverTitle, { align: "center" });
          pdf.moveDown(0.25);
          pdf.font("Times-Roman").fontSize(12).text(dateLine, { align: "center" });
          if (hasCase) pdf.text(`Case: ${job.file!.title}`, { align: "center" });
          if (hasPages) pdf.text(`Pages: ${job.file!.pages}`, { align: "center" });
        } catch {}

        // New page for body
        pdf.addPage();

        // Metadata
        pdf.font("Times-Roman").fontSize(12);
        meta.forEach((l) => pdf.text(l));
        pdf.moveDown(0.5);

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
        const tableTop = y;
        pdf.save();
        pdf.lineWidth(1).strokeColor('#9da9bb').fillColor('#eef2f7');
        pdf.rect(tableLeft, y, full, headerH).fillAndStroke('#eef2f7', '#9da9bb');
        pdf.restore();
        pdf.fillColor('#000');
        pdf.text("Page(s)", col1Left, y + pad, { width: pageCol - 2 * pad });
        pdf.text("Testimony", col2Left, y + pad, { width: sumCol - 2 * pad });
        y += headerH;

        // Rows
        rows.forEach(([p, s]) => {
          pdf.font("Times-Roman").fontSize(11);
          const h1 = pdf.heightOfString(p, { width: pageCol - 2 * pad });
          const h2 = pdf.heightOfString(s, { width: sumCol - 2 * pad });
          const rowH = Math.max(h1, h2) + pad * 2;
          // Row box with stronger borders
          pdf.lineWidth(0.75).strokeColor('#c8d0da');
          pdf.rect(tableLeft, y, full, rowH).stroke();
          // Text
          pdf.fillColor('#000');
          pdf.text(p, col1Left, y + pad, { width: pageCol - 2 * pad });
          pdf.text(s, col2Left, y + pad, { width: sumCol - 2 * pad });
          y += rowH;
        });
        // Outer border (left/right) already drawn per-row; draw table outer frame with stronger stroke
        pdf.lineWidth(1).strokeColor('#9da9bb');
        pdf.rect(tableLeft, tableTop, full, y - tableTop).stroke();
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
