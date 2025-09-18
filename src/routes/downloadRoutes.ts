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

const sanitize = (s: string) =>
  s
    .replace(/[^a-z0-9_.-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
const stripExt = (s: string) => s.replace(/\.[^.]+$/, "");
const objectKey = (u: string) => {
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

function parseMarkdown(md: string) {
  const clean = (s: string) =>
    s
      // convert <br> to newlines
      .replace(/<br\s*\/?>(\s*)/gi, "\n")
      // remove bold/italic markdown wrappers (keep inner text)
      .replace(/\*\*(.*?)\*\*/g, "$1")
      .replace(/__(.*?)__/g, "$1")
      .replace(/\*(.*?)\*/g, "$1")
      .trim();

  const isRule = (s: string) => /^(?:-{3,}|_{3,}|\*{3,})$/.test(s.trim());

  const looksLikeHeader = (a: string, b: string) => {
    const A = clean(a).toLowerCase();
    const B = clean(b).toLowerCase();
    const hasPage = /page/.test(A) || /page/.test(B);
    const hasSummary = /summary/.test(A) || /summary/.test(B);
    const isDashes = /^-+$/.test(A) || /^-+$/.test(B);
    return (hasPage && hasSummary) || isDashes;
  };

  const meta: string[] = [];
  const rows: string[][] = [];
  let inTable = false;

  md.split(/\r?\n/).forEach((raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (isRule(trimmed)) return; // drop horizontal rules
    // strip model filler lines
    if (/\bto be continued\b/i.test(trimmed)) return;
    if (/\blet me know if you'd like me to continue\b/i.test(trimmed)) return;
    if (/\bprovide further clarification\b/i.test(trimmed)) return;

    if (trimmed.startsWith("|")) inTable = true;

    if (!inTable) {
      // Drop markdown headers and a specific Case Metadata heading
      // Remove any visible Case Metadata headings in various casings
      if (/^#+\s*/.test(trimmed) || /case\s*metadata/i.test(trimmed)) {
        return;
      }
      // strip leading list marker like "- " or "* "
      const noBullet = trimmed.replace(/^[*-]\s+/, "");
      meta.push(clean(noBullet));
      return;
    }

    if (inTable && trimmed.startsWith("|")) {
      const cols = trimmed
        .split("|")
        .slice(1, -1)
        .map((c) => clean(c));
      if (cols.length !== 2) return;
      if (looksLikeHeader(cols[0], cols[1])) return; // skip header row
      // skip continuation/filler rows accidentally parsed as cells
      if (cols.some((c) => /to be continued|let me know|provide further clarification/i.test(c))) return;
      rows.push(cols);
    }
  });

  return { meta, rows };
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

      // TXT
      if (format === "txt") {
        const line = "-".repeat(57);
        const body = [
          ...meta,
          "",
          line,
          "Page(s)           | Testimony Summary",
          line,
          ...rows.map(([p, s]) => p.padEnd(18) + "| " + s),
          line,
        ].join("\n");
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
        setAttachmentFilename(res, uploadedTitle, "txt");
        res.send(body);
        return;
      }

      // DOCX — cover page (logo + title + date + case name/pages), then content
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
                    top: { style: BorderStyle.SINGLE, size: 1, color: "C0C0C0" },
                    bottom: { style: BorderStyle.SINGLE, size: 1, color: "C0C0C0" },
                    left: { style: BorderStyle.SINGLE, size: 1, color: "C0C0C0" },
                    right: { style: BorderStyle.SINGLE, size: 1, color: "C0C0C0" },
                    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
                    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E0E0E0" },
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
                            new Paragraph({ children: [new TextRun({ text: "Testimony Summary", bold: true })] }),
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

      // PDF — cover page (logo + title + date + case name/pages), then content
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
          pdf.heightOfString("Testimony Summary", { width: sumCol - 2 * pad })
        ) + pad * 2;
        const tableTop = y;
        pdf.save();
        pdf.lineWidth(0.5).strokeColor('#bdbdbd').fillColor('#f1f5f9');
        pdf.rect(tableLeft, y, full, headerH).fillAndStroke('#f1f5f9', '#bdbdbd');
        pdf.restore();
        pdf.fillColor('#000');
        pdf.text("Page(s)", col1Left, y + pad, { width: pageCol - 2 * pad });
        pdf.text("Testimony Summary", col2Left, y + pad, { width: sumCol - 2 * pad });
        y += headerH;

        // Rows
        rows.forEach(([p, s]) => {
          pdf.font("Times-Roman").fontSize(11);
          const h1 = pdf.heightOfString(p, { width: pageCol - 2 * pad });
          const h2 = pdf.heightOfString(s, { width: sumCol - 2 * pad });
          const rowH = Math.max(h1, h2) + pad * 2;
          // Row box
          pdf.lineWidth(0.5).strokeColor('#e0e0e0');
          pdf.rect(tableLeft, y, full, rowH).stroke();
          // Text
          pdf.fillColor('#000');
          pdf.text(p, col1Left, y + pad, { width: pageCol - 2 * pad });
          pdf.text(s, col2Left, y + pad, { width: sumCol - 2 * pad });
          y += rowH;
        });
        // Outer border (left/right) already drawn per-row; draw table outer frame
        pdf.lineWidth(0.75).strokeColor('#bdbdbd');
        pdf.rect(tableLeft, tableTop, full, y - tableTop).stroke();
        pdf.end();
        return;
      }

      // CSV
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        setAttachmentFilename(res, uploadedTitle, "csv");
        res.send(buf);
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
