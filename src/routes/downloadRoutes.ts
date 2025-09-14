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
    process.env.LOGO_PATH,
    path.resolve(__dirname, "../../../og-image.png"), // typical during runtime (dist/src/routes -> ../../../)
    path.resolve(process.cwd(), "og-image.png"),
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
    const coverTitle = job.file?.title || "Deposition Summary";
    const safeTitle = sanitize(
      stripExt(
        job.file?.title ||
          job.file?.summaryFileName ||
          job.fileName ||
          "summary"
      )
    );

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
        res.setHeader("Content-Type", "text/plain");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.txt"`
        );
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
                  rows: [
                    new TableRow({
                      children: [
                        new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: "Page(s)", bold: true })] })] }),
                        new TableCell({
                          children: [new Paragraph({ children: [new TextRun({ text: "Testimony Summary", bold: true })] })],
                        }),
                      ],
                    }),
                    ...rows.map(
                      ([p, s]) =>
                        new TableRow({
                          children: [
                            new TableCell({ children: [new Paragraph(p)] }),
                            new TableCell({ children: [new Paragraph(s)] }),
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
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.docx"`
        );
        res.send(docBuf);
        return;
      }

      // PDF — cover page (logo + title + date + case name/pages), then content
      if (format === "pdf") {
        const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
        const pass = new stream.PassThrough();
        pdf.pipe(pass).pipe(res);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.pdf"`
        );
        const lm = pdf.page.margins.left;
        const rm = pdf.page.margins.right;
        const full = pdf.page.width - lm - rm;
        const gap = 8;
        const pageCol = 90;
        const sumCol = full - pageCol - gap;

        // Cover page
        // Try to draw logo centered without stretching
        try {
          const logo = loadLogo();
          if (logo) {
            const targetW = Math.min(260, full);
            const x = lm + (full - targetW) / 2;
            const y = pdf.y; // current cursor
            pdf.image(logo.buf, x, y, { width: targetW });
            pdf.moveDown(2);
          }
        } catch {}

        pdf.font("Times-Bold").fontSize(22).text(coverTitle, {
          align: "center",
        });
        pdf.moveDown();
        pdf.font("Times-Roman").fontSize(12).text(`Date: ${new Date(job.createdAt || new Date()).toLocaleDateString()}`, { align: "center" });
        if (job.file?.title) {
          pdf.font("Times-Roman").fontSize(12).text(`Case: ${job.file.title}`, { align: "center" });
        }
        if (job.file?.pages) {
          pdf.font("Times-Roman").fontSize(12).text(`Pages: ${job.file.pages}`, { align: "center" });
        }

        // New page for body
        pdf.addPage();

        // Metadata
        pdf.font("Times-Roman").fontSize(12);
        meta.forEach((l) => pdf.text(l));
        pdf.moveDown(0.5);

        // Table header
        let y = pdf.y;
        pdf.font("Times-Bold").fontSize(12);
        pdf.text("Page(s)", lm, y, { width: pageCol });
        pdf.text("Testimony Summary", lm + pageCol + gap, y, { width: sumCol });
        y = pdf.y + 6;
        pdf.moveTo(lm, y).lineTo(lm + full, y).strokeColor('#c8c8c8').stroke();

        // Rows
        rows.forEach(([p, s]) => {
          const rowY = pdf.y + 6;
          pdf.font("Times-Bold").fontSize(11).text(p, lm, rowY, {
            width: pageCol,
          });
          pdf.font("Times-Roman").fontSize(11).text(s, lm + pageCol + gap, rowY, {
            width: sumCol,
          });
          // Row separator
          pdf.moveTo(lm, pdf.y + 4).lineTo(lm + full, pdf.y + 4).strokeColor('#e0e0e0').stroke();
        });
        pdf.end();
        return;
      }

      // CSV
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.csv"`
        );
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
