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
  ImageRun,
} from "docx";
import PDFDocument from "pdfkit";
import stream from "stream";
import fs from "fs";

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

      // DOCX
      if (format === "docx") {
        const logoBuffer = fs.readFileSync("./og-image.png");
        const doc = new Document({
          sections: [
            {
              children: [
                new Paragraph({
                  text: "Summarized by Testifi AI",
                  alignment: "center",
                  heading: "Heading1",
                }),
                new Paragraph({
                  children: [
                    new ImageRun({
                      type: "png",
                      data: logoBuffer,
                      transformation: { width: 150, height: 150 },
                    }),
                  ],
                  alignment: "center",
                }),
                new Paragraph({ children: [], pageBreakBefore: true }),
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

      // PDF
      if (format === "pdf") {
        const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
        const pass = new stream.PassThrough();
        pdf.pipe(pass).pipe(res);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.pdf"`
        );
        const lm = pdf.page.margins.left,
          rm = pdf.page.margins.right;
        const full = pdf.page.width - lm - rm,
          gap = 8;
        const pageCol = 80,
          sumCol = full - pageCol - gap;
        pdf.font("Helvetica-Bold").fontSize(13);
        meta.forEach((l) => pdf.text(l));
        pdf.moveDown();
        let y = pdf.y;
        pdf.font("Helvetica-Bold").fontSize(11);
        pdf.text("Page(s)", lm, y, { width: pageCol });
        pdf.text("Testimony Summary", lm + pageCol + gap, y, {
          width: sumCol,
        });
        y = pdf.y + 2;
        pdf
          .moveTo(lm, y)
          .lineTo(lm + full, y)
          .stroke();
        rows.forEach(([p, s]) => {
          const rowY = pdf.y + 4;
          pdf
            .font("Helvetica-Bold")
            .fontSize(10)
            .text(p, lm, rowY, { width: pageCol });
          pdf
            .font("Helvetica")
            .fontSize(10)
            .text(s, lm + pageCol + gap, rowY, {
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
