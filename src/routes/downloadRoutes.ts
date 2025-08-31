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
} from "docx";
import PDFDocument from "pdfkit";
import stream from "stream";

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

    if (trimmed.startsWith("|")) inTable = true;

    if (!inTable) {
      // Drop markdown headers and a specific Case Metadata heading
      if (/^#+\s*/.test(trimmed) || /^\*\*?\s*Case\s*Metadata/i.test(trimmed)) {
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

      // DOCX — match preview structure: cover page (title + pages), then content
      if (format === "docx") {
        const doc = new Document({
          styles: {
            default: {
              document: {
                run: { font: "Calibri", size: 22 }, // 11pt
                paragraph: { spacing: { after: 120 } },
              },
              heading1: { run: { size: 32, bold: true } },
            },
          },
          sections: [
            {
              children: [
                // Cover page
                new Paragraph({
                  text: coverTitle,
                  alignment: "center",
                  heading: "Heading1",
                }),
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
                        new TableCell({ children: [new Paragraph("Page(s)")] }),
                        new TableCell({
                          children: [new Paragraph("Testimony Summary")],
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

      // PDF — match preview structure: cover page (title + pages), then content
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
        pdf.font("Helvetica-Bold").fontSize(22).text(coverTitle, {
          align: "center",
        });
        if (job.file?.pages) {
          pdf.moveDown();
          pdf.font("Helvetica").fontSize(12).text(`Pages: ${job.file.pages}`, {
            align: "center",
          });
        }

        // New page for body
        pdf.addPage();

        // Metadata
        pdf.font("Helvetica").fontSize(11);
        meta.forEach((l) => pdf.text(l));
        pdf.moveDown(0.5);

        // Table header
        let y = pdf.y;
        pdf.font("Helvetica-Bold").fontSize(11);
        pdf.text("Page(s)", lm, y, { width: pageCol });
        pdf.text("Testimony Summary", lm + pageCol + gap, y, { width: sumCol });
        y = pdf.y + 6;
        pdf.moveTo(lm, y).lineTo(lm + full, y).stroke();

        // Rows
        rows.forEach(([p, s]) => {
          const rowY = pdf.y + 6;
          pdf.font("Helvetica-Bold").fontSize(10).text(p, lm, rowY, {
            width: pageCol,
          });
          pdf.font("Helvetica").fontSize(10).text(s, lm + pageCol + gap, rowY, {
            width: sumCol,
          });
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
