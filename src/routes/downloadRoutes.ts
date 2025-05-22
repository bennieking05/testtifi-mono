// src/routes/downloadRoutes.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType } from "docx";
import PDFDocument from "pdfkit";
import stream from "stream";

const router = express.Router();
const prisma = new PrismaClient();
const summaryBucket = new Storage().bucket("deposition-summaries");

// Helper to parse metadata and markdown table
function parseSummaryMarkdown(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const meta: string[] = [];
  let inTable = false;
  const tableRows: string[][] = [];

  for (const line of lines) {
    if (line.startsWith("|")) inTable = true;
    if (!inTable && line.trim()) meta.push(line);
    else if (inTable && line.startsWith("|")) {
      // Parse markdown table row
      const cols = line.split("|").slice(1, -1).map((c) => c.trim());
      // skip header/sep
      if (
        cols.length === 2 &&
        cols[0].toLowerCase() !== "page" &&
        !/^[-]+$/.test(cols[0])
      ) {
        tableRows.push(cols);
      }
    }
  }
  return { meta, tableRows };
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

    const job = await prisma.summaryJob.findUnique({ where: { id: jobId } });
    if (!job || !job.summaryCsvUrl) {
      res.status(404).json({ error: "Summary job not found or summary file not available" });
      return;
    }

    try {
      const fileName = new URL(job.summaryCsvUrl).pathname.split('/').pop();
      if (!fileName) throw new Error("Invalid summaryCsvUrl");
      const [summaryBuffer] = await summaryBucket.file(fileName).download();

      // TXT download
      if (format === "txt") {
        const { meta, tableRows } = parseSummaryMarkdown(summaryBuffer.toString("utf-8"));
        let txt = meta.join("\n") + "\n\n";
        txt += "---------------------------------------------------------\n";
        txt += "Page(s)           | Testimony Summary\n";
        txt += "---------------------------------------------------------\n";
        for (const [page, summary] of tableRows) {
          txt += page.padEnd(18) + "| " + summary + "\n";
        }
        txt += "---------------------------------------------------------\n";
        res.setHeader("Content-Type", "text/plain");
        res.setHeader("Content-Disposition", `attachment; filename="summary-${jobId}.txt"`);
        res.send(txt);
        return;
      }

      // DOCX download
      if (format === "docx") {
        const { meta, tableRows } = parseSummaryMarkdown(summaryBuffer.toString("utf-8"));
        const children = [
          ...meta.map(m => new Paragraph({ children: [new TextRun(m)] })),
          new Paragraph(""),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph("Page(s)")], width: { size: 30, type: WidthType.PERCENTAGE } }),
                  new TableCell({ children: [new Paragraph("Testimony Summary")], width: { size: 70, type: WidthType.PERCENTAGE } }),
                ],
              }),
              ...tableRows.map(([page, summary]) =>
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph(page)] }),
                    new TableCell({ children: [new Paragraph(summary)] }),
                  ],
                })
              ),
            ],
          }),
        ];
        const doc = new Document({ sections: [{ children }] });
        const docBuffer = await Packer.toBuffer(doc);
        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="summary-${jobId}.docx"`
        );
        res.send(docBuffer);
        return;
      }

      // PDF download
      if (format === "pdf") {
        const { meta, tableRows } = parseSummaryMarkdown(summaryBuffer.toString("utf-8"));
        const doc = new PDFDocument({ margin: 40, size: "LETTER" });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename="summary-${jobId}.pdf"`);
        const passthrough = new stream.PassThrough();
        doc.pipe(passthrough);
        passthrough.pipe(res);

        // Metadata
        doc.font("Helvetica-Bold").fontSize(13);
        meta.forEach(line => doc.text(line));
        doc.moveDown();

        // Table header
        doc.font("Helvetica-Bold").fontSize(11).text("Page(s)", { width: 100, continued: true });
        doc.font("Helvetica-Bold").fontSize(11).text("Testimony Summary", { width: 400 });
        doc.moveDown(0.2);
        doc.font("Helvetica").fontSize(10);
        doc.moveTo(doc.x, doc.y).lineTo(doc.x + 500, doc.y).stroke();

        // Table rows
        for (const [page, summary] of tableRows) {
          doc.font("Helvetica-Bold").fontSize(10).text(page, { width: 100, continued: true });
          doc.font("Helvetica").fontSize(10).text(summary, { width: 400 });
          doc.moveDown(0.2);
        }
        doc.end();
        return;
      }

      // CSV download (default/fallback)
      if (format === "csv") {
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", `attachment; filename="summary-${jobId}.csv"`);
        res.send(summaryBuffer);
        return;
      }

      res.status(400).json({ error: "Supported formats: csv, txt, docx, pdf" });
    } catch (err: any) {
      console.error("Download error:", err);
      res.status(500).json({ error: "Failed to retrieve summary content." });
    }
  }
);

export default router;