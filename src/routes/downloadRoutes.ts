// src/routes/downloadRoutes.ts
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import PDFDocument from "pdfkit"; // npm install pdfkit @types/pdfkit
import { Document, Packer, Paragraph } from "docx"; // npm install docx
import fetch from "node-fetch"; // npm install node-fetch

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/summaries/download?fileId=xxx&format=pdf|docx|txt
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

      // 1) Find the file in DB
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

      // 2) Retrieve the raw text from GCS (the .txt you stored)
      const rawSummaryResp = await fetch(summaryUrl);
      if (!rawSummaryResp.ok) {
        res
          .status(500)
          .json({ error: "Unable to fetch summary text from GCS" });
        return;
      }
      const rawSummary = await rawSummaryResp.text();

      // 3) Convert based on 'format'
      if (format === "txt") {
        // Send plain text
        res.setHeader("Content-Type", "text/plain");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="summary-${fileId}.txt"`
        );
        res.send(rawSummary);
        return;
      }

      if (format === "pdf") {
        // Generate PDF with pdfkit
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
        // Generate DOCX with docx
        const doc = new Document({
          sections: [
            {
              children: [new Paragraph(rawSummary)],
            },
          ],
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

      // Otherwise, invalid format
      res.status(400).json({ error: "Invalid format" });
      return;
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Something went wrong" });
      return;
    }
  }
);

export default router;
