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
const storage = new Storage();
const summaryBucket = storage.bucket("deposition-summaries");

/* ────────── helpers ────────── */
const sanitize = (s: string) =>
  s
    .replace(/[^a-z0-9_.-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
const stripExt = (s: string) => s.replace(/\.[^.]+$/, "");

/** take a GCS‑signed URL or path & return just the object name */
const toObjectName = (u: string) => {
  try {
    const { pathname } = new URL(u);
    return pathname.substring(pathname.lastIndexOf("/") + 1);
  } catch {
    // not a URL – treat as already‑clean
    return u;
  }
};

function parseSummaryMarkdown(md: string) {
  const lines = md.split(/\r?\n/);
  const meta: string[] = [];
  const rows: string[][] = [];
  let inTable = false;

  for (const line of lines) {
    if (line.startsWith("|")) inTable = true;
    if (!inTable && line.trim()) meta.push(line);
    else if (inTable && line.startsWith("|")) {
      const cols = line
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
  }
  return { meta, rows };
}

/* ────────── route ────────── */
router.get("/", authenticateToken, async (req: Request, res: Response) => {
  const { jobId, format } = req.query as { jobId?: string; format?: string };
  if (!jobId || !format) {
    res.status(400).json({ error: "Missing jobId or format" });
    return;
  }

  /* 1️⃣ fetch job + file */
  const job = await prisma.summaryJob.findUnique({
    where: { id: jobId },
    include: { file: true },
  });
  if (!job) {
    res.status(404).json({ error: "Summary job not found." });
    return;
  }

  /* clean object name */
  const objectName = job.summaryCsvUrl
    ? toObjectName(job.summaryCsvUrl)
    : job.file?.summaryFileName ?? `summary-${job.id}.md`;

  /* build a nice download filename */
  const safeTitle = sanitize(
    stripExt(
      job.file?.title || job.file?.summaryFileName || job.fileName || "summary"
    )
  );

  try {
    const [summaryBuf] = await summaryBucket.file(objectName).download();

    /* ---------- TXT ---------- */
    if (format === "txt") {
      const { meta, rows } = parseSummaryMarkdown(summaryBuf.toString());
      const hdr = "---------------------------------------------------------\n";
      const body = [
        ...meta,
        "",
        hdr,
        "Page(s)           | Testimony Summary",
        hdr,
        ...rows.map(([p, s]) => p.padEnd(18) + "| " + s),
        hdr,
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
      const { meta, rows } = parseSummaryMarkdown(summaryBuf.toString());
      const children = [
        ...meta.map((m) => new Paragraph({ children: [new TextRun(m)] })),
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
      ];
      const docBuf = await Packer.toBuffer(
        new Document({ sections: [{ children }] })
      );
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
      const { meta, rows } = parseSummaryMarkdown(summaryBuf.toString());
      const pdf = new PDFDocument({ margin: 40, size: "LETTER" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeTitle}.pdf"`
      );

      const pass = new stream.PassThrough();
      pdf.pipe(pass).pipe(res);

      pdf.font("Helvetica-Bold").fontSize(13);
      meta.forEach((line) => pdf.text(line));
      pdf.moveDown();

      pdf
        .font("Helvetica-Bold")
        .fontSize(11)
        .text("Page(s)", { width: 100, continued: true })
        .text("Testimony Summary", { width: 400 });
      pdf
        .moveDown(0.2)
        .moveTo(pdf.x, pdf.y)
        .lineTo(pdf.x + 500, pdf.y)
        .stroke();

      rows.forEach(([p, s]) => {
        pdf
          .font("Helvetica-Bold")
          .fontSize(10)
          .text(p, { width: 100, continued: true });
        pdf.font("Helvetica").fontSize(10).text(s, { width: 400 });
        pdf.moveDown(0.2);
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
      res.send(summaryBuf);
      return;
    }

    res.status(400).json({ error: "Supported formats: csv, txt, docx, pdf" });
  } catch (err) {
    console.error("Download route error:", err);
    res.status(500).json({ error: "Failed to retrieve summary content." });
  }
});

export default router;
