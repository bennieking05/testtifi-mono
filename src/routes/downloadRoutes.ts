import express, { Request, Response } from "express";
import { PrismaClient } from "@prisma/client";
import { authenticateToken } from "../middlewares/authMiddleware";
import PDFDocument from "pdfkit";
import { Document, Packer, Paragraph } from "docx";
import type { RequestInfo as NodeRequestInfo } from "node-fetch";

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

      // Retrieve the file record
      const fileRecord = await prisma.file.findUnique({
        where: { id: fileId },
      });
      if (!fileRecord) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      // Check if the file was created within the last 3 days
      const fileCreatedAt = new Date(fileRecord.createdAt);
      const now = new Date();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1;
      if (now.getTime() - fileCreatedAt.getTime() > threeDaysMs) {
        res.status(400).json({
          error:
            "File is older than 3 days and is no longer available for download",
        });
        return;
      }

      // Check the authenticated user's credits.
      const userId = (req as any).user?.userId;
      const user = await prisma.user.findUnique({
        where: { id: userId },
      });
      if (!user) {
        res.status(404).json({ error: "User not found" });
        return;
      }

      const requiredCredits = 1; // One credit per download
      if (user.credits < requiredCredits) {
        res.status(400).json({ error: "Insufficient credits" });
        return;
      }

      // Deduct the required credits from the user
      await prisma.user.update({
        where: { id: userId },
        data: { credits: user.credits - requiredCredits },
      });

      const summaryUrl = fileRecord.summaryUrl;
      if (!summaryUrl) {
        res.status(404).json({ error: "No summary URL" });
        return;
      }

      // Fetch the summary text from the storage URL
      const nodeFetch = await import("node-fetch").then(
        ({ default: nodeFetch }) => nodeFetch
      );
      const rawSummaryResp = await nodeFetch(summaryUrl as NodeRequestInfo);
      if (!rawSummaryResp.ok) {
        res
          .status(500)
          .json({ error: "Unable to fetch summary text from storage" });
        return;
      }
      const rawSummary = await rawSummaryResp.text();

      // If pages haven't been counted yet, estimate and update the file record.
      let estimatedPages = fileRecord.pages;
      if (!estimatedPages) {
        // Simple estimation: assume ~300 words per page.
        const words = rawSummary.split(/\s+/).length;
        estimatedPages = Math.ceil(words / 300);
        await prisma.file.update({
          where: { id: fileId },
          data: { pages: estimatedPages },
        });
      }

      // Respond based on the requested format
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
