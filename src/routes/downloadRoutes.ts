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
  WidthType,
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
  async (req: Request, res: Response) => {
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

    const safeTitle = (fileRecord.title || "summary")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();

    let summaryData: any[] = [];
    let markdownContent: string | null = null;

    try {
      const [summaryBuffer] = await summaryBucket
        .file(fileRecord.summaryFileName)
        .download();

      const parsed = JSON.parse(summaryBuffer.toString());

      if (Array.isArray(parsed)) summaryData = parsed;
      else if (Array.isArray(parsed.sections)) summaryData = parsed.sections;
      else if (typeof parsed.summary === "string")
        markdownContent = parsed.summary;
    } catch (err) {
      console.error("Summary parse error:", err);
      res.status(500).json({ error: "Failed to retrieve summary content." });
      return;
    }

    if ((!summaryData || summaryData.length === 0) && !markdownContent) {
      res.status(422).json({ error: "Summary content is empty." });
      return;
    }

    if (format === "docx") {
      const headerRow = new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Page", bold: true })] })],
            width: { size: 2000, type: WidthType.DXA },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "Testimony", bold: true })] })],
            width: { size: 10000, type: WidthType.DXA },
          }),
        ],
      });

      const rows = summaryData.map(
        (s: any) =>
          new TableRow({
            children: [
              new TableCell({ children: [new Paragraph(s.page || "")] }),
              new TableCell({ children: [new Paragraph(s.mainPoint || "")] }),
            ],
          })
      );

      const doc = new Document({
        sections: [
          {
            children: [
              new Paragraph({ children: [new TextRun({ text: fileRecord.title, bold: true, size: 28 })] }),
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [headerRow, ...rows],
              }),
            ],
          },
        ],
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.docx"`);
      res.send(buffer);
      return;
    }

    if (format === "txt") {
      const lines = [
        "| Page | Testimony |",
        "|------|-----------|",
        ...summaryData.map((s: any) => `| ${s.page || ""} | ${s.mainPoint || ""} |`),
      ];
      res.setHeader("Content-Type", "text/plain");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.txt"`);
      res.send(lines.join("\n"));
      return;
    }

    if (format === "pdf") {
      const pdf = new PDFDocument({ margin: 40 });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${safeTitle}.pdf"`);
      pdf.pipe(res);

      pdf.fontSize(14).text(fileRecord.title, { align: "center" }).moveDown(1);
      pdf.fontSize(12).text("Page", { continued: true, width: 80 });
      pdf.text("| Testimony", { continued: false }).moveDown(0.3);

      summaryData.forEach((s: any) => {
        pdf
          .fontSize(10)
          .text(`${s.page || ""}`, { continued: true, width: 80 })
          .text(`| ${s.mainPoint || ""}`);
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
    const user = (req as any).user;
    const userId = user?.userId;
    const isAdmin = user?.role === "admin"; // assuming this is set in your JWT

    try {
      const downloads = await prisma.downloadHistory.findMany({
        where: isAdmin ? {} : { userId },
        include: {
          user: { select: { email: true } },
          file: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!downloads.length) {
        console.log(
          `No downloads found for ${isAdmin ? "admin" : "userId: " + userId}`
        );
      }

      res.json(
        downloads.map((d) => ({
          id: d.id,
          user: d.user?.email ?? userId,
          document: d.file?.title ?? "(missing file)",
          date: d.createdAt.toISOString(),
          format: d.format.toUpperCase(),
        }))
      );
    } catch (error) {
      console.error("Failed to fetch download history:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  }
);
export default router;