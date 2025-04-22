// src/routes/downloadRoutes.ts

import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import { Storage } from "@google-cloud/storage";
import PDFDocument from "pdfkit";
import {
  Document,
  Packer,
  Paragraph,
  Table,
  TableRow,
  TableCell,
  TextRun,
} from "docx";

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
        where: { userId },
        select: {
          id: true,
          title: true,
          summaryUrl: true,
          createdAt: true,
          pages: true,
        },
        orderBy: { createdAt: "desc" },
      });

      const payload = files.map((file) => {
        const now = Date.now();
        const createdTime = new Date(file.createdAt).getTime();

        let status: "processing" | "active" | "inactive";
        if (!file.summaryUrl) {
          status = "processing";
        } else if (now - createdTime <= 3 * 24 * 60 * 60 * 1000) {
          status = "active";
        } else {
          status = "inactive";
        }

        return {
          id: file.id,
          title: file.title,
          summaryUrl: file.summaryUrl,
          date: file.createdAt.toISOString(),
          pages: file.pages ?? 0,
          status,
        };
      });

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
    const summaryData = isLegacy ? parsed : parsed.sections;

    if (!summaryData || summaryData.length === 0) {
      res.status(422).json({ error: "Summary content is empty." });
      return;
    }

    const userId = (req as any).user.userId as string;
    await prisma.downloadHistory.create({
      data: { userId, fileId, format },
    });

    if (format === "docx") {
      const rows = summaryData.map(
        (s: any) =>
          new TableRow({
            children: [
              new TableCell({
                children: [new Paragraph(String(s.page || ""))],
              }),
              new TableCell({
                children: [new Paragraph(s.mainPoint)],
              }),
            ],
          })
      );
      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: fileRecord.title, bold: true, size: 28 }),
                ],
              }),
              new Table({ rows }),
            ],
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
        `attachment; filename=\"${safeTitle}.docx\"`
      );
      res.send(buffer);
      return;
    }

    if (format === "txt") {
      const textOutput = summaryData
        .map((s: any) => `| Page ${s.page} | ${s.mainPoint} |`)
        .join("\n");
      res.setHeader("Content-Type", "text/plain");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"${safeTitle}.txt\"`
      );
      res.send(textOutput);
      return;
    }

    if (format === "pdf") {
      const pdf = new PDFDocument();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=\"${safeTitle}.pdf\"`
      );
      pdf.pipe(res);
      summaryData.forEach((s: any) => {
        pdf.text(`| Page ${s.page} | ${s.mainPoint} |`, { lineGap: 4 });
      });
      pdf.end();
      return;
    }

    res.status(400).json({ error: "Invalid format" });
  }
);

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
        user: userId,
        document: d.file.title,
        date: d.createdAt.toISOString(),
        format: d.format.toUpperCase(),
      }))
    );
  }
);

export default router;
