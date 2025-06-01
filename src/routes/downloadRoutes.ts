// ─── src/routes/downloadRoutes.ts ────────────────────────────────────────────
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
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

/* ────────── helpers ────────── */
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
  const meta: string[] = [],
    rows: string[][] = [];
  let inTable = false;
  md.split(/\r?\n/).forEach((l) => {
    if (l.startsWith("|")) inTable = true;
    if (!inTable && l.trim()) meta.push(l);
    if (inTable && l.startsWith("|")) {
      const cols = l
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());
      if (
        cols.length === 2 &&
        cols[0].toLowerCase() !== "page" &&
        !/^[-]+$/.test(cols[0])
      )
        rows.push(cols);
    }
  });
  return { meta, rows };
}

/* ────────── route ────────── */
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

      /* ---------- TXT ---------- */
      if (format === "txt") {
        const { meta, rows } = parseMarkdown(data);
        const line =
          "---------------------------------------------------------";
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

      /* ---------- DOCX ---------- */
      if (format === "docx") {
        const { meta, rows } = parseMarkdown(data);
        const doc = new Document({
          sections: [
            {
              children: [
                ...meta.map(
                  (m) => new Paragraph({ children: [new TextRun(m)] })
                ),
                new Paragraph(""),
                new Table({
                  width: { size: 100, type: WidthType.PERCENTAGE },
                  rows: [
                    new TableRow({
                      children: [
                        new TableCell({
                          width: { size: 30, type: WidthType.PERCENTAGE },
                          children: [new Paragraph("Page(s)")],
                        }),
                        new TableCell({
                          width: { size: 70, type: WidthType.PERCENTAGE },
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

      /* ---------- PDF ---------- */
      if (format === "pdf") {
        const { meta, rows } = parseMarkdown(data);
        const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
        const pass = new stream.PassThrough();
        pdf.pipe(pass).pipe(res);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.pdf"`
        );

        /* calculate printable width */
        const lm = pdf.page.margins.left;
        const rm = pdf.page.margins.right;
        const full = pdf.page.width - lm - rm; // e.g. 612‑40‑40 = 532 pt
        const gap = 8;
        const pageCol = 80; // 1‑inch≈72 pt → narrow page column
        const sumCol = full - pageCol - gap;

        pdf.font("Helvetica-Bold").fontSize(13);
        meta.forEach((l) => pdf.text(l));
        pdf.moveDown();

        /* header */
        let y = pdf.y;
        pdf.font("Helvetica-Bold").fontSize(11);
        pdf.text("Page(s)", lm, y, { width: pageCol });
        pdf.text("Testimony Summary", lm + pageCol + gap, y, { width: sumCol });
        y = pdf.y + 2;
        pdf
          .moveTo(lm, y)
          .lineTo(lm + full, y)
          .stroke();

        /* rows */
        rows.forEach(([p, s]) => {
          const rowY = pdf.y + 4;
          pdf
            .font("Helvetica-Bold")
            .fontSize(10)
            .text(p, lm, rowY, { width: pageCol });
          pdf
            .font("Helvetica")
            .fontSize(10)
            .text(s, lm + pageCol + gap, rowY, { width: sumCol });
        });

        pdf.end();
        return;
      }

      /* ---------- CSV ---------- */
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.csv"`
        );
        res.send(buf);
        return;
      }

      /* unsupported */
      res.status(400).json({ error: "Supported formats: csv, txt, docx, pdf" });
      return;
    } catch (err) {
      console.error("Download route error:", err);
      res.status(500).json({ error: "Failed to retrieve summary content." });
      return;
    }
  }
);

export default router;
