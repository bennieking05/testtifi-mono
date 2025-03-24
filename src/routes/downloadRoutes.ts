import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";
import fetch from "node-fetch";

const router = express.Router();
const prisma = new PrismaClient();

router.get(
  "/download",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { fileId, format } = req.query as {
        fileId?: string;
        format?: string;
      };
      if (!fileId || !format) {
        res.status(400).json({ error: "Missing fileId or format" });
        return;
      }

      const fileRecord = await prisma.file.findUnique({
        where: { id: fileId },
      });
      if (!fileRecord) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const summaryUrl = fileRecord.summaryUrl;
      if (!summaryUrl) {
        res.status(404).json({ error: "No summary URL" });
        return;
      }

      const rawSummaryResp = await fetch(summaryUrl);
      if (!rawSummaryResp.ok) {
        res
          .status(500)
          .json({ error: "Unable to fetch summary text from GCS" });
        return;
      }
      const rawSummary = await rawSummaryResp.text();

      if (format === "txt") {
        res.setHeader("Content-Type", "text/plain");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="summary-${fileId}.txt"`
        );
        res.send(rawSummary);
        return;
      }

      if (format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="summary-${fileId}.pdf"`
        );

        const doc = new PDFDocument();
        doc.pipe(res);
        doc.fontSize(12).text(rawSummary, { align: "left" });
        doc.end();
        return;
      }

      if (format === "docx") {
        const doc = new Document({
          sections: [{ children: [new Paragraph(rawSummary)] }],
        });

        const buffer = await Packer.toBuffer(doc);

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="summary-${fileId}.docx"`
        );
        res.send(buffer);
        return;
      }

      res.status(400).json({ error: "Invalid format" });
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Something went wrong" });
    }
  }
);

export default router;
