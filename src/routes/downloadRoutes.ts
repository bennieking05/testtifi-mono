// src/routes/downloadRoutes.ts

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
router.get(
  "/download",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const { fileId, format } = req.query as {
      fileId?: string;
      format?: string;
    };
    if (!fileId || !format) {
      res.status(400).json({ error: "Missing fileId or format" });
      return;
    }

    // fetch summary
    const fileRecord = await prisma.file.findUnique({
      where: { id: fileId },
    });
    if (!fileRecord || !fileRecord.summaryFileName) {
      res.status(404).json({ error: "File not found or no summary" });
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
    const isLegacy = Array.isArray(parsed);
    const summaryText = isLegacy
      ? parsed.map((s: any) => `Page ${s.page}: ${s.mainPoint}`).join("\n")
      : parsed.summary;

    if (!summaryText) {
      res.status(422).json({ error: "Summary content is empty." });
      return;
    }

    // record download in DB
    const userId = (req as any).user.userId as string;
    await prisma.downloadHistory.create({
      data: { userId, fileId, format },
    });

    // now send the file
    if (format === "docx") {
      const doc = new Document({
        sections: [{ children: [new Paragraph(summaryText)] }],
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

      // Create PDFDocument and pipe to response
      const pdf = new PDFDocument();
      pdf.pipe(res);
      pdf.fontSize(12).text(summaryText);
      pdf.end();
      return;
    }

    res.status(400).json({ error: "Invalid format" });
  }
);

// new endpoint: list download history for current user
router.get(
  "/download/history",
  authenticateToken,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as any).user.userId as string;
    const downloads = await prisma.downloadHistory.findMany({
      where: { userId },
      include: { file: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
    });

    res.json(
      downloads.map((d) => ({
        id: d.id,
        user: userId, // or join with User for name/email
        document: d.file.title,
        date: d.createdAt.toISOString(),
        format: d.format.toUpperCase(),
      }))
    );
  }
);

export default router;
