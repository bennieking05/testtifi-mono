// File: src/routes/downloadRoutes.ts
import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";

const router = express.Router();
const prisma = new PrismaClient();
const storage = new Storage();
const summaryBucket = storage.bucket("deposition-summaries");

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
      if (!fileRecord || !fileRecord.summaryFileName) {
        res.status(404).json({ error: "File not found or missing summary" });
        return;
      }

      const safeTitle = fileRecord.title
        .trim()
        .replace(/\s+/g, "-")
        .toLowerCase();

      const [summaryBuffer] = await summaryBucket
        .file(fileRecord.summaryFileName)
        .download();
      const parsed = JSON.parse(summaryBuffer.toString());

      // Determine if summary is legacy array or single object with 'summary'
      const isLegacy = Array.isArray(parsed);
      const summaryText = isLegacy
        ? parsed.map((s: any) => `Page ${s.page}: ${s.mainPoint}`).join("\n")
        : parsed.summary;

      if (!summaryText) {
        res.status(422).json({ error: "Summary content is empty." });
        return;
      }

      if (format === "docx") {
        const doc = new Document({
          sections: [
            {
              children: [new Paragraph(summaryText)],
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
          `attachment; filename="${safeTitle}.docx"`
        );
        res.send(buffer);
        return;
      }

      if (format === "txt") {
        res.setHeader("Content-Type", "text/plain");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.txt"`
        );
        res.send(summaryText);
        return;
      }

      if (format === "pdf") {
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${safeTitle}.pdf"`
        );
        const pdf = new PDFDocument();
        pdf.pipe(res);
        pdf.fontSize(12).text(summaryText, { align: "left" });
        pdf.end();
        return;
      }

      res.status(400).json({ error: "Invalid format" });
    } catch (error) {
      console.error("Download error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

router.get(
  "/",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }

      const files = await prisma.file.findMany({
        where: { userId, summaryUrl: { not: null } },
        select: { id: true, title: true, summaryUrl: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      });

      const payload = files.map((file) => ({
        id: file.id,
        title: file.title,
        summaryUrl: file.summaryUrl,
        date: file.createdAt.toISOString(),
        status:
          Date.now() - file.createdAt.getTime() <= 259200000
            ? "Active"
            : "Expired",
      }));

      res.json(payload);
    } catch (error) {
      console.error("Summaries error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);

export default router;
